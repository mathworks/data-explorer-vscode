// Copyright 2026 The MathWorks, Inc.
//
// Writable custom editor for COMPRESSED-BINARY (zip/XML) .sldd files, on view's binary dictionary
// engine (data-explorer-view/host `BinaryEngine`; binaryDocument.ts). A binary .sldd is an OPC/zip
// package whose only editable text payload is data/chunk0.xml; all other parts pass through
// verbatim. Every table edit is a pure string transform on that chunk, replacing only the touched
// entry's <Object>…</Object> with what core writes for it, so untouched entries stay byte-identical;
// undo and redo restore the chunk text and rebuild the entries they change from it.
//
// The save gate is the engine's, and a refusal leaves the file on disk untouched: it re-reads the
// chunk and refuses one that does not read back, and it holds the chunk to the chunk as last read or
// saved, entry by entry (core's binarySaveGate): an entry no edit changed must be its bytes, and an
// edited one must keep every part the edit did not change.
//
// What stays here is VS Code's end of each of the engine's hooks and what is this extension's own:
// the file on disk (its stamp, a save conflict, the watcher), the save's sequence (saveSettled),
// the hot-exit backup, the hand-back of a JSON .sldd to the default view, the webview, and the
// messages every table answers alike. Each panel is one of the engine's tables, posted as this editor
// has always posted it (engineTable.ts).
import * as vscode from 'vscode';
import type { TableView } from 'data-explorer-view/model';
import { answerMatrixRequest, type BinarySave } from 'data-explorer-view/host';
import { renderTableWebview } from './webviewHtml.js';
import { isZipBytes } from './slddFormat.js';
import { registerAddGalleryView, unregisterAddGalleryView } from './editorHub.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import type { TableToHostMessage } from '../common/protocol.js';
import { dispatchCommon, type CommonHandlers } from './tableDispatch.js';
import { OVERWRITE, REVERT, type DiskStamp } from './diskConflict.js';
import { saveSettled } from './settledSave.js';
import { followDisk, readForOpen, readStamped, refuseIfChangedOnDisk, watchDisk, writeUserFile } from './diskFollow.js';
import { backupId } from './backupId.js';
import { sameFile } from './safeWrite.js';
import { engineTable } from './engineTable.js';
import { BinarySlddDocument } from './binaryDocument.js';

// viewType of the default byte-backed view (BinaryEditorProvider), which owns the rule
// that picks an editor from a .sldd's bytes. A constant here rather than an import,
// because importing that provider would be circular — the same reason it spells this
// provider's viewType out as a constant of its own.
const BINARY_VIEW_TYPE = 'dataExplorer.binaryView';

/** One read of the file behind a document, with the stamp it was read under (diskFollow.readStamped). */
interface DiskRead {
  stamp: DiskStamp | undefined;
  bytes: Uint8Array;
}

/** A whole paint's rows, as this editor's `post()` spelled its `setRows`: no notice, no gallery list. */
const binaryRows = (view: TableView) => ({
  type: 'setRows',
  docUri: view.docUri,
  rows: view.rows,
  columns: view.columns,
  columnLabels: view.columnLabels,
  columnGroups: view.columnGroups,
  editable: view.editable,
  warnings: view.warnings,
});

export class BinarySlddEditorProvider implements vscode.CustomEditorProvider<BinarySlddDocument> {
  public static readonly viewType = 'dataExplorer.binarySlddView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;
  // Handle a Usage-column link click (wired in extension.ts).
  public onNavigate?: (target: string, referrer?: string) => void;
  // A document's tree changed: an edit, an undo or a redo, a save, a revert or a reload (wired in
  // extension.ts, which shows the Property Inspector's node again from the tree, if it is this
  // document's).
  public onChanged?: (uriString: string) => void;

  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  /**
   * Ask the user about a save refused because the file changed on disk, and resolve with
   * the button they chose. A property so that the integration suite, which cannot click a
   * notification, can answer for them.
   *
   * An error notification, because VS Code shows its own version of this prompt as one.
   */
  askSaveConflict: (message: string) => Thenable<string | undefined> = (message) =>
    vscode.window.showErrorMessage(message, OVERWRITE, REVERT);

