// Copyright 2026 The MathWorks, Inc.
//
// Writable custom editor for MAT-files (`-v6` and `-v7`, the Level-5 files core reads and
// writes). The user's baseline for it: a save never breaks the file. Three things hold that up,
// and none of them is this module's own judgement of a value:
//
//  - Every edit is made through core's session (editProperty, addEntry, addChildTo,
//    deleteNode(s)ById), whose gate offers no edit a save of the file would refuse or write as
//    something else (MatNode._editRefusal), and whose undo and redo are the only undo and redo
//    there are. A gesture core refuses records no step and changes nothing.
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
import { DataModel } from 'data-explorer-core';
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
import { refuseIfUnreadable, sourceWarnings, warningBanner } from './parseWarnings.js';
import { postOrReport } from './postPayload.js';
import { clearDrag, getDrag } from './dragState.js';
import { broadcastDragState, registerAddGalleryView, unregisterAddGalleryView } from './editorHub.js';
import { EditStackMirror, OVERWRITE, REVERT, type DiskStamp } from './diskConflict.js';
import { followDisk, refuseIfChangedOnDisk, stampOf, watchDisk, type FollowedDocument } from './diskFollow.js';
import { SaveMarks, type SaveMark } from './saveMarks.js';
import { writeFileSafely } from './safeWrite.js';
import { binaryEditSrcId } from '../common/srcId.js';
import { basename } from '../common/pathUtil.js';
import { toArrayBuffer } from '../common/bytes.js';
import type { TableToHostMessage } from '../common/protocol.js';

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
  /** The variables before the gesture, each with the row id the table spells it by. */
  before: Map<any, string>;
  order: any[];
}

function observe(mat: any, srcId: string, run: () => void): Observed {
  const before = new Map<any, string>();
  for (const v of mat.children) before.set(v, v.id);
  const observed: Observed = { steps: 0, touched: new Set(), added: new Set(), before, order: [...mat.children] };
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
  } finally {
    for (const s of subs) s.remove();
  }
  return observed;
}

/** Whether a gesture changed which variables the file holds, or their order. */
function variablesMoved(mat: any, observed: Observed): boolean {
  const now = mat.children as any[];
  return now.length !== observed.order.length || now.some((v, i) => v !== observed.order[i]);
}

/** One open view of a document: the two ways the document asks it to repaint. */
interface DocumentView {
  /** Every row, from the tree as it stands. */
  repaintAll(): void;
  /** The rows of these variables, each spliced over the run the table holds by `before`'s id. */
  repaintVariables(variables: Iterable<any>, before?: ReadonlyMap<any, string>): void;
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

  /** Moved by every change to the tree, so a paint that awaited can tell it is stale. */
  version = 0;

  /** Which variables differ from the file as last saved, for the Status column. */
  readonly marks = new SaveMarks<any>();

  readonly views = new Set<DocumentView>();

  /** The file's bytes, until the first paint registers them (`model`). */
  private bytes: ArrayBuffer | null;
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
   * srcId it was registered under, and core quotes that name (`Cannot save "binedit:file:///…"`).
   */
  describe(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return message.split(`"${this.srcId}"`).join(`"${this.metaPath}"`);
  }

  /**
   * The file as a save writes it, or an Error saying why it cannot be written (core's refusal),
   * in which case nothing is written anywhere. Synchronous, so the bytes are the document as
   * the save was asked for: an edit that lands while they are being written stays unsaved.
   */
  serialize(): Uint8Array {
    this.model();
    let out: ReturnType<typeof DataModel.serializeSource>;
    try {
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
    const mark = this.marks.push([...observed.touched, ...touched], observed.added);
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
    for (const view of [...this.views]) view.repaintVariables(present, observed.before);
  }

  /** Repaint the variables whose Status changed between two answers of `marks`. */
  repaintMarks(before: ReadonlyMap<any, SaveMark>): void {
    const after = this.marks.marks();
    const changed = new Set<any>();
    for (const [v, m] of before) if (after.get(v) !== m) changed.add(v);
    for (const [v, m] of after) if (before.get(v) !== m) changed.add(v);
    if (changed.size === 0) return;
    for (const view of [...this.views]) view.repaintVariables(changed);
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
    this.loaded = null;
    this.generation++;
    this.version++;
    this.marks.clear();
    this.stamp = read.stamp;
    this.inConflict = false;
    this.overwriteStamp = undefined;
    this.repaintAll();
  }

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
 */
function staleEdit(name: string, what: 'undone' | 'redone'): void {
  vscode.window.setStatusBarMessage(
    `${name} was reloaded from disk since this edit was made, so it cannot be ${what}.`,
    5000,
  );
}

export class MatEditorProvider implements vscode.CustomEditorProvider<MatDocument> {
  public static readonly viewType = 'dataExplorer.matView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;
  // Handle a Usage-column link click (wired in extension.ts).
  public onNavigate?: (target: string, referrer?: string) => void;

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
    // document; the stamp is the FILE's, since the file is what a save will write over.
    const source = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri;
    const stamp = await stampOf(uri);
    const bytes = toArrayBuffer(await vscode.workspace.fs.readFile(source));
    const doc = new MatDocument(uri, bytes, !!openContext.backupId);
    doc.stamp = stamp;
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

    // The rows of the whole file, with the Status column measured from the last save.
    const build = (mat: any) => {
      const planned = planner.payload(mat, LAZY_ROW_BUDGET, { savedStatus: document.marks.marks() });
      return { planned, version: document.version };
    };

    const post = async (): Promise<void> => {
      let mat: any;
      try {
        mat = document.model();
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to parse ${name}: ${document.describe(err)}` });
        return;
      }
      try {
        let built = build(mat);
        // The Usage column, as the read-only view fills it. Awaited only here: an edit's repaint
        // fills it from the graph this built (annotateDataRowsNow).
        await annotateDataRows(uriString, built.planned.rows).catch(() => false);
        if (document.disposed) return;
        // An edit landed while the graph was being built: these rows are from before it.
        if (built.version !== document.version) {
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
            // A MAT-file adds a variable, not an entry of a class picked from the gallery.
            add: 'variable',
            // Nor does it copy, cut, paste or drag one: a variable has no dictionary entry form.
            clipboard: false,
            warnings: lazyRowsBanner(built.planned.plan, warningBanner(sourceWarnings(mat))),
          },
          name,
        );
        drainNavigateSelect(webview, uriString);
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to show ${name}: ${(err as Error).message}` });
      }
    };

