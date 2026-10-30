// Copyright 2026 The MathWorks, Inc.
//
// Custom editor for EDITABLE JSON .sldd, backed by VS Code's native TextDocument
// (CustomTextEditorProvider), on view's JSON dictionary engine (data-explorer-view/host `JsonEngine`;
// jsonDocument.ts). Because every edit is a WorkspaceEdit on that TextDocument, undo/redo, dirty
// state, save, and revert are all handled natively by VS Code — a SINGLE undo stack shared with the
// plain-text view. Editing in either the table or the text view live-syncs to the other, and
// Cmd+Z / Cmd+Shift+Z work identically in both.
//
// The tables are the engine's: their paints, the narrow repaints that keep them in step with every
// change of the text, their gestures and the Status column's baseline. What stays here is this
// extension's own: the webview, the messages every table answers alike, "Location in Text"'s
// reveal of the text editor beside the table, and the Add gallery's keybinding. Each panel is one
// of the engine's tables, posted as this editor has always posted it (engineTable.ts).
//
// Binary .sldd / .slx / .mat / .prj are handled by the read-only
// BinaryEditorProvider instead (they can't be opened as text documents).
import * as vscode from 'vscode';
import { basename } from 'data-explorer-view/model';
import { answerMatrixRequest } from 'data-explorer-view/host';
import { renderTableWebview } from './webviewHtml.js';
import { registerAddGalleryView, unregisterAddGalleryView } from './editorHub.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import type { TableToHostMessage } from '../common/protocol.js';
import { describeSource } from './refusal.js';
import { dispatchCommon, type CommonHandlers } from './tableDispatch.js';
import { engineTable, jsonRows } from './engineTable.js';
import { openJsonTable } from './jsonDocument.js';

