// Copyright 2026 The MathWorks, Inc.
//
// Writable custom editor for MAT-files (`-v6` and `-v7`, the Level-5 files core reads and
// writes). The user's baseline for it: a save never breaks the file. Three things hold that up,
// and none of them is this module's own judgement of a value:
//
//  - Every edit is made through core's session (editProperty, addEntry, addChildTo,
//    deleteNode(s)ById, pasteEntries), whose gate offers no edit a save of the file would refuse
//    or write as something else (MatNode._editRefusal), and whose undo and redo are the only undo
//    and redo there are. A gesture core refuses records no step and changes nothing.
//  - A save is `session.serializeSource`: the file as it was read, every variable nobody edited
//    as its own bytes, what was edited written fresh, self-checked against MATLAB's load rules
//    before any byte is handed back. A refusal (MatWriteError, naming the variable) fails the
//    save with core's words, writes nothing and leaves the document dirty.
//  - The bytes reach the disk by a replace (safeWrite.ts): a temporary file beside the original,
//    flushed, renamed over it, so a crash part-way through cannot leave half a file.
//
// THE DOCUMENT IS THE TREE. There is no text to hold, as the dictionary editors hold theirs:
// the session's source for this file is the document, registered under a prefixed srcId so it
// never collides with another view's registration of the same uri (common/srcId.ts). VS Code's
// edit stack is mapped onto core's: each gesture is observed on the session's bus, and one that
// recorded N undo steps pushes ONE VS Code edit whose undo and redo replay `DataModel.undo()` /
// `redo()` N times. VS Code calls them in stack order, so the two stacks move together.
//
// A SAVE KEEPS THE TREE. Re-registering the saved bytes would empty core's undo stack, and every
// edit before the save could no longer be undone (with `files.autoSave` on, every edit). The tree
// as read plus its edits is what the save wrote, so nothing is lost by keeping it; the next save
// writes each variable edited since the file was opened fresh again, self-checked again. What a
// save does reset is the Status column, which says "differs from the file on disk" and so is kept
// here (saveMarks.ts); core's own marks are what makes a save write an edit, and are never reset.
//
// A RELOAD REPLACES IT. A revert, or an outside change while there are no unsaved edits
// (diskFollow.ts, the rules the binary dictionary editor follows), registers a new tree from the
// disk. The edits VS Code still holds from before were made on the old tree, which is gone, so
// their undo and redo do nothing but say so (the document's `generation`).
import * as vscode from 'vscode';
import { DataModel, toEntrySelector, type PastePayload, type PasteResult } from 'data-explorer-core';
import { renderTableWebview } from './webviewHtml.js';
import { COLUMNS, COLUMN_LABELS, COLUMN_GROUPS } from './rowBuilder.js';
import { rowPlannerFor } from './rowPlanner.js';
import { buildMatVariableRows } from './matRowBuilder.js';
import { LAZY_ROW_BUDGET, lazyRowsBanner } from './lazyRows.js';
import { answerChildRequest } from './childRequest.js';
import { answerMatrixRequest } from './matrixRequest.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import { annotateDataRows, annotateDataRowsNow } from './usageGraph.js';
import { subscribeUsageRepost } from './usageRepostWatch.js';
import { refuseIfUnreadable, sourceWarnings, warningBanner, type WarningBanner } from './parseWarnings.js';
import { postOrReport } from './postPayload.js';
import { clearDrag, getDrag } from './dragState.js';
import { clipboardState } from './clipboard.js';
import { clipMarkChange, clipMarkOfDoc } from './clipMarks.js';
import { copyEntriesToClipboard, dragEntries } from './clipboardAction.js';
import { cloneForPaste } from './structuralEdit.js';
import { WHOLE_FILE_SECTION, wholeFileRules } from './sectionRules.js';
import { runTransfer, TransferRefused, type SourceDeleteResult, type TransferAdapter, type TransferDeps, type TransferTarget } from './transfer.js';
import { clipboardRegister, dragRegister } from './transferRegisters.js';
import type { ClipMark } from './rowStamp.js';
import {
  NOT_FOUND_REASON,
  broadcastClipboardState,
  broadcastDragState,
  deleteFromSource,
  registerAddGalleryView,
  registerSourceDeleter,
  registerWebview,
  unregisterAddGalleryView,
  unregisterSourceDeleter,
  unregisterWebview,
  type DeleteTarget,
} from './editorHub.js';
import { EditStackMirror, OVERWRITE, REVERT, type DiskStamp } from './diskConflict.js';
import { followDisk, refuseIfChangedOnDisk, stampOf, watchDisk, type FollowedDocument } from './diskFollow.js';
import { SaveMarks, replacementsIn, type SaveMark, type SaveSnapshot } from './saveMarks.js';
import { saveSettled } from './settledSave.js';
import { sameFile, writeFileSafely } from './safeWrite.js';
import { binaryEditSrcId } from '../common/srcId.js';
import { basename } from '../common/pathUtil.js';
import { toArrayBuffer } from '../common/bytes.js';
import type { TableToHostMessage } from '../common/protocol.js';
import { matCatalog } from '../common/addCatalog.js';

/** One read of the file behind a document, with the stamp it was read under (stat first). */
interface DiskRead {
  stamp: DiskStamp | undefined;
  bytes: ArrayBuffer;
}

async function readDisk(uri: vscode.Uri): Promise<DiskRead> {
  // The stat BEFORE the read, so a write landing between them leaves an old stamp on new bytes,
  // and the next save asks about a conflict it did not need to. The other order would leave a
  // new stamp on old bytes, and the next save would silently overwrite the write it missed.
  const stamp = await stampOf(uri);
  return { stamp, bytes: toArrayBuffer(await vscode.workspace.fs.readFile(uri)) };
}

/**
 * What one gesture did to the session: how many undo steps it recorded, and which variables it
 * touched (an edit's own, those core copied it into, those removed and added) — read off the
 * session's bus while the gesture ran, since only the session knows where an edit landed: two
 * variables that hold one handle (`r = h`) are one object, and an edit of one is an edit of both.
 */
interface Observed {
  steps: number;
  touched: Set<any>;
  added: Set<any>;
  /**
   * Each of `added` that is put in the place of a variable the gesture took out, and that one:
   * core's retype, a variable of another class swapped in under the same name (saveMarks.ts).
   */
  replaced: Map<any, any>;
  /** The variables before the gesture, each with the row id the table spells it by. */
  before: Map<any, string>;
  order: any[];
  /**
   * What the gesture threw, if it threw. Its steps are counted all the same: core recorded them
   * before it threw, and an edit VS Code is not told of would leave core's stack a step ahead of
   * VS Code's, so that the next Undo undid the wrong edit.
   */
  error?: unknown;
}