  /**
   * Write the user's file, and answer the stamp the write left (diskFollow.writeUserFile). A
   * property so that the integration suite can hold a save's write, as a slow disk holds one.
   */
  writeUserFile: (uri: vscode.Uri, bytes: Uint8Array) => Promise<DiskStamp | undefined> = writeUserFile;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<BinarySlddDocument> {
    // A hot-exit backup is a whole .sldd (backupCustomDocument), so a restore opens it as the
    // document, held to the stamp the backup recorded; otherwise the file's own, taken before the
    // read (diskFollow.readForOpen, the MAT-file editor's too).
    const { stamp, bytes } = await readForOpen(uri, openContext.backupId);
    // A custom editor's selector is a filename glob, and the two .sldd formats are not
    // distinguishable by name — so "Reopen Editor With…" offers THIS view for every
    // *.sldd, including a JSON one, which has nothing to unzip.
    //
    // Answer it the way the default view answers the mirror case, by handing the file
    // back rather than by classifying it here: `resolveCustomEditor` reopens it with
    // `dataExplorer.binaryView`, which owns the one format-to-editor rule. Deciding
    // "JSON ⇒ the table view" locally would be that rule's second copy, and would get
    // the over-the-sync-limit dictionary wrong — the default view keeps that one
    // read-only, because the text-backed table cannot resolve it at all.
    //
    // Restoring a hot-exit backup reaches here too, and a backup is always a zip, so it takes
    // the normal path.
    if (!isZipBytes(bytes)) return new BinarySlddDocument(uri, null, false, () => {});
    // A zip with no dictionary in it throws here, as it always has: no document is opened.
    const doc = new BinarySlddDocument(uri, bytes, !!openContext.backupId, () => this.onChanged?.(uri.toString()));
    doc.stamp = stamp;
    // Relay the document's edit events to the provider-level emitter VS Code listens on.
    doc.onDidChangeCustomDocument((e) => this._onDidChangeCustomDocument.fire(e));
    doc.track(this.watchDisk(doc));
    return doc;
  }

  /**
   * Follow the file on disk, the way VS Code follows a text file it has open (diskFollow.ts,
   * shared with the MAT-file editor): reload a clean document from what the disk now holds,
   * as a revert does, and leave unsaved edits alone. Bytes that are no dictionary change nothing.
   */
  private watchDisk(document: BinarySlddDocument): vscode.Disposable {
    return watchDisk(document, () =>
      followDisk(document, () => readStamped(document.uri), (read: DiskRead) => document.replace(read.stamp, read.bytes)),
    );
  }