export class SlddTextEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'dataExplorer.tableView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;

  // Handle a Usage-column link click: open the referenced file and select the
  // target row there (wired in extension.ts to the shared navigate handler).
  public onNavigate?: (target: string, referrer?: string) => void;

  /**
   * Called after every repaint of a document, wide or narrow, once the rows are posted: the
   * Property Inspector's node is found again in the tree as it now is (wired in extension.ts to
   * the same refresh the other two editors' hooks call).
   *
   * At the repaints, because every change to the document ends in one: a table edit (its paint),
   * its echo, an undo or a redo, a keystroke in the text view, a save, a revert and a reload. That
   * is keystroke rate, and it is meant to be: the inspector's page is sent a node only when it
   * changes what the page shows (inspectorPage.ts), so a keystroke elsewhere costs it nothing.
   */
  public onChanged?: (uriString: string) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };

    // Give the table tab a distinct table glyph instead of VS Code's default
    // JSON `{}` icon (which the plain-text view of the same .sldd also shows, so
    // the two tabs would otherwise be indistinguishable). Reuse the built-in
    // `$(table)` codicon — the same icon as the "View as Table" toolbar button —
    // so it tracks the theme's icon color automatically.
    webviewPanel.iconPath = new vscode.ThemeIcon('table');

    const uriString = document.uri.toString();
    const name = basename(document.uri.path) || 'document';
    // Core's messages name this source by its id (the uri string), which every message shown here
    // spells as the file's name.
    const describe = describeSource(uriString, name);

    // This tab's table of the document, which says each of its repaints to this provider's hook.
    const { table, close } = openJsonTable(document, name, () => this.onChanged?.(uriString));
    // Posted as this editor's post() posted a paint: the rows, then in the same run what follows
    // them, then the Usage link's selection to drain. The webview's `ready` opens the table.
    const panel = engineTable(table, webview, {
      name,
      awaitRows: false,
      setRows: jsonRows,
      afterPaint: () => drainNavigateSelect(webview, uriString),
    });

    // --- Location in Text (reveal the row's entry in the plain-text view) -------
    // The engine resolves the right-clicked row to its owning top-level entry and that entry's
    // `{...}` span in the live JSON, and says in the table why it cannot; this opens the native
    // text editor and reveals the span. Nested children (struct fields, bus elements) have no
    // standalone JSON span, so they fall back to their owning entry's object.
    const applyLocateInText = async (msg: { rowId: string }): Promise<void> => {
      const span = table.locateInText(msg.rowId);
      if (!span) return;
      try {
        // showTextDocument opens the native text editor (same view as
        // "View as Text") beside the table and selects the entry's span,
        // scrolling it into view. A second tab for the same URI is expected —
        // table and text coexist (see the viewAsText note in extension.ts).
        await vscode.window.showTextDocument(document, {
          selection: new vscode.Range(document.positionAt(span.offset), document.positionAt(span.offset + span.length)),
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to locate in text: ${describe((err as Error).message)}` });
      }
    };

    // --- Message wiring ---------------------------------------------------------
    // The messages every table view answers alike (tableDispatch.ts), keyed by message type.
    const common: CommonHandlers = {
      ready: () => panel.ready(),
      select: (rowIds) => this.onSelect?.(uriString, rowIds),
      navigate: (target) => this.onNavigate?.(target, uriString),
      // A Variable Editor panel is opening: send its cells. One shared answer for all four
      // webview hosts — see matrixRequest.ts.
      requestMatrix: (nodeId) => answerMatrixRequest(webview, uriString, nodeId),
      // A Value editor is opening on a summary: its whole text, read off the tree the text says.
      requestEditText: (rowId) => table.requestEditText?.(rowId),
      // A row the payload deferred is being opened: send the rows under it, through postOrReport.
      requestChildren: (nodeId) => panel.children(nodeId),
      // Single native stack: the table view is the active editor when its menu is used, so
      // these target the shared TextDocument undo history.
      undo: () => void vscode.commands.executeCommand('undo'),
      redo: () => void vscode.commands.executeCommand('redo'),
    };

    // This editor's own: its edits, the clipboard and row drags, each the table's command (the
    // structural ones one text state at a time, which the table sees to), and Location in Text.
    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (dispatchCommon(msg, common)) return;
      if (msg?.type === 'edit') table.edit?.(msg);
      else if (msg?.type === 'copy') table.copy?.(msg.rowIds);
      else if (msg?.type === 'delete') table.delete?.(msg.rowIds);
      else if (msg?.type === 'addChild') table.addChild?.(msg.rowId);
      else if (msg?.type === 'cut') table.cut?.(msg.rowIds);
      else if (msg?.type === 'paste') table.paste?.(msg.rowId);
      else if (msg?.type === 'addEntry') table.addEntry?.(msg);
      else if (msg?.type === 'dragStart') table.dragStart?.(msg.rowIds);
      else if (msg?.type === 'dragEnd') table.dragEnd?.();
      else if (msg?.type === 'drop') table.drop?.(msg.rowId, msg.mode);
      else if (msg?.type === 'locateInText') void applyLocateInText(msg);
    });

    // Register the keyboard's way into the Add gallery. The command (dataExplorer.addEntry)
    // has no view of its own to act on, so each editable view says here how to open its
    // gallery, and the hub picks the one whose panel is active.
    registerAddGalleryView(webviewPanel, () => void webview.postMessage({ type: 'openAddGallery' }));
    const navSub = wireNavigateSelect(webview, uriString);

    // The editor/title "View as Text" toggle is gated on the built-in
    // `activeCustomEditorId == dataExplorer.tableView` context key (set
    // automatically by VS Code), so no custom context key is needed here.

    webview.html = this.getHtml(webview, distRoot);
    webviewPanel.onDidDispose(() => {
      // First, so nothing still in flight is posted to this view from here on.
      panel.dispose();
      // Its registers, its drag, its listeners and its hold on the tree; with the LAST tab of this
      // document its source deleter and its baseline (see jsonDocument.ts).
      close();
      unregisterAddGalleryView(webviewPanel);
      sub.dispose();
      navSub.dispose();
    });
  }

  private getHtml(webview: vscode.Webview, distRoot: vscode.Uri): string {
    return renderTableWebview(webview, distRoot);
  }
}
