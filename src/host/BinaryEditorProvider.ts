// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { renderWebviewHtml } from './webviewHtml.js';
import { getModelFromBytes, getProjectModel, invalidate } from './SlddModel.js';
import {
  buildRows,
  COLUMNS,
  COLUMN_LABELS,
  PROJECT_COLUMNS,
  PROJECT_COLUMN_LABELS,
} from './rowBuilder.js';
import { buildMatRows } from './matRowBuilder.js';
import { readProjectStore } from './projectStore.js';
import { isEditableJsonSlddBytes, exceedsTextSyncLimit, exceedsStringDecodeLimit, isZipBytes } from './slddFormat.js';
import { annotateDataRows, annotateModelRows } from './usageGraph.js';
import { wireNavigateSelect, consumePendingSelect } from './navigate.js';
import { basename } from '../common/pathUtil.js';
import { toArrayBuffer } from '../common/bytes.js';
import type { TableToHostMessage } from '../common/protocol.js';

// viewType of the editable text-backed table (SlddTextEditorProvider). Declared
// here as a constant to avoid importing the provider (which would be circular).
const TABLE_VIEW_TYPE = 'dataExplorer.tableView';

// Custom document. Read-only for all binary formats (.slx, .mat, .prj, zipped
// .sldd). There is NO in-memory working-copy string: the file on disk is the
// single source of truth, and this document only tracks its URI.
class BinaryDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}

  dispose(): void {}
}

// Single byte-backed READ-ONLY custom editor for the binary formats (.slx,
// .mat, .prj, zipped .sldd). Byte-backed so it can open binary (zip) .sldd —
// which VS Code refuses to open as a text document because of NUL bytes.
// Editable JSON .sldd is handled by SlddTextEditorProvider; binary/zip .sldd is
// routed here via an explicit openWith redirect in extension.ts.
export class BinaryEditorProvider implements vscode.CustomReadonlyEditorProvider<BinaryDocument> {
  public static readonly viewType = 'dataExplorer.binaryView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;

  // Handle a Usage-column link click: open the referenced file and select the
  // target row there (wired in extension.ts to the shared navigate handler).
  public onNavigate?: (target: string) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<BinaryDocument> {
    return new BinaryDocument(uri);
  }

  async resolveCustomEditor(
    document: BinaryDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };

    const uriString = document.uri.toString();
    const name = basename(document.uri.path) || 'document';

    // A read-only banner shown above the table. Set only for the surprising case:
    // a JSON .sldd that WOULD be editable but is over VS Code's TextDocument sync
    // limit (see below). Binary/zip .sldd — expected read-only — leave this unset
    // so no banner appears. Passed to the webview in the setRows payload.
    let notice: string | undefined;