// O(variables) a gesture, for the id map and the order: 10 ms on a file of 100,000 variables,
// against the 300 ms the payload of such a file takes to build.
function observe(mat: any, srcId: string, run: () => void): Observed {
  const before = new Map<any, string>();
  for (const v of mat.children) before.set(v, v.id);
  const observed: Observed = { steps: 0, touched: new Set(), added: new Set(), replaced: new Map(), before, order: [...mat.children] };
  // The variable a node is or is under, while it is in the file; a variable just removed is
  // known by having been in it.
  const variableOf = (node: any): any => {
    for (let n = node; n; n = n.parent) if (n.parent === mat) return n;
    return before.has(node) ? node : null;
  };
  const touch = (node: any) => {
    const v = variableOf(node);
    if (v) observed.touched.add(v);
    return v;
  };
  const bus = DataModel.bus;
  const subs = [
    bus.subscribe('undo/changed', (e) => {
      if (e.srcId === srcId) observed.steps++;
    }),
    bus.subscribe('node/children-changed', (e) => void touch(e.parent)),
    bus.subscribe('node/added', (e) => {
      if (touch(e.node) === e.node) observed.added.add(e.node);
    }),
    bus.subscribe('node/deleted', (e) => void touch(e.node)),
  ];
  try {
    run();
  } catch (err) {
    observed.error = err;
  } finally {
    for (const s of subs) s.remove();
  }
  observed.replaced = replacementsIn(before, observed.added, (v) => v.id, (v) => v.parent === mat);
  return observed;
}

/** Whether a gesture changed which variables the file holds, or their order. */
function variablesMoved(mat: any, observed: Observed): boolean {
  const now = mat.children as any[];
  return now.length !== observed.order.length || now.some((v, i) => v !== observed.order[i]);
}

/** One open view of a document: the ways the document asks it to repaint. */
interface DocumentView {
  /** Every row, from the tree as it stands. */
  repaintAll(): void;
  /** The rows of these variables, each spliced over the run the table holds by `before`'s id. */
  repaintVariables(variables: Iterable<any>, before?: ReadonlyMap<any, string>): void;
  /** Every row again, if the classes the gallery was last told the file takes are no longer core's. */
  refreshGallery(): void;
}

class MatDocument implements vscode.CustomDocument, FollowedDocument {
  readonly edits: EditStackMirror;
  stamp: DiskStamp | undefined;
  inConflict = false;
  conflictPromptOpen = false;
  overwriteStamp: DiskStamp | undefined;
  saving = false;
  disposed = false;

  /**
   * Moved by every tree registered from the disk (a revert, a reload). An edit made on one
   * generation's tree has nothing to undo on another's: its steps were on the stack that left
   * with the old tree, so its undo and redo check this first.
   */
  generation = 0;

  /**
   * Moved by every change to the tree, and by every save (which moves the Status column), so a
   * paint that awaited can tell it is stale.
   */
  version = 0;

  /** Which variables differ from the file as last saved, for the Status column. */
  readonly marks = new SaveMarks<any>();

  readonly views = new Set<DocumentView>();