    // One variable's rows, spliced over the run the table holds for it.
    const repaintVariables = (variables: Iterable<any>, before?: ReadonlyMap<any, string>) => {
      try {
        const saved = document.marks.marks();
        for (const v of variables) {
          const rows = buildMatVariableRows(v, LAZY_ROW_BUDGET, saved);
          annotateDataRowsNow(uriString, rows);
          webview.postMessage({ type: 'updateEntryRows', entryRowId: before?.get(v) ?? v.id, rows });
        }
      } catch (err) {
        void post();
        webview.postMessage({ type: 'error', message: `Failed to update the row: ${(err as Error).message}` });
      }
    };

    const view: DocumentView = { repaintAll: () => void post(), repaintVariables };
    document.views.add(view);

    /**
     * Run one gesture through the session, and push what it recorded as one VS Code edit.
     *
     * The gate is core's: a refused gesture records no step, so nothing is pushed and the
     * document stays clean. A file core opened read-only takes nothing at all (the webview
     * offers nothing either; this is the lock behind the door).
     */
    const gesture = (label: string, run: (mat: any) => void, touched: () => Iterable<any> = () => []): Observed | null => {
      let mat: any;
      try {
        mat = document.model();
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to parse ${name}: ${document.describe(err)}` });
        return null;
      }
      if (mat.readOnly) {
        webview.postMessage({ type: 'error', message: readOnlyNotice(mat) ?? `${name} is read-only.` });
        return null;
      }
      let observed: Observed;
      try {
        observed = observe(mat, document.srcId, () => run(mat));
      } catch (err) {
        // Whatever core did before it threw is in the tree, and the table is shown it whole.
        document.version++;
        void post();
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${document.describe(err)}` });
        return null;
      }
      if (observed.steps > 0) document.pushEdit(label, observed, touched());
      document.repaint(observed);
      return observed;
    };

    // A value edit or a rename: core's editProperty, as the Property Inspector of core's own app
    // makes one, with the node selected. A refusal comes back as the cell's validation error, and
    // the variable is repainted from the tree, which the refusal left as it was.
    const applyEdit = (msg: { rowId: string; columnId: string; oldValue: string; newValue: string }) => {
      const node = findNode(msg.rowId);
      if (!node) {
        webview.postMessage({ type: 'error', message: 'Could not locate the edited item in the model.' });
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
        // Put the cell back: the table shows what was typed until it is told otherwise.
        for (let v = node; v; v = v.parent) {
          if (v.parent === document.model()) {
            repaintVariables([v]);
            break;
          }
        }
        return;
      }
      if (refused === false) {
        webview.postMessage({ type: 'error', message: `Could not edit ${msg.columnId} of this item.` });
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

    // Add one variable: core names it `var` (then `var1`, …) and makes it the double 0, the only
    // value a MAT-file's Add takes. Then its name editor, as the gallery's add opens it.
    const applyAddEntry = (msg: { rename: boolean }) => {
      let added: any = null;
      const observed = gesture('Add', (mat) => {
        DataModel.setActiveContext(mat);
        added = DataModel.addEntry('', 'MatlabVariable');
      });
      if (!observed) return;
      if (!added) {
        webview.postMessage({ type: 'error', message: `Could not add a variable to ${name}.` });
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

    // The clipboard and row drags carry a dictionary's entries, which a MAT-file's variables are
    // not: the view offers none of them (`clipboard: false`), and says so if one arrives anyway.
    const noClipboard = (what: string) =>
      webview.postMessage({ type: 'error', message: `${what} is not available in a MAT-file.` });

    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (msg?.type === 'ready') void post();
      else if (msg?.type === 'select') this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      else if (msg?.type === 'edit') applyEdit(msg);
      else if (msg?.type === 'delete') applyDelete(msg.rowIds);
      else if (msg?.type === 'addEntry') applyAddEntry(msg);
      else if (msg?.type === 'addChild') applyAddChild(msg.rowId);
      else if (msg?.type === 'copy' || msg?.type === 'cut' || msg?.type === 'paste') noClipboard('Copy and paste');
      else if (msg?.type === 'dragStart') noClipboard('Dragging rows');
      else if (msg?.type === 'dragEnd') {
        // Nothing to end: no drag starts here.
      } else if (msg?.type === 'drop') {
        // A drag from a dictionary, let go over this table. It ends here, as any drop does.
        if (getDrag()) {
          clearDrag();
          broadcastDragState();
        }
        noClipboard('Dropping rows');
      } else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target, uriString);
      } else if (msg?.type === 'requestMatrix') {
        answerMatrixRequest(webview, uriString, msg.nodeId);
      } else if (msg?.type === 'requestChildren') {
        void answerChildRequest(webview, uriString, msg.nodeId, name, annotateDataRows, planner);
      } else if (msg?.type === 'undo' || msg?.type === 'redo') void vscode.commands.executeCommand(msg.type);
    });

    // The keyboard's Add (dataExplorer.addEntry): the webview adds a variable at once.
    registerAddGalleryView(webviewPanel, () => void webview.postMessage({ type: 'openAddGallery' }));
    const navSub = wireNavigateSelect(webview, uriString);
    // A model created or deleted elsewhere can add or remove a block that uses one of this file's
    // variables, which its own watcher never hears of (usageRepostWatch.ts).
    const usageSub = subscribeUsageRepost(() => void post());

    webview.html = renderTableWebview(webview, distRoot);

    webviewPanel.onDidDispose(() => {
      document.views.delete(view);
      unregisterAddGalleryView(webviewPanel);
      sub.dispose();
      navSub.dispose();
      usageSub.dispose();
    });
  }

  // --- Save / backup / revert --------------------------------------------------------------

  async saveCustomDocument(document: MatDocument, _token: vscode.CancellationToken): Promise<void> {
    const at = document.edits.here();
    document.saving = true;
    const before = document.marks.marks();
    let snapshot: ReturnType<SaveMarks<any>['snapshot']>;
    try {
      // Before the first await, so the bytes are the document the save was asked for.
      const bytes = document.serialize();
      snapshot = document.marks.snapshot();
      await refuseIfChangedOnDisk(document, MatEditorProvider.viewType, (m) => this.askSaveConflict(m));
      await this.write(document.uri, bytes);
      // What a later save and the watcher compare the disk with. The watcher's event for this
      // write then finds the disk matching, and ignores it.
      document.stamp = await stampOf(document.uri);
    } finally {
      document.saving = false;
    }
    document.edits.saved(at);
    document.inConflict = false;
    document.overwriteStamp = undefined;
    document.marks.commit(snapshot);
    document.repaintMarks(before);
  }

  async saveCustomDocumentAs(document: MatDocument, dest: vscode.Uri, _token: vscode.CancellationToken): Promise<void> {
    await this.write(dest, document.serialize());
  }

  async revertCustomDocument(document: MatDocument, _token: vscode.CancellationToken): Promise<void> {
    // VS Code marks the document clean as it asks for this, without waiting for it, so the
    // dirty-flag copy is clean from here too. A revert also ends a save conflict, as it does
    // for a text file, whether or not the read below succeeds.
    document.edits.reverted();
    document.inConflict = false;
    document.overwriteStamp = undefined;
    document.replace(await readDisk(document.uri));
  }

  async backupCustomDocument(
    document: MatDocument,
    ctx: vscode.CustomDocumentBackupContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    // The whole file as a save would write it, so a restore opens a MAT-file like any other. A
    // scratch copy VS Code throws away, so written plainly: it is not the user's file.
    await vscode.workspace.fs.writeFile(ctx.destination, document.serialize());
    return {
      id: ctx.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(ctx.destination);
        } catch {
          /* already gone */
        }
      },
    };
  }

  /** The user's file, replaced whole where the file system lets us (safeWrite.ts). */
  private async write(uri: vscode.Uri, bytes: Uint8Array): Promise<void> {
    await writeFileSafely(uri, bytes, () => vscode.workspace.fs.writeFile(uri, bytes));
  }
}
