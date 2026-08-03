// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { SectionsTreeProvider } from './host/SectionsTreeProvider.js';
import { PropertiesViewProvider } from './host/PropertiesViewProvider.js';
import { BinaryEditorProvider } from './host/BinaryEditorProvider.js';
import { SlddTextEditorProvider } from './host/SlddTextEditorProvider.js';
import { HealthDecorationProvider } from './host/HealthDecorationProvider.js';
import { invalidate, findNode } from './host/SlddModel.js';
import { isEditableJsonSlddBytes } from './host/slddFormat.js';
import { handleNavigate } from './host/navigate.js';
import { invalidateUsageGraph } from './host/usageGraph.js';

const SUPPORTED_RE = /\.(sldd|mat|slx|prj)$/;

function isSlddUri(uri: vscode.Uri | undefined): boolean {
  return !!uri && uri.path.endsWith('.sldd');
}

// True if the .sldd at `uri` is editable JSON (not zip/binary). Editable JSON
// opens in the CustomTextEditorProvider (native undo/redo); binary/zip .sldd and
// all other formats open in the read-only BinaryEditorProvider.
async function isEditableJsonSldd(uri: vscode.Uri): Promise<boolean> {
  if (!uri.path.endsWith('.sldd')) return false;
  try {
    return isEditableJsonSlddBytes(await vscode.workspace.fs.readFile(uri));
  } catch {
    return false;
  }
}

