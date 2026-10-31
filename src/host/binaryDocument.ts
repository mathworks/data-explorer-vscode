// Copyright 2026 The MathWorks, Inc.
//
// The compressed dictionary editor's document: view's binary dictionary engine
// (data-explorer-view/host `BinaryEngine`), which holds the chunk, the pass-through parts, the
// edits, the save gate and the Status column's baseline, with VS Code's end of every hook it takes,
// and what is this extension's own: the file on disk (its stamp, a save conflict), and the copy of
// VS Code's dirty flag the disk watcher reads.
//
// The hooks are the MAT-file editor's (matDocument.ts): each edit onto VS Code's stack, its Undo and
// Redo VS Code's commands, the stack's position and save point an EditStackCopy, a notice a
// notification, and the window's registers (windowRegisters.ts). No Usage column: this editor
// fills none.
import * as vscode from 'vscode';
import { DataModel } from 'data-explorer-core';
import { basename, type Notify } from 'data-explorer-view/model';
import { BinaryEngine, binaryEditSrcId } from 'data-explorer-view/host';
import type { DiskStamp } from './diskConflict.js';
import type { FollowedDocument } from './diskFollow.js';
import { EditStackCopy } from './settledSave.js';
import { registers } from './windowRegisters.js';

/** A notice of the engine's, said as VS Code says one (the binary engine says only a transfer's warning). */
const notify: Notify = (notice) => {
  if (notice.level === 'warning') void vscode.window.showWarningMessage(notice.message);
  else if (notice.level === 'error') void vscode.window.showErrorMessage(notice.message);
  else if (notice.ms === undefined) vscode.window.setStatusBarMessage(notice.message);
  else vscode.window.setStatusBarMessage(notice.message, notice.ms);
};

export class BinarySlddDocument implements vscode.CustomDocument, FollowedDocument {
  /** VS Code's dirty flag, as the stack's position and save point say it (the API gives no way to read it). */
  readonly edits: EditStackCopy;
  stamp: DiskStamp | undefined;
  /**
   * A save was refused because the file changed on disk, and nothing has resolved that yet; a
   * later save, auto-save included, does not ask again unless `promptsForConflict` says so.
   */
  inConflict = false;
  conflictPromptOpen = false;
  /** The outside version the user answered Overwrite for, which a save writes over without asking. */
  overwriteStamp: DiskStamp | undefined;
  /** A save is in flight. The watcher waits, so it never reloads in the middle of one. */
  saving = false;
  disposed = false;

  /**
   * The chunk, the parts, the edits and the save gate. None for a document whose bytes are not a
   * zip (`misrouted`): `resolveCustomEditor` hands the file back to the default view before
   * anything reads it.
   */
  private readonly binary: BinaryEngine | null;

  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChange.event;
  private readonly disposables: vscode.Disposable[] = [];

  /** `changed`: after every repaint of the document, once its views are painted (the Property Inspector's). */
  constructor(
    public readonly uri: vscode.Uri,
    bytes: Uint8Array | null,
    fromBackup: boolean,
    changed: () => void,
  ) {
    // VS Code reports a document restored from a hot-exit backup as dirty, though it has no edits,
    // until it is saved or reverted.
    this.edits = new EditStackCopy(fromBackup);
    this.binary = bytes
      ? new BinaryEngine({
          session: DataModel,
          uri: uri.toString(),
          name: basename(uri.path) || 'document',
          bytes,
          sink: {
            push: (edit) => this._onDidChange.fire({ document: this, label: edit.label, undo: edit.undo, redo: edit.redo }),
            undo: () => void vscode.commands.executeCommand('undo'),
            redo: () => void vscode.commands.executeCommand('redo'),
          },
          index: this.edits,
          registers,
          notify,
          changed,
          // Its rows are posted, and what follows them in the same run (engineTable.ts).
          trailerAfterDelivery: true,
        })
      : null;
  }

  /** Whether the bytes behind this document are not a zip, so this editor is the wrong one for them. */
  get misrouted(): boolean {
    return this.binary === null;
  }

  /** The engine; never asked of a misrouted document, which no table is opened on. */
  get engine(): BinaryEngine {
    if (!this.binary) throw new Error(`${this.metaPath} is not a compressed dictionary.`);
    return this.binary;
  }

  get srcId(): string {
    return this.binary?.srcId ?? binaryEditSrcId(this.uri.toString());
  }

  /** The `meta.path` the source is registered with: the file's name, decoded (see BinaryEngine). */
  get metaPath(): string {
    return basename(this.uri.path) || 'document';
  }

  // What the extension's integration suites read and do to the document behind its tables, as
  // they did before this editor moved onto view's engine: through its seam for them
  // (BinaryEngine.forTests), never anything else here.
  get chunkXml(): string {
    return this.engine.chunkXml;
  }
  set chunkXml(xml: string) {
    this.engine.forTests.setChunk(xml);
  }
  get zipMeta(): Readonly<Record<string, Uint8Array>> {
    return this.engine.parts;
  }
  get views(): BinaryEngine['forTests']['views'] {
    return this.engine.forTests.views;
  }
  pushEdit(...edit: Parameters<BinaryEngine['forTests']['pushEdit']>): void {
    this.engine.forTests.pushEdit(...edit);
  }
  resetParts(members: Record<string, Uint8Array>): void {
    this.engine.forTests.resetParts(members);
  }
  repaintAll(): void {
    this.engine.repaintAll();
  }
  /** The entries the Status column marks Modified in `node`, against the document's baseline. */
  modified(node?: unknown): Set<string> {
    return this.engine.forTests.modified(node);
  }

  track(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  /**
   * Make this document hold `bytes`, what the disk holds now (a revert, or the watcher's reload),
   * read under `stamp`. Throws, changing nothing, for bytes that are not a dictionary.
   */
  replace(stamp: DiskStamp | undefined, bytes: Uint8Array): void {
    this.engine.replace(bytes);
    this.disked(stamp);
  }

  /**
   * Put the document back to the file as it last read or wrote it, under the stamp it already
   * holds: a revert that could not read the disk.
   */
  revertToSaved(): void {
    this.engine.revertToSaved();
    this.disked(this.stamp);
  }

  // The document now holds what is on disk, so there is nothing left to be in conflict with.
  private disked(stamp: DiskStamp | undefined): void {
    this.stamp = stamp;
    this.inConflict = false;
    this.overwriteStamp = undefined;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables.splice(0)) d.dispose();
    if (this.binary) this.binary.dispose();
    else DataModel.removeDataSource(this.srcId);
    this._onDidChange.dispose();
  }
}