    // This byte-backed editor is the DEFAULT for *.sldd because it can open any
    // bytes (binary/zip .sldd fail to load as a TextDocument, so the text-backed
    // tableView can't be the default). But editable JSON .sldd should open in the
    // editable tableView. When one lands here (e.g. an Explorer double-click),
    // redirect it: reopen with tableView and close this binary tab. Binary/zip
    // .sldd and .slx/.mat/.prj fall through and render read-only as normal.
    if (name.endsWith('.sldd')) {
      try {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        // A JSON .sldd larger than V8's string limit (~512 MB) can't be decoded
        // into a string at all — so neither the editable table nor the read-only
        // table can parse it, and it would open as a silent empty table. Hand
        // such a file to VS Code's built-in text editor (it streams large files
        // without materializing one giant string). A zip .sldd this large still
        // falls through to the read-only binary view — it parses the archive
        // without decoding the whole thing to a string.
        if (exceedsStringDecodeLimit(bytes) && !isZipBytes(bytes)) {
          await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          webviewPanel.dispose();
          return;
        }
        // Editable JSON .sldd redirects to the text-backed table view — BUT only
        // when VS Code can actually mirror it as a TextDocument. Over the sync
        // limit, the tableView provider can't resolve (the ext host throws
        // "Unable to retrieve document from URI"), so keep such files here and
        // render them read-only. See exceedsTextSyncLimit in slddFormat.ts.
        if (isEditableJsonSlddBytes(bytes) && !exceedsTextSyncLimit(bytes)) {
          // Carry the incoming tab's preview state through the redirect: an
          // Explorer single-click opens this binary tab as a PREVIEW tab, and the
          // table it redirects to should stay a preview tab too (not pin). VS
          // Code's `vscode.openWith` hardcodes `pinned: true` and ignores a lone
          // `preview: true` (microsoft/vscode#235535), so pass an explicit
          // `pinned` to override it — `pinned` isn't on the public options type
          // but is forwarded to the internal IEditorOptions.
          const preview = this.isPanelPreview(document.uri);
          await vscode.commands.executeCommand('vscode.openWith', document.uri, TABLE_VIEW_TYPE, {
            preview,
            pinned: !preview,
          });
          // Dispose THIS panel specifically (not closeActiveEditor, which is
          // racy) so only the redundant binary tab goes away.
          webviewPanel.dispose();
          return;
        }
        // A JSON .sldd that stayed here (not redirected) did so ONLY because it's
        // over the sync limit — otherwise it would be editable. That's surprising
        // (a JSON dictionary the user expects to edit), so explain the read-only
        // downgrade. Binary/zip .sldd skips this (isEditableJsonSlddBytes false).
        if (isEditableJsonSlddBytes(bytes)) {
          const mb = Math.round(bytes.byteLength / (1024 * 1024));
          notice =
            `Read-only: this dictionary is ${mb} MB, above VS Code's 50 MB editing limit. ` +
            `To edit the JSON directly, use "Reopen Editor With… → Text Editor"; ` +
            `this view refreshes when you save.`;
        }
      } catch {
        // Unreadable → fall through and let the read-only render report the error.
      }
      // Binary/zip .sldd renders read-only here (editable JSON was redirected and
      // disposed above). Give its tab the same 'table' icon the editable-JSON .sldd
      // tab uses (SlddTextEditorProvider), so both .sldd forms look consistent.
      webviewPanel.iconPath = new vscode.ThemeIcon('table');
    }

    // Source bytes for the file, always read from disk (read-only view).
    const readBytes = async (): Promise<ArrayBuffer> => {
      return toArrayBuffer(await vscode.workspace.fs.readFile(document.uri));
    };

    // If a cross-tab navigation targeted this file (e.g. it was just opened by a
    // Usage-link click), select the requested row now that rows exist.
    const drainNavSelect = (): void => {
      const navName = consumePendingSelect(uriString);
      if (navName) webview.postMessage({ type: 'selectByName', name: navName });
    };

    // Read/parse the file host-side and push rows to the webview. On failure,
    // drop the cached model and post a banner.
    const post = async () => {
      try {
        if (name.endsWith('.prj')) {
          // The .prj is an empty marker; the project structure lives in the
          // sibling resources/project/** store, read into a project-root-
          // relative POSIX relpath map for the parser.
          const files = await readProjectStore(document.uri);
          const node = getProjectModel(uriString, name, files);
          const rows = buildRows(node);
          webview.postMessage({
            type: 'setRows',
            rows,
            columns: PROJECT_COLUMNS,
            columnLabels: PROJECT_COLUMN_LABELS,
            editable: false,
          });
          drainNavSelect();
          return;
        }

        // Re-parse from disk. The file doesn't change here, but invalidate is
        // harmless and keeps the cache honest against external edits.
        invalidate(uriString);

        const ab = await readBytes();
        const node = getModelFromBytes(uriString, name, ab);
        const rows = name.endsWith('.mat') ? buildMatRows(node) : buildRows(node);
        // Fill the Usage column from the shared workspace usage graph (lazy +
        // cached). A model (.slx) resolves its blocks' params to source files
        // and its workspace vars to the blocks that use them; a .mat/.sldd data
        // view resolves its variables to the blocks that use them.
        if (name.endsWith('.slx')) {
          await annotateModelRows(uriString, rows).catch(() => false);
        } else if (name.endsWith('.mat') || name.endsWith('.sldd')) {
          await annotateDataRows(uriString, rows).catch(() => false);
        }
        webview.postMessage({
          type: 'setRows',
          rows,
          columns: COLUMNS,
          columnLabels: COLUMN_LABELS,
          editable: false,
          notice,
        });
        drainNavSelect();
      } catch (err) {
        invalidate(uriString);
        webview.postMessage({
          type: 'error',
          message: `Failed to parse ${name}: ${(err as Error).message}`,
        });
      }
    };