// Route a URI to the right editor by content: editable JSON .sldd → table view
// (native undo/redo); everything else → binary read-only view.
async function openInBestEditor(uri: vscode.Uri, options?: { preview?: boolean }): Promise<void> {
  const viewType = (await isEditableJsonSldd(uri))
    ? SlddTextEditorProvider.viewType
    : BinaryEditorProvider.viewType;
  // VS Code's `vscode.openWith` hardcodes `pinned: true` before spreading the
  // caller's options, so `{ preview: true }` alone is ignored — the tab opens
  // pinned, not as a reused preview tab (microsoft/vscode#235535, fix PR #255247
  // still unmerged). Because the caller's options spread AFTER that hardcode, an
  // explicit `pinned: false` overrides it and lets `preview: true` take effect.
  // `pinned` isn't on the public TextDocumentShowOptions type but is forwarded
  // to the internal IEditorOptions, so we pass it via an untyped object.
  const openOptions = options?.preview ? { preview: true, pinned: false } : options;
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType, openOptions);
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SectionsTreeProvider(context.extensionUri);
  const piProvider = new PropertiesViewProvider(context.extensionUri);

  // Resolve a selection (from table or tree) into a node and push it to the PI.
  // Section rows (id `section:<key>`) have no properties, so clear the PI.
  const showSelection = (uriString: string, rowIds: string[]): void => {
    const first = rowIds && rowIds.length > 0 ? rowIds[0] : undefined;
    if (!first || first.startsWith('section:')) {
      piProvider.clear();
      return;
    }
    const node = findNode(uriString, first);
    if (node) piProvider.showNode(node);
    else piProvider.clear();
  };

  // Usage-column link click: open the referenced file (opened non-preview so the
  // navigated-to tab persists) and select the target row there. Shared by both
  // providers so navigation works from any table.
  const navigate = (target: string): void => {
    void handleNavigate(target, (uri) => openInBestEditor(uri));
  };

  const binaryProvider = new BinaryEditorProvider(context);
  binaryProvider.onSelect = (uriString, rowIds) => showSelection(uriString, rowIds);
  binaryProvider.onNavigate = navigate;

  // Editable JSON .sldd opens in this text-backed provider (native undo/redo,
  // live sync with the plain-text view). Shares the selection→PI wiring.
  const textProvider = new SlddTextEditorProvider(context);
  textProvider.onSelect = (uriString, rowIds) => showSelection(uriString, rowIds);
  textProvider.onNavigate = navigate;

  // Health badges/colors on tree rows (missing/cycle/modified). The tree
  // encodes each row's state into its resourceUri; this provider renders it.
  const healthProvider = new HealthDecorationProvider();

  // Refresh the tree AND re-query decorations together — the tree rebuild
  // recomputes cycle state and re-emits resourceUris, and the decoration
  // provider must re-read them.
  const refreshAll = (): void => {
    provider.refresh();
    healthProvider.refresh();
    // The block<->param usage graph spans all workspace files, so any add/
    // remove/change can alter an edge — drop it so the next query rebuilds.
    invalidateUsageGraph();
  };

  // Watch the workspace for supported files so the tree stays in sync with
  // create/delete/change events regardless of which tab is focused.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{sldd,mat,slx,prj}');

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SlddTextEditorProvider.viewType,
      textProvider,
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true },
    ),
    vscode.window.registerCustomEditorProvider(
      BinaryEditorProvider.viewType,
      binaryProvider,
      // Allow multiple table instances of the same document so "Split Right" (and
      // side-by-side splits) open a working copy instead of an empty tab. Each
      // resolveCustomEditor call is self-contained; the shared model cache is
      // keyed by URI and read-only, so concurrent instances are safe.
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true },
    ),
    vscode.window.registerTreeDataProvider('dataExplorer.sections', provider),
    vscode.window.registerFileDecorationProvider(healthProvider),
    vscode.window.registerWebviewViewProvider(
      PropertiesViewProvider.viewType,
      piProvider,
    ),
    watcher,
    // Files added/removed change the root list.
    watcher.onDidCreate(refreshAll),
    watcher.onDidDelete(refreshAll),
    // A file's contents changed: drop its cached model (table) and rebuild the
    // reference index (tree), since edits may add or remove references.
    watcher.onDidChange((uri) => {
      invalidate(uri.toString());
      refreshAll();
    }),
    // Live edits in an open editor: invalidate the cached model and refresh.
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isSlddUri(e.document.uri)) {
        invalidate(e.document.uri.toString());
      }
      // A dirty-state transition on any supported file changes the "modified"
      // health badge, so refresh decorations for supported docs.
      if (SUPPORTED_RE.test(e.document.uri.path)) {
        refreshAll();
      }
    }),
    // Saving clears the dirty state → update the modified badge.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (SUPPORTED_RE.test(doc.uri.path)) {
        refreshAll();
      }
    }),
    // Tree row handler: open the file in the Data Explorer. The binary editor
    // reads raw bytes and handles all formats — .slx, .mat, and both compressed
    // (zip) and JSON .sldd (getModelFromBytes sniffs the format) — so a single
    // view type works for everything the tree can surface.
    vscode.commands.registerCommand('dataExplorer.openFile', async (uri: vscode.Uri) => {
      if (!uri) return;
      // Route by content: editable JSON .sldd → text-backed table view (native
      // undo/redo); binary/zip .sldd, .slx, .mat, .prj → read-only binary view.
      // Preview mode (italic, single reused tab) like the Explorer.
      await openInBestEditor(uri, { preview: true });
    }),
    // Editor-tab toggle: open the current .sldd in the Data Explorer table or the
    // plain JSON text editor. NOTE: openWith to a different viewType opens a
    // SECOND tab for the URI rather than converting the current tab in place —
    // an editor tab's type is fixed for its lifetime, so table and text coexist
    // as separate tabs. Editor/title menu commands pass the active resource URI
    // as the first argument; fall back to the active editor's document when
    // invoked from the palette.
    vscode.commands.registerCommand('dataExplorer.viewAsText', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      void vscode.commands.executeCommand('vscode.openWith', target, 'default');
    }),
    vscode.commands.registerCommand('dataExplorer.viewAsTable', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      // Editable JSON .sldd → text-backed table (native undo/redo); else binary.
      await openInBestEditor(target);
    }),
    // Reveal/focus the Property Inspector view. VS Code auto-generates the
    // `<viewId>.focus` command for registered views.
    vscode.commands.registerCommand('dataExplorer.showProperties', () => {
      try {
        void vscode.commands.executeCommand('dataExplorer.properties.focus');
      } catch {
        /* ignore */
      }
    }),
  );
}

export function deactivate(): void {}
