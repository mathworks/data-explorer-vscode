// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { SectionsTreeProvider } from './host/SectionsTreeProvider.js';
import { PropertiesViewProvider } from './host/PropertiesViewProvider.js';
import { BinaryEditorProvider } from './host/BinaryEditorProvider.js';
import { SlddTextEditorProvider } from './host/SlddTextEditorProvider.js';
import { BinarySlddEditorProvider } from './host/BinarySlddEditorProvider.js';
import { HealthDecorationProvider } from './host/HealthDecorationProvider.js';
import { invalidate, findNode } from './host/SlddModel.js';
import { isEditableJsonSlddBytes, exceedsTextSyncLimit, isZipBytes } from './host/slddFormat.js';
import { handleNavigate, requestSelect } from './host/navigate.js';
import { invalidateUsageGraph } from './host/usageGraph.js';
import { clearUsageSources } from './host/usageSources.js';
import { searchDataSources } from './host/searchSources.js';
import {
  listEntries,
  reindexFile,
  removeFile,
  invalidate as invalidateNameIndex,
} from './host/nameIndex.js';
import { isSectionRowId } from './common/sectionRowId.js';
import { isSupportedPath, SUPPORTED_GLOB } from './common/fileTypes.js';
import { isSlddFile } from 'data-explorer-core';

function isSlddUri(uri: vscode.Uri | undefined): boolean {
  return !!uri && isSlddFile(uri.path);
}

// The ONE format→editor rule: which viewType a URI belongs in, decided by its
// CONTENT. Editable JSON .sldd → the text-backed table view (native undo/redo);
// compressed-binary (zip/OPC) .sldd → the writable BinarySlddEditorProvider
// (table editing + re-zip on save); everything else → the read-only
// BinaryEditorProvider, which opens any bytes.
//
// A JSON .sldd larger than VS Code's TextDocument sync limit is NOT treated as
// editable: the CustomTextEditorProvider can't resolve it (the ext host can't
// mirror an over-limit document — it throws "Unable to retrieve document from
// URI"), so it falls through to the read-only byte-backed view, which opens it
// fine. See exceedsTextSyncLimit in slddFormat.ts.
//
// Returned as a viewType rather than opened, because two callers need it: the
// open path (openInBestEditor) and the misroute repair in activate(), which has
// to compare a tab's view type against the rule WITHOUT opening anything.
// Reading the bytes once here also spares a second full read of the file, which
// on a 47 MB dictionary is not free.
async function bestViewType(uri: vscode.Uri): Promise<string> {
  if (!isSlddFile(uri.path)) return BinaryEditorProvider.viewType;
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    // Unreadable: the read-only view reports the failure in its own shell.
    return BinaryEditorProvider.viewType;
  }
  if (isEditableJsonSlddBytes(bytes) && !exceedsTextSyncLimit(bytes)) {
    return SlddTextEditorProvider.viewType;
  }
  if (isZipBytes(bytes)) return BinarySlddEditorProvider.viewType;
  return BinaryEditorProvider.viewType;
}