  /** The file's bytes, until the first paint registers them (`model`). */
  private bytes: ArrayBuffer | null;
  /**
   * The bytes the file holds as this document last read or wrote it, for a revert that cannot read
   * the disk (revertCustomDocument). The read is the buffer the tree's records are views of, so it
   * costs nothing; after a save it is the bytes the save wrote, one more copy of the file. None for
   * a document restored from a backup, which was never the file.
   */
  onDisk: Uint8Array | null;
  /** The registered tree, or why there is none. Null until the first `model()`. */
  private loaded: { node: any } | { error: Error } | null = null;

  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<MatDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChange.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    public readonly uri: vscode.Uri,
    bytes: ArrayBuffer,
    fromBackup: boolean,
  ) {
    this.bytes = bytes;
    this.onDisk = fromBackup ? null : new Uint8Array(bytes);
    // VS Code reports a document restored from a hot-exit backup as dirty, though it has no
    // edits, until it is saved or reverted.
    this.edits = new EditStackMirror(fromBackup);
  }

  /** Prefixed, as the binary dictionary editor's is: see common/srcId.ts. */
  get srcId(): string {
    return binaryEditSrcId(this.uri.toString());
  }

  get metaPath(): string {
    return basename(this.uri.path) || 'document';
  }

  track(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  /**
   * The tree, registered from the file's bytes on the first ask: lazily, so a large file opens
   * onto the table's spinner as the read-only view's does, and not onto a blank editor while
   * `openCustomDocument` parses. Throws why there is none: a `-v7.3` file (HDF5), a file that is
   * not a MAT-file, one the reader could not read at all (refused, as the read-only view refuses
   * it, rather than shown as an empty file a save would then write).
   */
  model(): any {
    if (this.loaded) {
      if ('error' in this.loaded) throw this.loaded.error;
      return this.loaded.node;
    }
    const bytes = this.bytes!;
    this.bytes = null;
    try {
      DataModel.removeDataSource(this.srcId);
      const node = DataModel.addMatSource(this.srcId, bytes, { path: this.metaPath });
      try {
        refuseIfUnreadable(sourceWarnings(node));
      } catch (err) {
        DataModel.removeDataSource(this.srcId);
        throw err;
      }
      this.loaded = { node };
      return node;
    } catch (err) {
      this.loaded = { error: err instanceof Error ? err : new Error(String(err)) };
      throw this.loaded.error;
    }
  }

  /**
   * Core's message, saying the file's name where core says the srcId. A MatNode is named by the
   * srcId it was registered under, and core quotes that name (`Cannot save "binedit:file:///…"`),
   * as a node's id, which a message can carry, begins with it. Every message this view shows of
   * core's comes through here.
   */
  describe(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return message.split(this.srcId).join(this.metaPath);
  }

  /** A warning banner with core's messages described (see `describe`). */
  describeBanner(banner: WarningBanner | undefined): WarningBanner | undefined {
    return banner && { headline: this.describe(banner.headline), details: banner.details.map((d) => this.describe(d)) };
  }

  /**
   * The file as a save writes it, or an Error saying why it cannot be written (core's refusal),
   * in which case nothing is written anywhere. Synchronous, so the bytes are the document as
   * the save was asked for: an edit that lands while they are being written stays unsaved.
   */
  serialize(): Uint8Array {
    let out: ReturnType<typeof DataModel.serializeSource>;
    try {
      this.model();
      out = DataModel.serializeSource(this.srcId);
    } catch (err) {
      throw new Error(this.describe(err));
    }
    if (!out || out.kind !== 'binary' || !(out.bytes instanceof Uint8Array)) {
      throw new Error(`Cannot save "${this.metaPath}": it is not held as a MAT-file. Nothing was written.`);
    }
    return out.bytes;
  }

  /**
   * Push one gesture's undo steps onto VS Code's stack as one edit, and record which variables it
   * touched for the Status column. `touched` beyond what the bus said: a batch delete announces
   * its first variable only, and the rest of them are as much the edit's.
   */
  pushEdit(label: string, observed: Observed, touched: Iterable<any> = []): void {
    const steps = observed.steps;
    const generation = this.generation;
    const mark = this.marks.push([...observed.touched, ...touched], observed.added, observed.replaced);
    this.version++;
    this.edits.pushed();
    this._onDidChange.fire({
      document: this,
      label,
      undo: () => {
        this.edits.undone();
        if (generation !== this.generation) return staleEdit(this.metaPath, 'undone');
        mark.undone();
        this.replay('undo', steps);
      },
      redo: () => {
        this.edits.redone();
        if (generation !== this.generation) return staleEdit(this.metaPath, 'redone');
        mark.redone();
        this.replay('redo', steps);
      },
    });
  }

  /**
   * Run one gesture through the session, push what it recorded as ONE VS Code edit, and repaint
   * every view of the file: the half of a gesture that is the document's. A view's own gestures
   * come through here (the provider's `gesture`, which also says what went wrong in that view),
   * and so does the delete a move into another document asks of this one, which has no view of
   * its own to say anything in (`deleteMoved`).
   *
   * What core recorded before a throw is one edit like any other, so that the next Undo undoes
   * it and not the edit before it. A gesture that threw is not repainted here: whatever core did
   * before it threw is in the tree, and the caller paints every row again and says why.
   */
  record(label: string, run: (mat: any) => void, touched: () => Iterable<any> = () => []): Observed {
    const mat = this.model();
    const observed = observe(mat, this.srcId, () => run(mat));
    if (observed.steps > 0) this.pushEdit(label, observed, touched());
    if (observed.error) {
      this.version++;
      return observed;
    }
    // Its rows, and the gallery's classes where the edit moved them.
    this.repaint(observed);
    return observed;
  }

  /**
   * Take out of this file the variables a move into another document carried away (editorHub's
   * source deleter), as ONE edit on this file's own stack, and answer what became of them for
   * the view the move was made in to say: this file's views are repainted, never told.
   *
   * By name, because a MAT-file's payloads carry no metadata and so its selectors are names —
   * and only the variable that was taken: the one holding the name must be the node the cut or
   * the drag carried the token of (`originOf`), or nothing is removed. A name the file now holds
   * twice is refused rather than guessed at — a copy is all the move can have been, and the user
   * is told the original stays — and so is a file that takes no edit. A name nothing answers to
   * any more (renamed or deleted since the cut) is skipped, and only when none answers is that
   * the answer.
   */
  deleteMoved(targets: readonly DeleteTarget[]): SourceDeleteResult {
    let mat: any;
    try {
      mat = this.model();
    } catch (err) {
      return { removed: false, reason: this.describe(err) };
    }
    if (mat.readOnly) return { removed: false, reason: `${this.metaPath} is read-only` };
    // The file's variables by name, once: a select-all cut of a large file names every one.
    const byName = new Map<string, any[]>();
    for (const v of mat.children as any[]) {
      const named = byName.get(v.name);
      if (named) named.push(v);
      else byName.set(v.name, [v]);
    }
    const variables: any[] = [];
    for (const target of targets) {
      const { name } = toEntrySelector(target);
      const named = byName.get(name) ?? [];
      if (named.length > 1) return { removed: false, reason: `it holds more than one "${name}", and a move takes its original out by name` };
      // The variable that holds the name now must be the one that was taken: a cut is lazy, and
      // between it and the paste the original can be deleted and another variable given its
      // name, which a delete by name would take out instead. Nothing is removed then: the
      // original is gone, or (renamed since) still there under its new name for the user.
      const origin = typeof target === 'object' ? target.origin : undefined;
      if (named.length === 1 && origin && this.origins.get(named[0]) !== origin) {
        const moved = (mat.children as any[]).find((v) => this.origins.get(v) === origin);
        return moved
          ? { removed: false, reason: `the "${name}" it holds now is another variable, and the one taken is now "${moved.name}"` }
          : { removed: false, gone: true, reason: `the "${name}" it holds now is another variable, which was left as it is` };
      }
      variables.push(...named);
    }
    if (variables.length === 0) return { removed: false, reason: NOT_FOUND_REASON };
    const observed = this.record(
      'Move (remove source)',
      () => DataModel.deleteNodesById(variables.map((v) => v.id)),
      () => variables,
    );
    // Answered from what the file holds now, not from whether core threw: a delete it recorded
    // before throwing took the originals out all the same (and is an edit VS Code was handed),
    // and telling the user to remove them by hand would have them look for what is gone.
    const gone = variables.every((v) => v.parent !== mat);
    if (observed.error) this.repaintAll();
    if (gone && observed.steps > 0) return { removed: true };
    if (observed.error) return { removed: false, reason: this.describe(observed.error) };
    return { removed: false, reason: 'the file did not let it be removed' };
  }

  /**
   * The token a cut or a drag of `variable` carries (TransferItem.origin), which `deleteMoved`
   * tells the original by: one object for as long as the variable is the same node — through
   * edits of it, a rename, and the undo of its delete, which puts the node itself back. A variable
   * made since (an Add, a paste, a reload of the file) is another node, with another token.
   */
  originOf(variable: any): object {
    let token = this.origins.get(variable);
    if (!token) this.origins.set(variable, (token = {}));
    return token;
  }

  // Keyed weakly by the node: a token keeps no variable alive, and a variable gone keeps no token.
  private readonly origins = new WeakMap<object, object>();

  /** Run core's undo or redo `steps` times on this file's stack, and repaint what it touched. */
  private replay(direction: 'undo' | 'redo', steps: number): void {
    const mat = this.model();
    const observed = observe(mat, this.srcId, () => {
      for (let i = 0; i < steps; i++) {
        // The session's undo is its ACTIVE source's: this file, every time, since nothing else
        // in this extension moves the session's selection but this editor's own gestures.
        DataModel.setActiveContext(mat);
        if (direction === 'undo') DataModel.undo();
        else DataModel.redo();
      }
    });
    this.version++;
    if (observed.error) {
      // Core's own step threw part-way: the tree is whatever it left, so every row is painted
      // again from it, and the user is told. Nothing can put the two stacks back in step.
      this.repaintAll();
      void vscode.window.showErrorMessage(`Could not ${direction} the edit of ${this.metaPath}: ${this.describe(observed.error)}`);
      return;
    }
    this.repaint(observed);
  }

  /** Repaint every view after `observed`: one variable's rows at a time, or all of them. */
  repaint(observed: Observed): void {
    let mat: any;
    try {
      mat = this.model();
    } catch {
      return this.repaintAll();
    }
    if (variablesMoved(mat, observed)) return this.repaintAll();
    const present = [...observed.touched].filter((v) => v.parent === mat);
    for (const view of [...this.views]) {
      view.repaintVariables(present, observed.before);
      // An edit can change what core says the file takes a new variable of, and so can its undo
      // and its redo, which come through here as the gesture does.
      view.refreshGallery();
    }
  }

  /** Repaint the variables whose Status changed between two answers of `marks`. */
  repaintMarks(before: ReadonlyMap<any, SaveMark>): void {
    let mat: any;
    try {
      mat = this.model();
    } catch {
      return;
    }
    const after = this.marks.marks();
    const changed = new Set<any>();
    for (const [v, m] of before) if (after.get(v) !== m) changed.add(v);
    for (const [v, m] of after) if (before.get(v) !== m) changed.add(v);
    // Of the variables in the file only. One an edit took out of it is marked all the same, and
    // has no rows: a splice of rows the table does not hold has the webview ask for every row
    // again, which resets its banners.
    const present = [...changed].filter((v) => v.parent === mat);
    if (present.length === 0) return;
    for (const view of [...this.views]) view.repaintVariables(present);
  }

  repaintAll(): void {
    for (const view of [...this.views]) view.repaintAll();
  }

  /**
   * Make this document hold what `read` found on disk: a revert, or a reload of an outside
   * change. A new tree, so a new generation, nothing differing from the file, and nothing left
   * to be in conflict with.
   */
  replace(read: DiskRead): void {
    DataModel.removeDataSource(this.srcId);
    this.bytes = read.bytes;
    this.onDisk = new Uint8Array(read.bytes);
    // A backup of the tree that is going is not one of this one.
    this.lastBackup = undefined;
    this.loaded = null;
    this.generation++;
    this.version++;
    this.marks.clear();
    this.stamp = read.stamp;
    this.inConflict = false;
    this.overwriteStamp = undefined;
    // Registered now rather than at the paint, so that what asks the session next (the
    // Property Inspector, below) finds the new tree. A file that no longer reads says so at
    // the paint.
    try {
      this.model();
    } catch {
      /* reported by the paint */
    }
    this.repaintAll();
    this.onReplaced?.();
  }

  /** Called after `replace`: the provider's, which refreshes the Property Inspector. */
  onReplaced?: () => void;

  /**
   * The last hot-exit backup this document wrote, which a backup that cannot be written keeps
   * standing (backupCustomDocument).
   */
  lastBackup: SharedBackup | undefined;
  /** A backup was refused, and the user was told; reset by the next backup that succeeds. */
  backupRefusalShown = false;

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables.splice(0)) d.dispose();
    DataModel.removeDataSource(this.srcId);
    this._onDidChange.dispose();
  }
}

