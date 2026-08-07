// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { renderWebviewHtml } from './webviewHtml.js';
import { getModel, invalidate, findNode } from './SlddModel.js';
import { findEntrySpan, detectIndent } from './entrySplice.js';
import { buildRows, COLUMNS, COLUMN_LABELS } from './rowBuilder.js';
import { captureBaseline, computeModified, clearBaseline } from './slddBaseline.js';
import { setClipboard, getClipboard, clearClipboard, clipboardState } from './clipboard.js';
import {
  deleteEntry,
  deleteChild,
  addChild as addChildEdit,
  pasteEntry,
  findOwningEntry,
  reserializeEntry,
  type StructuralResult,
} from './structuralEdit.js';
import { SECTION_NAMESPACE } from '../dex/datamodel/node/container/SectionNode.js';
import { annotateDataRows } from './usageGraph.js';
import { onNavigateSelect, consumePendingSelect } from './navigate.js';

// Custom editor for EDITABLE JSON .sldd, backed by VS Code's native TextDocument
// (CustomTextEditorProvider). Because every edit is a WorkspaceEdit on that
// TextDocument, undo/redo, dirty state, save, and revert are all handled
// natively by VS Code — a SINGLE undo stack shared with the plain-text view.
// Editing in either the table or the text view live-syncs to the other, and
// Cmd+Z / Cmd+Shift+Z work identically in both.
//
// Binary .sldd / .slx / .mat / .prj are handled by the read-only
// BinaryEditorProvider instead (they can't be opened as text documents).
export class SlddTextEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'dataExplorer.tableView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;

  // Handle a Usage-column link click: open the referenced file and select the
  // target row there (wired in extension.ts to the shared navigate handler).
  public onNavigate?: (target: string) => void;

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
    const name = document.uri.path.split('/').pop() ?? 'document';

    // Capture the on-open baseline once so per-entry "Modified" marks are diffed
    // against the initial content.
    let initialized = false;

    // Rebuild the model from the live TextDocument text and push rows to the
    // webview. Called on open, on every text change (table edits, text-view
    // edits, undo, redo — all arrive here uniformly), and on save. The Usage
    // column is filled asynchronously from the shared workspace usage graph.
    const post = () => {
      try {
        invalidate(uriString);
        const node = getModel(uriString, name, document.getText());
        if (!initialized) {
          captureBaseline(uriString, node);
          initialized = true;
        }
        const modified = computeModified(uriString, node);
        const rows = buildRows(node, modified);
        // Fill the Usage column from the shared usage graph, then post. The graph
        // builds lazily on first use and is cached, so only the very first open in
        // a session pays the scan cost; subsequent posts resolve near-instantly.
        void annotateDataRows(uriString, rows)
          .catch(() => false)
          .then(() => {
            webview.postMessage({
              type: 'setRows',
              rows,
              columns: COLUMNS,
              columnLabels: COLUMN_LABELS,
              editable: true,
            });
            webview.postMessage({ type: 'clipboardState', ...clipboardState() });
            // If a cross-tab navigation targeted this file (e.g. it was just
            // opened by a Usage-link click), select the requested row now.
            const navName = consumePendingSelect(uriString);
            if (navName) webview.postMessage({ type: 'selectByName', name: navName });
          });
      } catch (err) {
        invalidate(uriString);
        webview.postMessage({
          type: 'error',
          message: `Failed to parse ${name}: ${(err as Error).message}`,
        });
      }
    };

    // Apply new full text to the TextDocument via a WorkspaceEdit. This feeds
    // VS Code's native undo stack (so undo/redo + dirty are automatic) and fires
    // onDidChangeTextDocument, which repaints the table and any open text view.
    const replaceAll = async (newText: string): Promise<void> => {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      edit.replace(document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
    };

    // Guard against applying an edit while the text view holds invalid JSON
    // (a mid-edit state). Returns true when the current text parses; otherwise
    // posts an error banner and returns false so the caller can bail.
    const ensureValidJson = (): boolean => {
      try {
        JSON.parse(document.getText());
        return true;
      } catch {
        webview.postMessage({
          type: 'error',
          message:
            "Can't apply edit — the document has invalid JSON (likely mid-edit in the text view). Fix the text, then retry.",
        });
        return false;
      }
    };

    // --- Value edit / rename (byte-scoped entry-span splice) --------------------
    const applyEdit = async (msg: {
      rowId: string;
      columnId: string;
      oldValue: string;
      newValue: string;
    }): Promise<void> => {
      try {
        if (!ensureValidJson()) return;
        const currentText = document.getText();

        invalidate(uriString);
        getModel(uriString, name, currentText);
        const node = findNode(uriString, msg.rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: 'Could not locate the edited item in the model.' });
          return;
        }

        // Owning top-level entry; pre-edit name for span lookup (rename mutates it).
        const entry = findOwningEntry(node);
        if (!entry) {
          webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
          return;
        }
        const entryNameForLookup: string = entry.name;
        const isRename = msg.columnId === 'Name';

        const result = node.setProperty(msg.columnId, msg.newValue);
        if (result && typeof result === 'object' && result.error) {
          // Invalid cell input: show the dex error dialog inside the webview
          // (scoped to the table view, not a window-blocking native modal),
          // then repaint so the cell reverts from the rejected text back to
          // its previous value.
          webview.postMessage({
            type: 'validationError',
            reason: result.reason,
            invalidValue: msg.newValue,
            previousValue: msg.oldValue,
          });
          post();
          return;
        }
        // After a rename node.id reflects the new name — re-select that row once
        // the rebuilt rows arrive.
        const newSelectId: string | null = isRename ? node.id : null;

        const indent = detectIndent(currentText);
        const entryText = reserializeEntry(entry, indent);

        const span = findEntrySpan(currentText, entryNameForLookup);
        if (!span) {
          webview.postMessage({ type: 'error', message: 'Could not locate the entry text to update.' });
          return;
        }

        // Byte-scoped range replace: only the edited entry's span changes, so
        // sibling entries stay byte-identical. Native undo groups this edit.
        const startPos = document.positionAt(span.offset);
        const endPos = document.positionAt(span.offset + span.length);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(startPos, endPos), entryText);
        await vscode.workspace.applyEdit(edit);
        // onDidChangeTextDocument repaints (setRows preserves expansion +
        // selection). For a rename, re-select by the new id.
        if (newSelectId) webview.postMessage({ type: 'selectRow', rowId: newSelectId });
      } catch (err) {
        invalidate(uriString);
        webview.postMessage({ type: 'error', message: 'Failed to apply edit: ' + (err as Error).message });
      }
    };

    // --- Copy (read-only; snapshots the entry into the host clipboard) ----------
    const applyCopy = (msg: { rowId: string }, mode: 'cut' | 'copy'): boolean => {
      try {
        const currentText = document.getText();
        invalidate(uriString);
        getModel(uriString, name, currentText);
        const node = findNode(uriString, msg.rowId);
        if (!node) return false;
        const entry = findOwningEntry(node);
        if (!entry) return false;
        const payload = entry.serialize() as Record<string, unknown>;
        const sectionName: string = entry.parent?.name ?? '';
        setClipboard(payload, mode, sectionName);
        webview.postMessage({ type: 'clipboardState', ...clipboardState() });
        return true;
      } catch {
        return false;
      }
    };

    // --- Shared skeleton for structural mutations (delete/addChild/paste) -------
    // Guards JSON validity, refreshes the model from live text, locates the node,
    // runs the pure transform, and applies the result as a WorkspaceEdit (native
    // undo/redo). Repaint + reselect happen via onDidChangeTextDocument.
    const applyStructural = async (
      rowId: string,
      transform: (currentText: string, node: any, model: any) => StructuralResult,
    ): Promise<void> => {
      try {
        if (!ensureValidJson()) return;
        const currentText = document.getText();

        invalidate(uriString);
        const model = getModel(uriString, name, currentText);
        const node = findNode(uriString, rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
          return;
        }

        const { newText, selectId } = transform(currentText, node, model);
        await replaceAll(newText);
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    // Delete transform: a top-level entry drops its array element; a nested
    // child is removed from its parent and the owning entry is reserialized.
    const deleteTransform = (text: string, node: any): StructuralResult =>
      node.isEntry ? deleteEntry(text, node) : deleteChild(text, node);

    const applyDelete = (msg: { rowId: string }): Promise<void> =>
      applyStructural(msg.rowId, deleteTransform);

    const applyAddChild = (msg: { rowId: string }): Promise<void> =>
      applyStructural(msg.rowId, (text, node) => addChildEdit(text, node));

    // Cut = copy the node, then delete it. Native undo coalesces? No — two
    // WorkspaceEdits would be two undo steps; here copy makes no text change, so
    // cut is exactly one text edit (the delete) = one undo step.
    const applyCut = async (msg: { rowId: string }): Promise<void> => {
      if (!applyCopy(msg, 'cut')) {
        webview.postMessage({ type: 'error', message: 'Could not cut the selected item.' });
        return;
      }
      await applyStructural(msg.rowId, deleteTransform);
    };

    // --- Location in Text (reveal the row's entry in the plain-text view) -------
    // Resolve the right-clicked row to its owning top-level entry, locate that
    // entry's `{...}` span in the live JSON, then open the native text editor and
    // reveal the span. Nested children (struct fields, bus elements) have no
    // standalone JSON span, so we fall back to their owning entry's object — the
    // same entry-scoped granularity every other structural operation uses.
    const applyLocateInText = async (msg: { rowId: string }): Promise<void> => {
      try {
        const currentText = document.getText();
        invalidate(uriString);
        getModel(uriString, name, currentText);
        const node = findNode(uriString, msg.rowId);
        if (!node) {
          webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' });
          return;
        }
        const entry = findOwningEntry(node);
        if (!entry) {
          webview.postMessage({ type: 'error', message: 'Could not locate the owning entry in the model.' });
          return;
        }
        const span = findEntrySpan(currentText, entry.name);
        if (!span) {
          webview.postMessage({ type: 'error', message: `Could not locate "${entry.name}" in the text.` });
          return;
        }
        const startPos = document.positionAt(span.offset);
        const endPos = document.positionAt(span.offset + span.length);
        // showTextDocument opens the native text editor (same view as
        // "View as Text") beside the table and selects the entry's span,
        // scrolling it into view. A second tab for the same URI is expected —
        // table and text coexist (see the viewAsText note in extension.ts).
        await vscode.window.showTextDocument(document, {
          selection: new vscode.Range(startPos, endPos),
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to locate in text: ${(err as Error).message}` });
      }
    };

    const applyPaste = (msg: { rowId: string }): Promise<void> =>
      applyStructural(msg.rowId, (text, node) => {
        const clip = getClipboard();
        if (!clip) throw new Error('the clipboard is empty');
        const entry = findOwningEntry(node);
        const section = entry?.parent;
        if (!section) throw new Error('Could not resolve the target section.');
        const namespace: string | undefined = SECTION_NAMESPACE[section.name];
        const result = pasteEntry(text, section, clip.payload, namespace);
        if (clip.mode === 'cut') {
          clearClipboard();
          webview.postMessage({ type: 'clipboardState', ...clipboardState() });
        }
        return result;
      });

    // --- Message wiring ---------------------------------------------------------
    const sub = webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        post();
      } else if (msg?.type === 'select') {
        this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      } else if (msg?.type === 'edit') {
        void applyEdit(msg);
      } else if (msg?.type === 'copy') {
        applyCopy(msg, 'copy');
      } else if (msg?.type === 'delete') {
        void applyDelete(msg);
      } else if (msg?.type === 'addChild') {
        void applyAddChild(msg);
      } else if (msg?.type === 'cut') {
        void applyCut(msg);
      } else if (msg?.type === 'paste') {
        void applyPaste(msg);
      } else if (msg?.type === 'locateInText') {
        void applyLocateInText(msg);
      } else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target);
      } else if (msg?.type === 'undo' || msg?.type === 'redo') {
        // Single native stack: the table view is the active editor when its menu
        // is used, so this targets the shared TextDocument undo history.
        void vscode.commands.executeCommand(msg.type);
      }
    });

    // Live cross-tab selection: if a navigation targets THIS already-open file,
    // select the row immediately (the just-opened case is drained in post()).
    // Consume the pending entry too, so it can't re-fire on a later repaint.
    const navSub = onNavigateSelect((e) => {
      if (e.uri !== uriString) return;
      consumePendingSelect(uriString);
      webview.postMessage({ type: 'selectByName', name: e.name });
    });

    // Repaint on ANY change to this document: table edits, text-view edits, undo,
    // and redo all arrive here. setRows (webview side) preserves expansion and
    // re-applies selection, so the tree doesn't collapse under the user.
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === uriString) {
        post();
      }
    });

    // On save, re-capture the baseline so per-row "Modified" marks clear.
    const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() === uriString) {
        invalidate(uriString);
        try {
          captureBaseline(uriString, getModel(uriString, name, doc.getText()));
        } catch {
          /* leave baseline as-is on parse failure */
        }
        post();
      }
    });

    // The editor/title "View as Text" toggle is gated on the built-in
    // `activeCustomEditorId == dataExplorer.tableView` context key (set
    // automatically by VS Code), so no custom context key is needed here.

    webview.html = this.getHtml(webview, distRoot);
    webviewPanel.onDidDispose(() => {
      sub.dispose();
      changeSub.dispose();
      saveSub.dispose();
      navSub.dispose();
      clearBaseline(uriString);
    });
  }

  private getHtml(webview: vscode.Webview, distRoot: vscode.Uri): string {
    return renderWebviewHtml(webview, distRoot, {
      scriptFile: 'table.js',
      title: 'Data Explorer',
      body: `    <div id="dex-error" role="alert" style="display:none;color:var(--vscode-errorForeground,#f14c4c);padding:8px;font-family:var(--vscode-font-family,sans-serif);"></div>
    <dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>
    <dex-context-menu></dex-context-menu>
    <dex-error-dialog></dex-error-dialog>`,
    });
  }
}
