// Copyright 2026 The MathWorks, Inc.
// Integration tests for the .sldd editor-toggle feature, run inside a real VS
// Code instance. These cover the runtime glue the headless vitest suite cannot:
// command registration, the openWith view swaps, and multi-editor splits.
import * as assert from 'assert';
import * as vscode from 'vscode';

// Editable JSON .sldd now opens in the text-backed table view (native
// undo/redo). The old binaryView is read-only and no longer owns .sldd.
const TABLE_VIEW = 'dataExplorer.tableView';

function slddUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, 'data.sldd');
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

// The active tab's custom-editor viewType, or undefined for a plain text editor.
function activeCustomViewType(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as
    | { viewType?: string }
    | undefined;
  return input?.viewType;
}

// A tab's custom-editor viewType, or undefined for a plain text editor tab.
function customViewTypeOf(tab: vscode.Tab): string | undefined {
  return (tab.input as { viewType?: string } | undefined)?.viewType;
}

// All tabs (across groups) that point at the given URI. Custom-editor tab inputs
// expose { uri, viewType }; plain text tab inputs expose { uri }.
function tabsForUri(uri: vscode.Uri): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => {
      const input = t.input as { uri?: vscode.Uri } | undefined;
      return input?.uri?.toString() === uri.toString();
    });
}

// The toggle commands fire openWith fire-and-forget, so the tab swap completes
// asynchronously after the command returns. Poll until the active tab reaches
// the expected viewType (undefined = plain text editor) or time out.
async function waitForActiveViewType(
  expected: string | undefined,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (activeCustomViewType() === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.strictEqual(activeCustomViewType(), expected, 'active view type did not settle');
}

suite('Data Explorer .sldd editor toggle', () => {
  suiteSetup(async () => {
    // Give the extension host a moment to activate on the .sldd language.
    const ext = vscode.extensions.getExtension('mathworks.data-explorer-vscode');
    await ext?.activate();
  });

  teardown(closeAllEditors);

  test('the toggle commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('dataExplorer.viewAsText'), 'viewAsText registered');
    assert.ok(all.includes('dataExplorer.viewAsTable'), 'viewAsTable registered');
  });

  test('an editable JSON .sldd ends up in the table view (via the binary redirect)', async () => {
    // The default editor for *.sldd is the byte-backed binaryView (it can open
    // any bytes). For editable JSON it immediately redirects (openWith) to the
    // text-backed tableView and disposes itself, so the settled view is the table.
    await vscode.commands.executeCommand('vscode.open', slddUri());
    await waitForActiveViewType(TABLE_VIEW);
  });

  test('an Explorer preview open stays a preview tab through the binary->table redirect', async () => {
    // Single-clicking a .sldd in the native Explorer opens the default binaryView
    // as a PREVIEW tab. For editable JSON the binaryView redirects to the table
    // via openWith; that redirect must carry preview mode through, otherwise the
    // table tab lands pinned (the reported bug). `vscode.open` mirrors the
    // Explorer path (preview by default).
    const uri = slddUri();
    await vscode.commands.executeCommand('vscode.open', uri);
    await waitForActiveViewType(TABLE_VIEW);

    const tabs = tabsForUri(uri).filter((t) => customViewTypeOf(t) === TABLE_VIEW);
    assert.strictEqual(tabs.length, 1, 'one table tab for the .sldd');
    assert.strictEqual(tabs[0].isPreview, true, 'the redirected table tab is a preview tab');
  });

  test('viewAsText opens the plain text editor as a SECOND tab (not in place)', async () => {
    // LOCK-DOWN of verified behavior: openWith to a different viewType does NOT
    // convert the current tab — an editor tab's type is fixed for its lifetime —
    // so the text editor opens as a second tab alongside the table. (Earlier this
    // test only checked the active viewType and missed the extra tab.)
    const uri = slddUri();
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    await waitForActiveViewType(TABLE_VIEW);
    assert.strictEqual(tabsForUri(uri).length, 1, 'starts with one (table) tab');

    await vscode.commands.executeCommand('dataExplorer.viewAsText', uri);
    // A plain text editor has no custom viewType and drives activeTextEditor.
    await waitForActiveViewType(undefined);
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      uri.toString(),
    );

    // Both tabs now exist for the same URI: the table (tableView) was NOT
    // replaced; the text editor was added.
    const tabs = tabsForUri(uri);
    assert.strictEqual(tabs.length, 2, 'viewAsText added a second tab (1 -> 2)');
    assert.ok(
      tabs.some((t) => customViewTypeOf(t) === TABLE_VIEW),
      'the original table tab is still present',
    );
    assert.ok(
      tabs.some((t) => customViewTypeOf(t) === undefined),
      'a plain text editor tab was added',
    );
  });

  test('viewAsTable opens the table as a SECOND tab (not in place)', async () => {
    const uri = slddUri();
    // Open plain text unambiguously (showTextDocument always yields the built-in
    // text editor, independent of the custom-editor default priority).
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(activeCustomViewType(), undefined, 'starts as text');
    assert.strictEqual(tabsForUri(uri).length, 1, 'starts with one (text) tab');

    await vscode.commands.executeCommand('dataExplorer.viewAsTable', uri);
    await waitForActiveViewType(TABLE_VIEW);

    const tabs = tabsForUri(uri);
    assert.strictEqual(tabs.length, 2, 'viewAsTable added a second tab (1 -> 2)');
    assert.ok(
      tabs.some((t) => customViewTypeOf(t) === TABLE_VIEW),
      'a table tab was added',
    );
    assert.ok(
      tabs.some((t) => customViewTypeOf(t) === undefined),
      'the original text tab is still present',
    );
  });

  test('opening from the tree previews the table tab (italic, reused)', async () => {
    // The tree open command requests preview mode. VS Code's `vscode.openWith`
    // hardcodes `pinned: true`, so a naive `{ preview: true }` is ignored and the
    // tab opens pinned (microsoft/vscode#235535). openInBestEditor works around
    // this by also passing `pinned: false`, so the settled table tab must report
    // isPreview === true.
    const uri = slddUri();
    await vscode.commands.executeCommand('dataExplorer.openFile', uri);
    await waitForActiveViewType(TABLE_VIEW);

    const tabs = tabsForUri(uri).filter((t) => customViewTypeOf(t) === TABLE_VIEW);
    assert.strictEqual(tabs.length, 1, 'one table tab for the .sldd');
    assert.strictEqual(tabs[0].isPreview, true, 'the table tab is a preview tab');
  });

  test('the table supports a second instance for the same document (split)', async () => {
    const uri = slddUri();
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    // Split the active editor right: with supportsMultipleEditorsPerDocument,
    // this yields a SECOND working table tab rather than an empty one.
    await vscode.commands.executeCommand('workbench.action.splitEditorRight');

    const tables = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => (t.input as { viewType?: string })?.viewType === TABLE_VIEW);
    assert.strictEqual(tables.length, 2, 'two table instances of the same .sldd');
  });
});