// Route a URI to the right editor by content (see bestViewType).
async function openInBestEditor(uri: vscode.Uri, options?: { preview?: boolean }): Promise<void> {
  const viewType = await bestViewType(uri);
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
    if (!first || isSectionRowId(first)) {
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

  // The inspector navigates through the same closure as the tables.
  piProvider.onNavigate = navigate;

  const binaryProvider = new BinaryEditorProvider(context);
  binaryProvider.onSelect = (uriString, rowIds) => showSelection(uriString, rowIds);
  binaryProvider.onNavigate = navigate;

  // Editable JSON .sldd opens in this text-backed provider (native undo/redo,
  // live sync with the plain-text view). Shares the selection→PI wiring.
  const textProvider = new SlddTextEditorProvider(context);
  textProvider.onSelect = (uriString, rowIds) => showSelection(uriString, rowIds);
  textProvider.onNavigate = navigate;

  // Compressed-binary .sldd opens in this writable provider (table editing +
  // re-zip on save). Shares the selection→PI and navigate wiring.
  const binarySlddProvider = new BinarySlddEditorProvider(context);
  binarySlddProvider.onSelect = (uriString, rowIds) => showSelection(uriString, rowIds);
  binarySlddProvider.onNavigate = navigate;

  // Health badges/colors on tree rows (missing/cycle/modified). The tree
  // encodes each row's state into its resourceUri; this provider renders it.
  const healthProvider = new HealthDecorationProvider();

  // What changed ON DISK: re-read the folder into the tree AND re-query decorations
  // together — the tree rebuild recomputes cycle state and re-emits resourceUris, and
  // the decoration provider must re-read them.
  const refreshAll = (): void => {
    provider.rebuild();
    healthProvider.refresh();
    // The block<->param usage graph spans all workspace files, so any add/
    // remove/change can alter an edge — drop it so the next query rebuilds.
    invalidateUsageGraph();
  };

  // What changed in a BUFFER: the modified badge, and nothing else. Both caches behind the
  // tree are built from the files on disk (readForScan — never an editor buffer), so an
  // unsaved edit cannot move an edge in either; re-reading the folder to rebuild the graph
  // they already had costs ~5.7 s each over a folder of real dictionaries, on every
  // keystroke, undo and redo. Re-rendering the rows is what the badge needs, and all the
  // badge is is `getTreeItem` asking each document whether it is dirty.
  const refreshBadges = (): void => {
    provider.refresh();
    healthProvider.refresh();
  };

  // URIs whose repair is in flight (see repairMisroutedTab).
  const repairing = new Set<string>();

  // Repair a .sldd sitting in the text-backed table view (tableView) whose bytes
  // are NOT editable JSON. Such a tab cannot render: VS Code fails to resolve the
  // TextDocument — "File seems to be binary and cannot be opened as text" — before
  // our provider is ever reached, so the tab shows VS Code's own error page and
  // there is no resolveCustomEditor call to redirect from. BinarySlddEditorProvider
  // can hand a misrouted file back itself precisely because it DOES get a document;
  // here the surviving tab is the only handle, so the repair is driven from the tab
  // API instead of from the provider.
  //
  // Reached whenever something picks the view type for us instead of going through
  // openInBestEditor: "Reopen Editor With…", the editor-type picker, a stale
  // `workbench.editorAssociations`, a restored session, or `vscode.openWith` from
  // the command palette.
  const repairMisroutedTab = async (tab: vscode.Tab): Promise<void> => {
    const input = tab.input;
    if (!(input instanceof vscode.TabInputCustom)) return;
    if (input.viewType !== SlddTextEditorProvider.viewType) return;
    const key = input.uri.toString();
    // Re-entrancy guard, not a memo: the open+close below is itself tab churn that
    // re-enters this handler, so a repair must not see its own. Dropped once the
    // repair settles rather than remembered, because the same file can legitimately
    // need repairing again later in the session (nothing stops a second Reopen With).
    if (repairing.has(key)) return;
    const target = await bestViewType(input.uri);
    if (target === input.viewType) return; // editable JSON: already the right editor
    repairing.add(key);
    try {
      await openInBestEditor(input.uri);
      // Closed only after the replacement is open, so the file never disappears
      // from the editor area in between.
      await vscode.window.tabGroups.close(tab);
    } catch {
      /* tab already gone, or the open failed: the error page stays, nothing to undo */
    } finally {
      repairing.delete(key);
    }
  };

  // Watch the workspace for supported files so the tree stays in sync with
  // create/delete/change events regardless of which tab is focused.
  const watcher = vscode.workspace.createFileSystemWatcher(SUPPORTED_GLOB);

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
    vscode.window.registerCustomEditorProvider(
      BinarySlddEditorProvider.viewType,
      binarySlddProvider,
      // A writable custom editor owns its own edit stack; a single instance per
      // document keeps that stack unambiguous.
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
    ),
    vscode.window.registerTreeDataProvider('dataExplorer.sections', provider),
    vscode.window.registerFileDecorationProvider(healthProvider),
    vscode.window.registerWebviewViewProvider(
      PropertiesViewProvider.viewType,
      piProvider,
    ),
    watcher,
    // Files added/removed change the root list. Also keep the name index in sync:
    // reindex the new file / drop the removed file's bucket. Both index ops are
    // no-ops until the index is first built (by the first search), so they're
    // cheap when search has never been opened.
    watcher.onDidCreate((uri) => {
      void reindexFile(uri);
      refreshAll();
    }),
    watcher.onDidDelete((uri) => {
      removeFile(uri.toString());
      refreshAll();
    }),
    // A file's contents changed: drop its cached model (table) and rebuild the
    // reference index (tree), since edits may add or remove references. Also
    // reindex its entry names (no-op until the index is first built).
    watcher.onDidChange((uri) => {
      invalidate(uri.toString());
      void reindexFile(uri);
      refreshAll();
    }),
    // Live edits in an open editor: invalidate the cached model and re-badge. Nothing
    // built from DISK is dropped here — see refreshBadges.
    vscode.workspace.onDidChangeTextDocument((e) => {
      // A dirty-state transition arrives as a change event carrying NO changes (VS Code
      // fires one after every edit, and another when a save clears it). Nothing derived
      // from the TEXT can be stale because of it, so only the badge is refreshed: the
      // model re-parse and the name reindex below both re-read the whole buffer, which on
      // a 47.8 MB dictionary is ~250 ms of work for a change that did not happen.
      if (e.contentChanges.length === 0) {
        refreshBadges();
        return;
      }
      if (isSlddUri(e.document.uri)) {
        invalidate(e.document.uri.toString());
      }
      // A dirty-state transition on any supported file changes the "modified"
      // health badge, so refresh decorations for supported docs. Also re-sync
      // the name index for live entry-name edits (e.g. renaming an entry in an
      // open .sldd); reindexFile is a no-op until the index is first built.
      if (isSupportedPath(e.document.uri.path)) {
        void reindexFile(e.document.uri);
        refreshBadges();
      }
    }),
    // Adding or removing a workspace folder changes which files exist as far as
    // every workspace-wide cache is concerned — the tree graph, the usage graph,
    // and the name index all build off `findFiles`, which only ever searches the
    // current folder set. The file watcher CANNOT stand in for this: its glob is
    // relative to that same folder set, and a folder being added is not a file
    // create event, so attaching a folder of pre-existing .sldd files fires
    // nothing at all. Without this the caches keep answering from the old folder
    // set for the rest of the session.
    //
    // The name index needs the wholesale `invalidate()` rather than the
    // per-file ops the watcher uses: a folder change adds and removes whole sets
    // of files at once, and there is no single uri to reindex or drop.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      invalidateNameIndex();
      // The usage graph's per-file summary cache is keyed by content version, so it needs
      // no eviction while a file can still be reached to be re-checked. A folder REMOVED
      // is the case where it cannot: its files leave `findFiles`, and their summaries
      // would sit in memory for the rest of the session.
      clearUsageSources();
      refreshAll();
    }),
    // A tab opened in the wrong custom editor for its content: re-route it.
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.opened) void repairMisroutedTab(tab);
    }),
    // Saving clears the dirty state → update the modified badge.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isSupportedPath(doc.uri.path)) {
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
    // Global entry-name search overlay: pick an entry by name across all data
    // sources, then open its source file and select the matching row. What the pick
    // hands over is what the row is SELECTED by — an entry's name, or a block's SID —
    // which is the same grammar a Usage-link click travels in (see navigate.ts).
    vscode.commands.registerCommand('dataExplorer.searchDataSources', () =>
      searchDataSources(listEntries, async (sourceUri, selectName) => {
        requestSelect(sourceUri, selectName);
        await openInBestEditor(vscode.Uri.parse(sourceUri), { preview: true });
      }),
    ),
  );

  // Tabs that already exist are never reported as `opened`, and the failing open
  // is itself what activates us (onCustomEditor:dataExplorer.tableView), so the
  // tab needing repair is typically already there by the time this line runs — as
  // are tabs restored from the previous session. Sweep what is open once.
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) void repairMisroutedTab(tab);
  }
}

export function deactivate(): void {}
