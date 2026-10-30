// Copyright 2026 The MathWorks, Inc.
//
// Writable custom editor for MAT-files (`-v6` and `-v7`, the Level-5 files core reads and writes),
// on view's MAT-file engine (data-explorer-view/host `MatEngine`; matDocument.ts). The user's
// baseline for it: a save never breaks the file. The engine holds two of the three things that
// keep it, and none of them is this module's own judgement of a value:
//
//  - Every edit is made through core's session, whose gate offers no edit a save of the file would
//    refuse or write as something else, and whose undo and redo are the only undo and redo there
//    are. VS Code's edit stack is mapped onto core's: one gesture, one VS Code edit.
//  - A save is `session.serializeSource`: the file as it was read, every variable nobody edited as
//    its own bytes, what was edited written fresh, self-checked before any byte is handed back. A
//    refusal fails the save with core's words, writes nothing and leaves the document dirty.
//  - The bytes reach the disk by a replace (safeWrite.ts): a temporary file beside the original,
//    flushed, renamed over it, so a crash part-way through cannot leave half a file. That, the save
//    conflict, the disk watcher, the hot-exit backup and the webview are this module's.
//
// Each panel is one of the engine's tables, posted as this editor has always posted it
// (engineTable.ts), and the messages the webview sends are answered as every table view answers
// them (tableDispatch.ts) or handed to the table's own commands.
import * as vscode from 'vscode';
import { answerMatrixRequest, type MatSave } from 'data-explorer-view/host';
import { renderTableWebview } from './webviewHtml.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import { subscribeUsageRepost } from './usageRepostWatch.js';
import { registerAddGalleryView, unregisterAddGalleryView } from './editorHub.js';
import { OVERWRITE, REVERT } from './diskConflict.js';
import { followDisk, readForOpen, readStamped, refuseIfChangedOnDisk, watchDisk, writeUserFile } from './diskFollow.js';
import { saveSettled } from './settledSave.js';
import { sameFile } from './safeWrite.js';
import { backupId } from './backupId.js';
import { toArrayBuffer } from '../common/bytes.js';
import type { TableToHostMessage } from '../common/protocol.js';
import { describeSource } from './refusal.js';
import { dispatchCommon, type CommonHandlers } from './tableDispatch.js';
import { engineTable, matRows } from './engineTable.js';
import { MatDocument, SharedBackup, type DiskRead } from './matDocument.js';

async function readDisk(uri: vscode.Uri): Promise<DiskRead> {
  const { stamp, bytes } = await readStamped(uri);
  return { stamp, bytes: toArrayBuffer(bytes) };
}

export class MatEditorProvider implements vscode.CustomEditorProvider<MatDocument> {
  public static readonly viewType = 'dataExplorer.matView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;
  // Handle a Usage-column link click (wired in extension.ts).
  public onNavigate?: (target: string, referrer?: string) => void;
  // A document's tree changed: a gesture, a move out of it, an undo or a redo, a revert or a reload
  // (wired in extension.ts, which shows the Property Inspector's node again from the tree, if it
  // is this document's).
  public onChanged?: (uriString: string) => void;

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
    // document, held to the stamp the backup recorded (diskFollow.readForOpen).
    const { stamp, bytes } = await readForOpen(uri, openContext.backupId);
    const doc = new MatDocument(uri, toArrayBuffer(bytes), !!openContext.backupId, () => this.onChanged?.(uri.toString()));
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
    const describe = describeSource(document.srcId, name);

    const table = document.engine.view();
    const panel = engineTable(table, webview, {
      name,
      setRows: matRows,
      // The padlock the read-only view wears, only where this one is read-only too.
      onRows: (view) => void (webviewPanel.iconPath = view.notice ? new vscode.ThemeIcon('lock') : undefined),
      afterPaint: () => drainNavigateSelect(webview, uriString),
    });

    // Every row painted again from the tree, and then `message` shown: in that order, as a paint
    // clears the error banner (the repaint resolves once its trailer is posted).
    const repaintAndReport = (message: string) => {
      void table
        .repaintAll()
        .then(() => webview.postMessage({ type: 'error', message }))
        .then(undefined, () => false);
    };

    // The messages every table view answers alike (tableDispatch.ts), keyed by message type.
    const common: CommonHandlers = {
      ready: () => panel.ready(),
      select: (rowIds) => this.onSelect?.(uriString, rowIds),
      navigate: (target) => this.onNavigate?.(target, uriString),
      requestMatrix: (nodeId) => answerMatrixRequest(webview, uriString, nodeId),
      // A Value editor is opening on a summary: its whole text.
      requestEditText: (rowId) => table.requestEditText?.(rowId),
      // Stamped as the payload was, so a fetched row's menu offers what its siblings' does.
      requestChildren: (nodeId) => panel.children(nodeId),
      undo: () => void vscode.commands.executeCommand('undo'),
      redo: () => void vscode.commands.executeCommand('redo'),
    };

