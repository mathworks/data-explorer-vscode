// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file editor's document: view's MAT-file engine (data-explorer-view/host `MatEngine`),
// which holds the tree, its edits, its Status column and its saves' rules, with VS Code's end of
// every hook it takes, and what is this extension's own: the file on disk (its stamp, the bytes it
// last held, a save conflict), the hot-exit backup, and the copy of VS Code's dirty flag the disk
// watcher reads.
//
// The hooks: each edit goes onto VS Code's stack (`onDidChangeCustomDocument`), whose Undo and Redo
// are VS Code's commands; the stack's position and save point are an EditStackIndex, the copy of
// VS Code's dirty flag; a notice is a VS Code notification or the status bar; the registers are
// the window's (windowRegisters.ts); the Usage column is the workspace's usage graph.
import * as vscode from 'vscode';
import { DataModel } from 'data-explorer-core';
import { basename, type Notify } from 'data-explorer-view/model';
import { EditStackIndex, MatEngine } from 'data-explorer-view/host';
import type { DiskStamp } from './diskConflict.js';
import type { FollowedDocument } from './diskFollow.js';
import { registers } from './windowRegisters.js';
import { annotateDataRows, annotateDataRowsNow } from './usageGraph.js';

/** One read of the file behind a document, with the stamp it was read under (diskFollow.readStamped). */
export interface DiskRead {
  stamp: DiskStamp | undefined;
  bytes: ArrayBuffer;
}

/** A notice of the engine's, said as VS Code says one: a notification, or the status bar for a while. */
const notify: Notify = (notice) => {
  if (notice.level === 'warning') void vscode.window.showWarningMessage(notice.message);
  else if (notice.level === 'error') void vscode.window.showErrorMessage(notice.message);
  else if (notice.ms === undefined) vscode.window.setStatusBarMessage(notice.message);
  else vscode.window.setStatusBarMessage(notice.message, notice.ms);
};

/**
 * A hot-exit backup VS Code may be handed more than once. The extension host deletes a backup when
 * it is handed the next one, so a backup that is handed on again, because the edit after it could
 * not be written, must survive the delete of its first handle: each handle holds a reference, and
 * the file goes with the last.
 */
export class SharedBackup {
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

export class MatDocument implements vscode.CustomDocument, FollowedDocument {
  /** VS Code's dirty flag, as the stack's position and save point say it (the API gives no way to read it). */
  readonly edits: EditStackIndex;
  stamp: DiskStamp | undefined;
  inConflict = false;
  conflictPromptOpen = false;
  overwriteStamp: DiskStamp | undefined;
  saving = false;
  disposed = false;

  /**
   * The bytes the file holds as this document last read or wrote it, for a revert that cannot read
   * the disk (revertCustomDocument). After a save, the bytes the save wrote. None for a document
   * restored from a backup, which was never the file.
   */
  onDisk: Uint8Array | null;

  /**
   * The last hot-exit backup this document wrote, which a backup that cannot be written keeps
   * standing (backupCustomDocument).
   */
  lastBackup: SharedBackup | undefined;

  /** The tree, its edits and its saves' rules. */
  readonly engine: MatEngine;

  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<MatDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChange.event;
  private readonly disposables: vscode.Disposable[] = [];

  /** `changed`: after every change to the tree, once every view is told (the Property Inspector's). */
  constructor(
    public readonly uri: vscode.Uri,
    bytes: ArrayBuffer,
    fromBackup: boolean,
    changed: () => void,
  ) {
    this.onDisk = fromBackup ? null : new Uint8Array(bytes);
    // VS Code reports a document restored from a hot-exit backup as dirty, though it has no edits,
    // until it is saved or reverted.
    this.edits = new EditStackIndex(fromBackup);
    const uriString = uri.toString();
    this.engine = new MatEngine({
      session: DataModel,
      uri: uriString,
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
      usage: {
        fill: (rows) => annotateDataRows(uriString, rows),
        fillNow: (rows) => void annotateDataRowsNow(uriString, rows),
      },
      appName: 'VS Code',
      changed,
      // Its rows are posted and awaited before what follows them (engineTable.ts).
      trailerAfterDelivery: true,
    });
  }

  get srcId(): string {
    return this.engine.srcId;
  }

  get metaPath(): string {
    return this.engine.metaPath;
  }

  /** Moved by every tree registered from the disk (a revert, a reload). */
  get generation(): number {
    return this.engine.generation;
  }

  /** Moved by every change to the tree and by every save. */
  get version(): number {
    return this.engine.version;
  }

  track(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  /**
   * Make this document hold what `read` found on disk: a revert, or a reload of an outside change.
   * A new tree (the engine's), nothing differing from the file, and nothing left to be in conflict
   * with.
   */
  replace(read: DiskRead): void {
    this.onDisk = new Uint8Array(read.bytes);
    // A backup of the tree that is going is not one of this one.
    this.lastBackup = undefined;
    this.stamp = read.stamp;
    this.inConflict = false;
    this.overwriteStamp = undefined;
    void this.engine.replace(read.bytes);
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.engine.dispose();
    this._onDidChange.dispose();
  }
}