/**
 * An undo or redo VS Code asked of an edit made before the file was last read from disk. Its steps
 * left with the old tree, so nothing is done to the new one, and the status bar says so rather
 * than leave the user guessing why the table did not move.
 *
 * VS Code has moved its stack all the same, so the document now shows as dirty while the tree
 * is still what the disk holds. That is harmless: a save writes the file as it is, and Revert
 * makes it clean. It is left so rather than reverted from inside VS Code's own undo.
 */
function staleEdit(name: string, what: 'undone' | 'redone'): void {
  vscode.window.setStatusBarMessage(
    `${name} was reloaded from disk since this edit was made, so it cannot be ${what}.`,
    5000,
  );
}

/**
 * A hot-exit backup VS Code may be handed more than once. The extension host deletes a backup when
 * it is handed the next one, so a backup that is handed on again, because the edit after it could
 * not be written, must survive the delete of its first handle: each handle holds a reference, and
 * the file goes with the last.
 */
class SharedBackup {
  private refs = 0;
  /** False once the last handle is deleted, and the file with it. */
  alive = true;
  constructor(
    readonly id: string,
    private readonly destination: vscode.Uri,
  ) {}

  handle(): vscode.CustomDocumentBackup {
    this.refs++;
    let deleted = false;
    return {
      id: this.id,
      delete: async () => {
        if (deleted) return;
        deleted = true;
        if (--this.refs > 0) return;
        this.alive = false;
        try {
          await vscode.workspace.fs.delete(this.destination);
        } catch {
          /* already gone */
        }
      },
    };
  }
}

/**
 * A backup's id: where it is, and the stamp of the file the document was last read or saved as.
 * A restore compares the file with that stamp at its first save, so an outside change between the
 * backup and the restore is asked about rather than overwritten. Read back by `backupSource`.
 */
function backupId(destination: vscode.Uri, stamp: DiskStamp | undefined): string {
  return JSON.stringify({ backup: destination.toString(), stamp: stamp ?? null });
}

/** Where a backup id points, and its stamp, or none for an id this editor did not write. */
function backupSource(id: string): { uri: vscode.Uri; stamp: DiskStamp | undefined } {
  try {
    const parsed = JSON.parse(id) as { backup?: unknown; stamp?: { mtime?: unknown; size?: unknown } | null };
    if (typeof parsed?.backup === 'string') {
      const s = parsed.stamp;
      const stamp = s && typeof s.mtime === 'number' && typeof s.size === 'number' ? { mtime: s.mtime, size: s.size } : undefined;
      return { uri: vscode.Uri.parse(parsed.backup), stamp };
    }
  } catch {
    /* a bare uri */
  }
  return { uri: vscode.Uri.parse(id), stamp: undefined };
}

/**
 * The classes `mat` can take a new variable of, as core lists them (MatNode.getAllowedTypes): a
 * plain variable and a struct, and the classes of MATLAB's own default objects where the file's
 * objects can be added to. A core without the list adds a plain variable only, as it always has.
 */
function allowedClasses(mat: any): readonly string[] {
  if (typeof mat?.getAllowedTypes !== 'function') return ['MatlabVariable'];
  const classes = mat.getAllowedTypes();
  return Array.isArray(classes) ? classes.filter((c: unknown): c is string => typeof c === 'string') : [];
}