    // This editor's own: its edits, the clipboard and row drags, each the table's command.
    const handle = (msg: TableToHostMessage) => {
      if (msg?.type === 'edit') table.edit?.(msg);
      else if (msg?.type === 'delete') table.delete?.(msg.rowIds);
      else if (msg?.type === 'addEntry') table.addEntry?.(msg);
      else if (msg?.type === 'addChild') table.addChild?.(msg.rowId);
      else if (msg?.type === 'copy') table.copy?.(msg.rowIds);
      else if (msg?.type === 'cut') table.cut?.(msg.rowIds);
      else if (msg?.type === 'paste') table.paste?.(msg.rowId);
      else if (msg?.type === 'dragStart') table.dragStart?.(msg.rowIds);
      else if (msg?.type === 'dragEnd') table.dragEnd?.();
      else if (msg?.type === 'drop') table.drop?.(msg.rowId, msg.mode);
    };

    // A message that throws is said, as a gesture's throw is, over every row painted again from
    // the tree: whatever it did before it threw is in it, and a cell may still show what was typed.
    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      try {
        if (!dispatchCommon(msg, common)) handle(msg);
      } catch (err) {
        repaintAndReport(`Failed to handle ${String(msg?.type)} in ${name}: ${describe(err instanceof Error ? err.message : String(err))}`);
      }
    });

    // The keyboard's Add (dataExplorer.addEntry): the webview adds a variable at once.
    registerAddGalleryView(webviewPanel, () => void webview.postMessage({ type: 'openAddGallery' }));
    const navSub = wireNavigateSelect(webview, uriString);
    // A model created or deleted elsewhere can add or remove a block that uses one of this file's
    // variables, which its own watcher never hears of (usageRepostWatch.ts).
    const usageSub = subscribeUsageRepost(() => void table.repaintAll());

    webview.html = renderTableWebview(webview, distRoot);

    webviewPanel.onDidDispose(() => {
      panel.dispose();
      // Its registers, its drag and, with the last table, the document's source deleter.
      table.dispose();
      unregisterAddGalleryView(webviewPanel);
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
    let save: MatSave | undefined;
    try {
      // Before the first await, so the bytes are the document the save was asked for.
      save = document.engine.beginSave();
      await refuseIfChangedOnDisk(document, MatEditorProvider.viewType, (m) => this.askSaveConflict(m));
      // What a later save and the watcher compare the disk with, read off the written file itself
      // where the write could: a stat after it would take an outside write landing just after
      // for this one. The watcher's event for this write then finds the disk matching. The one
      // write of the user's file both byte-backed editors make (diskFollow.writeUserFile).
      document.stamp = await writeUserFile(document.uri, save.bytes);
      document.onDisk = save.bytes;
    } catch (err) {
      // Nothing was written, so the Status column stays measured from the last save.
      if (save) document.engine.notSaved(save);
      throw err;
    } finally {
      document.saving = false;
    }
    document.inConflict = false;
    document.overwriteStamp = undefined;
    // The Status column is measured from what was written, and the rows it moved are repainted.
    document.engine.saved(save);
  }

  async saveCustomDocumentAs(document: MatDocument, dest: vscode.Uri, token: vscode.CancellationToken): Promise<void> {
    // Onto the file itself, by its own name or another link to it: that is a save, and has to
    // move the stamp and the marks as one does, or the next save would take its own write for an
    // outside one.
    if (dest.toString() === document.uri.toString() || (await sameFile(dest, document.uri))) {
      return this.saveCustomDocument(document, token);
    }
    await writeUserFile(dest, document.engine.serialize());
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
    // scratch copy VS Code throws away, so written plainly: it is not the user's file. Where core
    // refuses to write the tree as it stands, a restart restores the last state that could be
    // written rather than nothing: the last backup, kept standing (the engine says so, once).
    const kept = document.lastBackup?.alive ? document.lastBackup : undefined;
    let bytes: Uint8Array;
    try {
      bytes = document.engine.backup(!!kept);
    } catch (err) {
      if (!kept) throw err;
      return kept.handle();
    }
    await vscode.workspace.fs.writeFile(ctx.destination, bytes);
    document.engine.backupWritten();
    document.lastBackup = new SharedBackup(backupId(ctx.destination.toString(), document.stamp), ctx.destination);
    return document.lastBackup.handle();
  }
}