    // Register listeners BEFORE assigning webview.html, so a fast-booting
    // webview cannot post 'ready' before we are subscribed to receive it.
    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (msg?.type === 'ready') {
        void post();
      } else if (msg?.type === 'select') {
        // Relay the selection to the Property Inspector via the wired callback.
        this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      } else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target);
      }
    });

    // Live cross-tab selection: if a navigation targets THIS already-open file,
    // select the row immediately (the just-opened case is drained in post()).
    const navSub = wireNavigateSelect(webview, uriString);

    // Live-sync when the file on disk changes: covers external edits AND edits
    // made in the plain-text view once saved. We watch the DISK, not the
    // TextDocument, on purpose: a JSON .sldd routed here is over VS Code's 50 MB
    // sync limit, so the ext host holds no mirror of it and
    // onDidChangeTextDocument NEVER fires for it (the same limit that forced the
    // read-only downgrade — see slddFormat.ts). A FileSystemWatcher observes the
    // disk directly, independent of document syncing, so it fires on save at any
    // size. Because this view always reads bytes from disk, unsaved edits can't
    // be reflected anyway — refresh-on-save is the achievable contract, and the
    // banner tells the user so.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), name),
    );
    const onDiskChange = () => {
      invalidate(uriString);
      void post();
    };
    const changeSub = watcher.onDidChange(onDiskChange);
    const createSub = watcher.onDidCreate(onDiskChange);

    webview.html = this.getHtml(webview, distRoot);
    webviewPanel.onDidDispose(() => {
      sub.dispose();
      watcher.dispose();
      changeSub.dispose();
      createSub.dispose();
      navSub.dispose();
    });
  }

  // Whether the currently-open binary tab for `uri` is a preview tab. Used to
  // carry preview state through the redirect to the table view. Custom-editor
  // tab inputs expose { uri, viewType }; match this provider's own tab. Defaults
  // to true (Explorer's default) if the tab can't be located.
  private isPanelPreview(uri: vscode.Uri): boolean {
    const tab = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => {
        const input = t.input as { uri?: vscode.Uri; viewType?: string } | undefined;
        return input?.viewType === BinaryEditorProvider.viewType &&
          input?.uri?.toString() === uri.toString();
      });
    return tab?.isPreview ?? true;
  }

  private getHtml(webview: vscode.Webview, distRoot: vscode.Uri): string {
    return renderWebviewHtml(webview, distRoot, {
      scriptFile: 'table.js',
      title: 'Data Explorer',
      body: `    <style>@keyframes dex-spin { to { transform: rotate(360deg); } }</style>
    <div id="dex-error" role="alert" style="display:none;color:var(--vscode-errorForeground,#f14c4c);padding:8px;font-family:var(--vscode-font-family,sans-serif);"></div>
    <div id="dex-notice" role="status" style="display:none;position:absolute;top:0;left:0;right:0;z-index:2;box-sizing:border-box;padding:6px 10px;font-family:var(--vscode-font-family,sans-serif);font-size:12px;color:var(--vscode-inputValidation-infoForeground,var(--vscode-foreground));background:var(--vscode-inputValidation-infoBackground,rgba(100,148,237,0.12));border-bottom:1px solid var(--vscode-inputValidation-infoBorder,#4084d0);"></div>
    <dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>
    <div id="dex-loading" role="status" aria-label="Loading" style="position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:var(--vscode-font-family,sans-serif);font-size:12px;color:var(--vscode-descriptionForeground,var(--vscode-foreground));background:var(--vscode-editor-background,transparent);">
      <div style="width:28px;height:28px;border:3px solid var(--vscode-progressBar-background,#0e70c0);border-top-color:transparent;border-radius:50%;animation:dex-spin 0.8s linear infinite;"></div>
      <div>Loading…</div>
    </div>
    <dex-context-menu></dex-context-menu>`,
    });
  }
}