/** The label the gallery's tile of `className` shows ('MATLAB Structure'), or the class itself. */
function tileLabelOf(className: string): string {
  return matCatalog([className]).flatMap((c) => c.tiles).find((t) => t.className === className)?.label ?? className;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export class MatEditorProvider implements vscode.CustomEditorProvider<MatDocument> {
  public static readonly viewType = 'dataExplorer.matView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;
  // Handle a Usage-column link click (wired in extension.ts).
  public onNavigate?: (target: string, referrer?: string) => void;
  // A document's tree was replaced from disk (wired in extension.ts, which shows the Property
  // Inspector's node again from the new tree, if it is this document's).
  public onReplaced?: (uriString: string) => void;

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<MatDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  /**
   * Ask the user about a save refused because the file changed on disk (diskFollow.ts). A
   * property so that the integration suite, which cannot click a notification, can answer.
   */
  askSaveConflict: (message: string) => Thenable<string | undefined> = (message) =>
    vscode.window.showErrorMessage(message, OVERWRITE, REVERT);

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<MatDocument> {
    // A hot-exit backup is a whole MAT-file (backupCustomDocument), so a restore opens it as the
    // document. Its stamp is the one the backup recorded, of the file the edits were made over:
    // the file now may be another program's since, and a save has to ask before writing over it.
    let source = uri;
    let stamp: DiskStamp | undefined;
    if (openContext.backupId) {
      ({ uri: source, stamp } = backupSource(openContext.backupId));
    } else {
      stamp = await stampOf(uri);
    }
    const bytes = toArrayBuffer(await vscode.workspace.fs.readFile(source));
    const doc = new MatDocument(uri, bytes, !!openContext.backupId);
    doc.stamp = stamp;
    doc.onReplaced = () => this.onReplaced?.(uri.toString());
    doc.onDidChangeCustomDocument((e) => this._onDidChangeCustomDocument.fire(e));
    doc.track(watchDisk(doc, () => followDisk(doc, () => readDisk(doc.uri), (read) => doc.replace(read))));
    return doc;
  }

  async resolveCustomEditor(
    document: MatDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    const uriString = document.uri.toString();
    const name = document.metaPath;
    // The MAT planner (rowPlanner.ts): the payload and the answer to a fetch are one walk.
    const planner = rowPlannerFor(name);
    const findNode = (rowId: string): any => (DataModel as any).findNodeById?.(rowId) ?? null;

    // Why the file takes no edit at all, for the banner, or undefined. Core's own words where a
    // save says them; a file whose layout a save could not keep says nothing until it is
    // edited, which it cannot be, so that one gets this view's.
    const readOnlyNotice = (mat: any): string | undefined => {
      if (!mat.readOnly) return undefined;
      try {
        document.serialize();
      } catch (err) {
        return `Read-only: ${(err as Error).message}`;
      }
      return `Read-only: ${name} is laid out in a way a save could not keep as it is, so it opens for viewing only.`;
    };

    // What every row of this view is stamped with beyond the Status column: its variables travel
    // on the clipboard and in row drags, as a dictionary's entries do (`_canCopy`), and those the
    // clipboard holds carry its mark (clipMarks.ts; keyed ('', name), the file's one section).
    // The payload, a variable's repaint and a fetch of the rows under one all stamp alike.
    const stamps = () => ({ canCopy: true, clipMark: clipMarkOfDoc(uriString) });

    // The rows of the whole file, with the Status column measured from the last save, and the
    // clipboard mark they carry (what the clip-mark repaint compares the clipboard with next).
    const build = (mat: any) => {
      const opts = { ...stamps(), savedStatus: document.marks.marks() };
      const planned = planner.payload(mat, LAZY_ROW_BUDGET, opts);
      return { planned, clipMark: opts.clipMark, version: document.version };
    };

    // The classes the gallery was last told the file can take a new variable of. Core's answer
    // (MatNode.getAllowedTypes) can change with the file — a reload, a subsystem a save no longer
    // writes as read — so an edit that changes it, or the undo or redo of one, repaints the whole
    // table, which tells the gallery again (refreshGallery, below).
    let lastClasses: readonly string[] = [];
    // The clipboard mark the rows last painted whole carry (repaintClipMark, below).
    let paintedMark: ClipMark | undefined;

    // The document's tree, or null once the view has been told why there is none.
    const treeOrError = (): any => {
      try {
        return document.model();
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to parse ${name}: ${document.describe(err)}` });
        return null;
      }
    };

    // Closed while a paint was awaiting: what it would post next has nowhere to go (a disposed
    // webview throws on a post), and the document, which other views may still show, is not this
    // view's to report on.
    let viewClosed = false;

    const post = async (): Promise<void> => {
      let mat = treeOrError();
      if (!mat) return;
      try {
        let built = build(mat);
        // The Usage column, as the read-only view fills it. Awaited only here: an edit's repaint
        // fills it from the graph this built (annotateDataRowsNow).
        await annotateDataRows(uriString, built.planned.rows).catch(() => false);
        if (document.disposed || viewClosed) return;
        // The document moved while the graph was being built: these rows are from before it. A
        // reload (replace) moves it onto another tree altogether, so the tree is asked for again,
        // and the rows, the notice and the gallery's classes below are all of the one it holds.
        if (built.version !== document.version) {
          mat = treeOrError();
          if (!mat) return;
          built = build(mat);
          annotateDataRowsNow(uriString, built.planned.rows);
        }
        const notice = readOnlyNotice(mat);
        // The padlock the read-only view wears, only where this one is read-only too.
        webviewPanel.iconPath = notice ? new vscode.ThemeIcon('lock') : undefined;
        await postOrReport(
          webview,
          {
            type: 'setRows',
            docUri: uriString,
            rows: built.planned.rows,
            columns: COLUMNS,
            columnLabels: COLUMN_LABELS,
            columnGroups: COLUMN_GROUPS,
            editable: !notice,
            notice,
            // The gallery offers the classes core says this file can take a new variable of.
            add: { classes: lastClasses = allowedClasses(mat) },
            warnings: document.describeBanner(lazyRowsBanner(built.planned.plan, warningBanner(sourceWarnings(mat)))),
          },
          name,
        );
        if (viewClosed) return;
        // Behind the rows, in the order the dictionary views post them: where a paste or a drop
        // can land (the whole file, one target, admitting what core says it does), and what the
        // clipboard holds. A read-only file is no target: its empty admitted list would read as
        // "no restriction" (sectionRules.wholeFileRules), so it posts no rule at all.
        webview.postMessage({ type: 'sectionRules', docUri: uriString, rules: notice ? [] : wholeFileRules(mat, name) });
        webview.postMessage({ type: 'clipboardState', ...clipboardState() });
        // The mark these rows CARRY. A copy or a cut that landed while they were being built
        // repainted the rows it marked at once, ahead of these, which have just landed over that
        // with the mark from before: so the rows that moved are painted again, after them.
        paintedMark = built.clipMark;
        repaintClipMark();
        drainNavigateSelect(webview, uriString);
      } catch (err) {
        if (!viewClosed) webview.postMessage({ type: 'error', message: `Failed to show ${name}: ${document.describe(err)}` });
      }
    };

    // One variable's rows, spliced over the run the table holds for it. The banner's count of rows
    // still to load is the last whole payload's until the next one: one variable cannot move it
    // by much, and recounting it is a walk of the whole file.
    const repaintVariables = (variables: Iterable<any>, before?: ReadonlyMap<any, string>) => {
      try {
        const saved = document.marks.marks();
        const opts = stamps();
        for (const v of variables) {
          const rows = buildMatVariableRows(v, LAZY_ROW_BUDGET, saved, opts);
          annotateDataRowsNow(uriString, rows);
          webview.postMessage({ type: 'updateEntryRows', entryRowId: before?.get(v) ?? v.id, rows });
        }
      } catch (err) {
        repaintAndReport(`Failed to update the row: ${document.describe(err)}`);
      }
    };

    // Every row painted again from the tree, and then `message` shown. In that order, and only
    // once the paint is posted: a paint clears the error banner, and this one posts after its
    // await, so a message sent beside it would be cleared as it arrived. A view closed by then
    // has nothing left to tell (postPayload.ts).
    const repaintAndReport = (message: string) => {
      void post()
        .then(() => webview.postMessage({ type: 'error', message }))
        .catch(() => false);
    };

    // Put back what the table shows of `node`, from the tree, and then show `message`, if any:
    // how a cell that shows what was typed is told what the tree holds, where the tree took
    // nothing. The rows of the variable `node` is or is under; every row, where it is under none.
    const putBack = (node: any, message?: string) => {
      const mat = treeOrError();
      if (!mat) return;
      let v = node;
      while (v && v.parent !== mat) v = v.parent;
      if (!v) {
        if (message) repaintAndReport(message);
        else void post();
        return;
      }
      repaintVariables([v]);
      if (message) webview.postMessage({ type: 'error', message });
    };

    const refreshGallery = () => {
      let mat: any;
      try {
        mat = document.model();
      } catch {
        return;
      }
      if (!sameList(allowedClasses(mat), lastClasses)) void post();
    };

    /**
     * The narrow repaint that keeps the clipboard mark this view painted (`paintedMark`) current:
     * on every clipboard broadcast (editorHub), the variables the painted mark and the
     * clipboard's now name between them, and nothing when they are the same mark — the rule
     * every table follows (clipMarks.ts). A variable is found by its name, the key's other half;
     * one the file no longer holds (a cut pasted elsewhere took it) has no rows left to un-dim.
     */
    const repaintClipMark = () => {
      const next = clipMarkOfDoc(uriString);
      const affected = clipMarkChange(paintedMark, next);
      if (!affected) return;
      let mat: any;
      try {
        mat = document.model();
      } catch {
        // No tree, so no rows to mark: the view said why when it was painted, and saying it
        // again on every clipboard broadcast would only flash the same banner.
        return;
      }
      paintedMark = next;
      const names = new Set(affected.filter((e) => e.section === WHOLE_FILE_SECTION).map((e) => e.name));
      const variables = (mat.children as any[]).filter((v) => names.has(v.name));
      if (variables.length > 0) repaintVariables(variables);
    };

    const view: DocumentView = { repaintAll: () => void post(), repaintVariables, refreshGallery };
    document.views.add(view);

    // The document's tree when it takes an edit, or null once the view has been told why not:
    // there is no tree, or core opened the file read-only.
    const editableTree = (): any => {
      const mat = treeOrError();
      if (!mat) return null;
      if (mat.readOnly) {
        webview.postMessage({ type: 'error', message: readOnlyNotice(mat) ?? `${name} is read-only.` });
        return null;
      }
      return mat;
    };

    /**
     * Run one gesture through the session, and push what it recorded as one VS Code edit.
     *
     * The gate is core's: a refused gesture records no step, so nothing is pushed and the
     * document stays clean. A file core opened read-only takes nothing at all (the webview
     * offers nothing either; this is the lock behind the door).
     */
    const gesture = (label: string, run: (mat: any) => void, touched: () => Iterable<any> = () => []): Observed | null => {
      if (!editableTree()) return null;
      const observed = document.record(label, run, touched);
      if (observed.error) {
        // Whatever core did before it threw is in the tree, and the table is shown it whole.
        repaintAndReport(`Failed to apply edit: ${document.describe(observed.error)}`);
        return null;
      }
      return observed;
    };

    // A value edit or a rename: core's editProperty, as the Property Inspector of core's own app
    // makes one, with the node selected. A refusal comes back as the cell's validation error, and
    // the variable is repainted from the tree, which the refusal left as it was; so is every edit
    // that did not land, since the table shows what was typed until it is told otherwise.
    const applyEdit = (msg: { rowId: string; columnId: string; oldValue: string; newValue: string }) => {
      const node = findNode(msg.rowId);
      if (!node) {
        repaintAndReport('Could not locate the edited item in the model.');
        return;
      }
      let result: unknown;
      const observed = gesture('Edit ' + msg.columnId, (mat) => {
        DataModel.setActive(mat, node);
        result = DataModel.editProperty(node.id, msg.columnId, msg.newValue, msg.oldValue);
      });
      if (!observed) return;
      const refused = result as { error?: boolean; reason?: string } | boolean;
      if (refused && typeof refused === 'object' && refused.error) {
        webview.postMessage({
          type: 'validationError',
          reason: document.describe(refused.reason),
          invalidValue: msg.newValue,
          previousValue: msg.oldValue,
        });
        putBack(node);
        return;
      }
      if (refused === false) {
        putBack(node, `Could not edit ${msg.columnId} of this item.`);
        return;
      }
      if (msg.columnId === 'Name') webview.postMessage({ type: 'selectRows', rowIds: [node.id] });
    };

    // Delete the rows the gesture named, as ONE edit: the variables in one batch (one step), and
    // each row under a variable on its own (one step each). Nodes are resolved first and each is
    // deleted by the id it has at that moment: an element's id is its index, which the removal of
    // an earlier element moves.
    const applyDelete = (rowIds: readonly string[]) => {
      const nodes = rowIds.map((id) => findNode(id)).filter(Boolean);
      if (nodes.length === 0) {
        webview.postMessage({ type: 'error', message: 'Could not locate the items in the model.' });
        return;
      }
      const mat = document.model();
      const variables = nodes.filter((n) => n.parent === mat);
      const inVariables = (n: any): boolean => {
        for (let p = n.parent; p; p = p.parent) if (variables.includes(p)) return true;
        return false;
      };
      const children = nodes.filter((n) => n.parent !== mat && !inVariables(n));
      // Where the selection lands: the row after the last one removed, else the one before, else
      // its parent.
      const last = nodes[nodes.length - 1];
      const siblings: any[] = last.parent?.children ?? [];
      const doomed = new Set(nodes);
      const at = siblings.indexOf(last);
      const landing =
        siblings.slice(at + 1).find((s) => !doomed.has(s)) ??
        [...siblings.slice(0, at)].reverse().find((s) => !doomed.has(s)) ??
        (last.parent !== mat ? last.parent : null);
      const observed = gesture(
        'Delete',
        () => {
          for (const child of children) if (child.parent) DataModel.deleteNodeById(child.id);
          if (variables.length > 0) DataModel.deleteNodesById(variables.map((v) => v.id));
        },
        () => variables,
      );
      if (!observed) return;
      if (observed.steps === 0) {
        webview.postMessage({ type: 'error', message: 'Nothing was deleted: this file does not let the selected items be removed.' });
        return;
      }
      if (landing && !doomed.has(landing)) webview.postMessage({ type: 'selectRows', rowIds: [landing.id] });
    };

    // Add one variable of the class the gallery's tile names: core's addEntry, which names it (the
    // class's own default name, `var` for a plain variable, with a counter where it is taken) and
    // makes MATLAB's default value of it — the double 0, a struct of no field, or MATLAB's own
    // default object of a Simulink class or a `string`. Then its name editor, unless the gallery is
    // pinned. An add core refuses (a class the file takes no new variable of, a file no save of
    // which can be written, objects no new one can join) adds nothing, and says core's reason.
    const applyAddEntry = (msg: { className?: string; rename: boolean }) => {
      const className = msg.className || 'MatlabVariable';
      let added: any = null;
      let refusal: string | null = null;
      const observed = gesture('Add', (mat) => {
        DataModel.setActiveContext(mat);
        added = DataModel.addEntry('', className);
        if (!added) refusal = (DataModel as any).addEntryRefusal?.() ?? null;
      });
      if (!observed) return;
      if (!added) {
        webview.postMessage({ type: 'error', message: refusal ? document.describe(refusal) : `Could not add a ${tileLabelOf(className)} to ${name}.` });
        return;
      }
      webview.postMessage({ type: 'selectRows', rowIds: [added.id] });
      if (msg.rename) webview.postMessage({ type: 'beginRename', rowId: added.id });
    };

    // A field of a struct, an element of a vector or a cell, where core says the row takes one.
    const applyAddChild = (rowId: string) => {
      const node = findNode(rowId);
      if (!node) {
        webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
        return;
      }
      let child: any = null;
      const observed = gesture('Add child', () => {
        child = DataModel.addChildTo(node.id);
      });
      if (!observed) return;
      if (!child) {
        webview.postMessage({ type: 'error', message: 'This item takes no children.' });
        return;
      }
      webview.postMessage({ type: 'selectRows', rowIds: [child.id] });
    };

    // --- The clipboard and row drags --------------------------------------------------------
    //
    // A variable travels as a dictionary's entry does: its serialize() ({name, metadata: null,
    // value}), snapshotted by the walk every table shares (clipboardAction.ts), which asks core
    // first whether it can travel at all (copyRefusal) and carries it from the file's one section,
    // ''. Core's words come back naming the srcId, so every message is described.
    const copyDeps = (broadcast: () => void) => ({
      refresh: () => void document.model(),
      findNode,
      post: (message: { type: 'error'; message: string }) => webview.postMessage({ ...message, message: document.describe(message.message) }),
      broadcast,
      // A variable's selector is its name alone, so each one taken carries who it was
      // (deleteMoved reads it back before a move takes it out).
      originOf: (variable: any) => document.originOf(variable),
    });

    // Copy or cut: nothing is changed until the cut is pasted (a cut is lazy). A cut of a file that
    // takes no edit could never be completed — its original could not be taken out — so it is
    // refused here, as every edit of one is.
    const applyCopy = (rowIds: readonly string[], mode: 'cut' | 'copy') => {
      if (mode === 'cut' && !editableTree()) return;
      copyEntriesToClipboard(rowIds, mode, uriString, copyDeps(broadcastClipboardState));
    };

    const applyDragStart = (rowIds: readonly string[]) => dragEntries(rowIds, uriString, copyDeps(broadcastDragState));

    const applyDragEnd = () => {
      clearDrag();
      broadcastDragState();
    };

    // --- Paste and drop: the transfer every table runs -----------------------------------------
    //
    // What a paste or a drop MEANS is transfer.ts's: which register, the no-op of a move back into
    // where every item came from — which for a MAT-file is any move within it, the file being one
    // section — and a cross-document move as the paste here and then the delete in the source's
    // own format (editorHub). What is left here is what the edit IS in a MAT-file: core's
    // pasteEntries into this file, all of the entries or none, as ONE undo step, inside a gesture
    // so that it is ONE VS Code edit with the Status column and the repaint every edit has.

    // Thrown by the adapter where the view has already been told why (a gesture reports its own
    // refusals and failures), so that the transfer's failure path says nothing more.
    class Told extends Error {}

    const transferAdapter = (): TransferAdapter<TransferTarget> => ({
      docUri: uriString,
      // One section: a same-file move is always the no-op, so the policy never asks this file to
      // take entries out and paste them in one edit — and refuses, should it ever have to.
      takesRemoveFirst: false,
      // Any row, and no row at all (''), is the file.
      resolveTarget: () => {
        if (!treeOrError()) throw new Told();
        return { sectionName: WHOLE_FILE_SECTION };
      },
      validate: () => {
        const mat = document.model();
        if (mat.readOnly) throw new TransferRefused(readOnlyNotice(mat) ?? `${name} is read-only.`);
      },
      commit: ({ payloads, removeFirst, label }) => {
        // The policy guarantees none (takesRemoveFirst: false); a paste that went on regardless
        // would leave the originals standing beside what it pasted.
        if (removeFirst.length > 0) throw new Error(`a move within ${name} reached its paste`);
        let result: PasteResult | undefined;
        const observed = gesture(
          label,
          () => {
            // Clones, as a dictionary's paste takes (recordCopy: a number JSON has no spelling
            // for stays itself): the register keeps its records for the next paste.
            result = DataModel.pasteEntries(document.srcId, payloads.map((p) => cloneForPaste(p)) as unknown as PastePayload[]);
          },
          () => (result && 'nodes' in result ? result.nodes : []),
        );
        if (!observed) throw new Told();
        // Refused whole by core, in its words: nothing was made, recorded or published.
        if (!result || 'error' in result) throw new TransferRefused(result ? document.describe(result.reason) : `Could not paste into ${name}.`);
        // Selected once their rows arrive: the repaint that brings them is on its way.
        const ids = result.nodes.map((n: any) => n.id);
        if (ids.length > 0) webview.postMessage({ type: 'selectRows', rowIds: ids });
      },
      onFailure: (err) => {
        if (err instanceof Told) return;
        repaintAndReport(`Failed to apply edit: ${document.describe(err)}`);
      },
      report: (message) => void webview.postMessage({ type: 'error', message: document.describe(message) }),
    });
    // A move that left its original behind is said where it stays, not only in the banner a row
    // update clears: see TransferDeps.warn.
    const transferDeps: TransferDeps = {
      deleteFromSource,
      warn: (message) => void vscode.window.showWarningMessage(message),
    };
    const transferred = (run: Promise<unknown>) =>
      void run.catch((err) => repaintAndReport(`Failed to apply edit: ${document.describe(err)}`));

    const applyPaste = (rowId: string) =>
      transferred(runTransfer({ rowId }, clipboardRegister(broadcastClipboardState), transferAdapter(), transferDeps));
    const applyDrop = (msg: { rowId: string; mode: 'copy' | 'move' }) =>
      transferred(runTransfer({ rowId: msg.rowId }, dragRegister(msg.mode, broadcastDragState), transferAdapter(), transferDeps));

    const handle = (msg: TableToHostMessage) => {
      if (msg?.type === 'ready') void post();
      else if (msg?.type === 'select') this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      else if (msg?.type === 'edit') applyEdit(msg);
      else if (msg?.type === 'delete') applyDelete(msg.rowIds);
      else if (msg?.type === 'addEntry') applyAddEntry(msg);
      else if (msg?.type === 'addChild') applyAddChild(msg.rowId);
      else if (msg?.type === 'copy') applyCopy(msg.rowIds, 'copy');
      else if (msg?.type === 'cut') applyCopy(msg.rowIds, 'cut');
      else if (msg?.type === 'paste') applyPaste(msg.rowId);
      else if (msg?.type === 'dragStart') applyDragStart(msg.rowIds);
      else if (msg?.type === 'dragEnd') applyDragEnd();
      else if (msg?.type === 'drop') applyDrop(msg);
      else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target, uriString);
      } else if (msg?.type === 'requestMatrix') {
        answerMatrixRequest(webview, uriString, msg.nodeId);
      } else if (msg?.type === 'requestChildren') {
        // Stamped as the payload was, so a fetched row's menu offers what its siblings' does.
        void answerChildRequest(webview, uriString, msg.nodeId, name, annotateDataRows, planner, stamps());
      } else if (msg?.type === 'undo' || msg?.type === 'redo') void vscode.commands.executeCommand(msg.type);
    };

    // A message that throws is said, as a gesture's throw is, over every row painted again from
    // the tree: whatever it did before it threw is in it, and a cell may still show what was typed.
    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      try {
        handle(msg);
      } catch (err) {
        repaintAndReport(`Failed to handle ${String(msg?.type)} in ${name}: ${document.describe(err)}`);
      }
    });

    // The cross-provider hub: a clipboard broadcast from any table reaches this one (and repaints
    // the mark it carries), and a move whose source is this file, pasted or dropped in another
    // document, takes its originals out of this file through the document (deleteMoved).
    registerWebview(webview, repaintClipMark);
    registerSourceDeleter(uriString, (targets) => document.deleteMoved(targets));
    // The keyboard's Add (dataExplorer.addEntry): the webview adds a variable at once.
    registerAddGalleryView(webviewPanel, () => void webview.postMessage({ type: 'openAddGallery' }));
    const navSub = wireNavigateSelect(webview, uriString);
    // A model created or deleted elsewhere can add or remove a block that uses one of this file's
    // variables, which its own watcher never hears of (usageRepostWatch.ts).
    const usageSub = subscribeUsageRepost(() => void post());

    webview.html = renderTableWebview(webview, distRoot);

    webviewPanel.onDidDispose(() => {
      viewClosed = true;
      document.views.delete(view);
      unregisterWebview(webview);
      unregisterAddGalleryView(webviewPanel);
      // A drag that started in this view and is still on goes with it, so that a drop elsewhere
      // cannot complete against a source no view shows.
      if (getDrag()?.sourceDocUri === uriString) {
        clearDrag();
        broadcastDragState();
      }
      // The deleter is the document's, so it stays while any view of it does.
      if (document.views.size === 0) unregisterSourceDeleter(uriString);
      sub.dispose();
      navSub.dispose();
      usageSub.dispose();
    });
  }

  // --- Save / backup / revert --------------------------------------------------------------

  async saveCustomDocument(document: MatDocument, token: vscode.CancellationToken): Promise<void> {
    // Written again if the stack moved while it was being written, so that VS Code, which calls
    // what the document holds when this resolves saved, is right to (settledSave.ts).
    await saveSettled(document.edits, token, () => this.writeDocument(document));
  }

  /** One write of the document as it stands, the save's own: one round of `saveSettled`. */
  private async writeDocument(document: MatDocument): Promise<void> {
    document.saving = true;
    const before = document.marks.marks();
    let snapshot: SaveSnapshot | undefined;
    try {
      // Before the first await, so the bytes are the document the save was asked for.
      const bytes = document.serialize();
      snapshot = document.marks.snapshot();
      await refuseIfChangedOnDisk(document, MatEditorProvider.viewType, (m) => this.askSaveConflict(m));
      // What a later save and the watcher compare the disk with, read off the written file itself
      // where the write could: a stat after it would take an outside write landing just after
      // for this one. The watcher's event for this write then finds the disk matching.
      document.stamp = (await this.write(document.uri, bytes)) ?? (await stampOf(document.uri));
      document.onDisk = bytes;
    } catch (err) {
      // Nothing was written, so what the snapshot held is never what the file holds.
      if (snapshot) document.marks.release(snapshot);
      throw err;
    } finally {
      document.saving = false;
    }
    document.inConflict = false;
    document.overwriteStamp = undefined;
    document.marks.commit(snapshot);
    // The Status column moved with it, which a paint on its await built before: it builds again.
    document.version++;
    document.repaintMarks(before);
  }

  async saveCustomDocumentAs(document: MatDocument, dest: vscode.Uri, token: vscode.CancellationToken): Promise<void> {
    // Onto the file itself, by its own name or another link to it: that is a save, and has to
    // move the stamp and the marks as one does, or the next save would take its own write for an
    // outside one.
    if (dest.toString() === document.uri.toString() || (await sameFile(dest, document.uri))) {
      return this.saveCustomDocument(document, token);
    }
    await this.write(dest, document.serialize());
  }

  async revertCustomDocument(document: MatDocument, _token: vscode.CancellationToken): Promise<void> {
    // VS Code marks the document clean as it asks for this, without waiting for it. The read
    // comes first, so that the watcher, which reads the dirty-flag copy, does not reload over
    // a revert still reading; the copy is marked clean once the read is in, either way.
    let read: DiskRead;
    try {
      read = await readDisk(document.uri);
    } catch (err) {
      // VS Code shows the document clean, so it must not go on holding the edits it dropped:
      // the tree is put back to the bytes the file held as this document last read or wrote it.
      // A document restored from a backup has none, and keeps its tree.
      this.markReverted(document);
      if (document.onDisk) document.replace({ stamp: document.stamp, bytes: toArrayBuffer(document.onDisk) });
      throw err;
    }
    this.markReverted(document);
    document.replace(read);
  }

  /** A revert also ends a save conflict, as it does for a text file. */
  private markReverted(document: MatDocument): void {
    document.edits.reverted();
    document.inConflict = false;
    document.overwriteStamp = undefined;
  }

  async backupCustomDocument(
    document: MatDocument,
    ctx: vscode.CustomDocumentBackupContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    // The whole file as a save would write it, so a restore opens a MAT-file like any other. A
    // scratch copy VS Code throws away, so written plainly: it is not the user's file.
    let bytes: Uint8Array;
    try {
      bytes = document.serialize();
    } catch (err) {
      // Core refuses to write the tree as it stands, so the save would refuse it too. A restart
      // restores the last state that could be written rather than nothing: the last backup, kept
      // standing. Said once, until a backup succeeds again.
      const kept = document.lastBackup?.alive ? document.lastBackup : undefined;
      if (!document.backupRefusalShown) {
        document.backupRefusalShown = true;
        void vscode.window.showWarningMessage(
          `${(err as Error).message} ${kept ? 'If VS Code restarts now, it restores ' + document.metaPath + ' as it was before the latest edits.' : ''}`.trim(),
        );
      }
      if (!kept) throw err;
      return kept.handle();
    }
    await vscode.workspace.fs.writeFile(ctx.destination, bytes);
    document.backupRefusalShown = false;
    document.lastBackup = new SharedBackup(backupId(ctx.destination, document.stamp), ctx.destination);
    return document.lastBackup.handle();
  }

  /**
   * The user's file, replaced whole where the file system lets us (safeWrite.ts). Answers the
   * stamp the write left, where it could read one.
   */
  private async write(uri: vscode.Uri, bytes: Uint8Array): Promise<DiskStamp | undefined> {
    return (await writeFileSafely(uri, bytes, () => vscode.workspace.fs.writeFile(uri, bytes))).stamp;
  }
}