  async resolveCustomEditor(
    document: BinarySlddDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Not a zip, so not ours — see the misroute guard in openCustomDocument. Reopen with
    // the default byte-backed view, which routes on the bytes, and dispose THIS panel so
    // only the tab that cannot render the file goes away.
    if (document.misrouted) {
      await vscode.commands.executeCommand('vscode.openWith', document.uri, BINARY_VIEW_TYPE);
      webviewPanel.dispose();
      return;
    }

    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    webviewPanel.iconPath = new vscode.ThemeIcon('table');
    const uriString = document.uri.toString();
    const name = document.metaPath;

    const table = document.engine.view();
    // Posted as this editor's post() posted a paint: the rows, then in the same run what follows
    // them, then the Usage link's selection to drain.
    const panel = engineTable(table, webview, {
      name,
      awaitRows: false,
      setRows: binaryRows,
      afterPaint: () => drainNavigateSelect(webview, uriString),
    });

    // The messages every table view answers alike (tableDispatch.ts), keyed by message type.
    const common: CommonHandlers = {
      ready: () => panel.ready(),
      select: (rowIds) => this.onSelect?.(uriString, rowIds),
      navigate: (target) => this.onNavigate?.(target, uriString),
      // A Variable Editor panel is opening: send its cells. One shared answer for all four
      // webview hosts — see matrixRequest.ts.
      requestMatrix: (nodeId) => answerMatrixRequest(webview, uriString, nodeId),
      // A Value editor is opening on a summary: its whole text, read off the live tree.
      requestEditText: (rowId) => table.requestEditText?.(rowId),
      // A row the payload deferred is being opened: the rows under it, unfilled and unstamped, as
      // its siblings are.
      requestChildren: (nodeId) => panel.children(nodeId),
      undo: () => void vscode.commands.executeCommand('undo'),
      redo: () => void vscode.commands.executeCommand('redo'),
    };

    // This editor's own: its edits, the clipboard and row drags, each the table's command.
    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (dispatchCommon(msg, common)) return;
      if (msg?.type === 'edit') table.edit?.(msg);
      else if (msg?.type === 'copy') table.copy?.(msg.rowIds);
      else if (msg?.type === 'cut') table.cut?.(msg.rowIds);
      else if (msg?.type === 'delete') table.delete?.(msg.rowIds);
      else if (msg?.type === 'addChild') table.addChild?.(msg.rowId);
      else if (msg?.type === 'paste') table.paste?.(msg.rowId);
      else if (msg?.type === 'addEntry') table.addEntry?.(msg);
      else if (msg?.type === 'dragStart') table.dragStart?.(msg.rowIds);
      else if (msg?.type === 'dragEnd') table.dragEnd?.();
      else if (msg?.type === 'drop') table.drop?.(msg.rowId, msg.mode);
    });

    // So the Add-gallery keybinding, which has no view of its own to act on, can open this one's
    // gallery when this is the panel the user is looking at.
    registerAddGalleryView(webviewPanel, () => void webview.postMessage({ type: 'openAddGallery' }));
    const navSub = wireNavigateSelect(webview, uriString);

    webview.html = renderTableWebview(webview, distRoot);

    webviewPanel.onDidDispose(() => {
      panel.dispose();
      // Its registers and its drag, and with the last table the document's source deleter and its
      // Status column's baseline.
      table.dispose();
      unregisterAddGalleryView(webviewPanel);
      sub.dispose();
      navSub.dispose();
    });
  }

  // --- Save / backup / revert (the safety gate is the engine's) ---

  async saveCustomDocument(document: BinarySlddDocument, token: vscode.CancellationToken): Promise<void> {
    // Written again if the stack moved while it was being written (settledSave.ts).
    await saveSettled(document.edits, token, () => this.writeDocument(document));
  }

  /** One write of the document as it stands, the save's own: one round of `saveSettled`. */
  private async writeDocument(document: BinarySlddDocument): Promise<void> {
    // The gate and the zip run before the first await, so the text gated and zipped is the text
    // the document held when the save was called; an edit landing on the awaits below goes into
    // the next save, as its text does. The disk check runs after them, right before the write,
    // so the gap a change can slip through is as small as it can be.
    document.saving = true;
    let save: BinarySave | undefined;
    try {
      save = document.engine.beginSave();
      await refuseIfChangedOnDisk(document, BinarySlddEditorProvider.viewType, (m) => this.askSaveConflict(m));
      // What a later save and the watcher compare the disk with, read off the written file
      // itself where the write could: a stat after it would take an outside write landing just
      // after for this one, and the next save would write over that without asking. The
      // watcher's event for this write then finds the disk matching, and ignores it.
      document.stamp = await this.writeUserFile(document.uri, save.bytes);
    } catch (err) {
      // Nothing was written, so the edits it took are unsaved again.
      if (save) document.engine.notSaved(save);
      throw err;
    } finally {
      document.saving = false;
    }
    document.inConflict = false;
    document.overwriteStamp = undefined;
    // What the next save is held to: the text this one wrote. Then the Status column's baseline
    // from it, and every row painted from the tree the save registered.
    document.engine.saved(save);
  }

  async saveCustomDocumentAs(
    document: BinarySlddDocument,
    dest: vscode.Uri,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // Onto the file itself, by its own name or another link to it: that is a save, and has to
    // move the stamp, the save gate's chunk and the dirty flag as one does, or the next save
    // would take its own write for an outside one. As the MAT-file editor's Save As.
    if (dest.toString() === document.uri.toString() || (await sameFile(dest, document.uri))) {
      return this.saveCustomDocument(document, token);
    }
    // Gated as a save is; nothing of the document moves.
    await this.writeUserFile(dest, document.engine.serialize());
  }

  async revertCustomDocument(document: BinarySlddDocument, _token: vscode.CancellationToken): Promise<void> {
    // VS Code marks the document clean as it asks for this, without waiting for it. The read
    // comes first, so that the watcher, which reads the dirty-flag copy, does not reload over
    // a revert still reading; the copy is marked clean once the read is in, either way. As the
    // MAT-file editor's revert. A revert also ends a save conflict, as it does for a text file,
    // whether or not its read succeeds.
    //
    // The file is gone, or is no dictionary: VS Code shows the document clean, so it must not go on
    // holding the edits it dropped. It is put back to the file as it last read or wrote it, under
    // the stamp it already holds, so that a save still asks about a file that changed. The error
    // says why to VS Code, which shows it.
    let read: DiskRead;
    try {
      read = await readStamped(document.uri);
    } catch (err) {
      document.edits.reverted();
      document.revertToSaved();
      throw err;
    }
    document.edits.reverted();
    try {
      document.replace(read.stamp, read.bytes);
    } catch (err) {
      document.revertToSaved();
      throw err;
    }
  }

  async backupCustomDocument(
    document: BinarySlddDocument,
    ctx: vscode.CustomDocumentBackupContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    // Ungated, at the zip's fastest level: VS Code asks for a hot-exit backup about a second after
    // every edit to a dirty custom document, and a backup is a scratch copy of what the editor
    // already holds, which the save gate proves again before the user's file is touched.
    await vscode.workspace.fs.writeFile(ctx.destination, document.engine.backup());
    return {
      // With the stamp of the file these edits were made over, which a restore's first save
      // compares the file with (backupId.ts).
      id: backupId(ctx.destination.toString(), document.stamp),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(ctx.destination);
        } catch {
          /* already gone */
        }
      },
    };
  }
}
