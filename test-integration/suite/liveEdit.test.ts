// Copyright 2026 The MathWorks, Inc.
// Integration test for the live-edit seam: a JSON .sldd open as the table while its text is
// edited in a side-by-side editor, and which view each kind of file opens in. The table is a
// CustomTextEditorProvider over the native TextDocument, so a text edit reaches it through the
// provider's change listener; whether it reaches it is read off the repaint that listener posts,
// from a provider built over a stand-in panel (tools/hostHarness.ts fakePanel), since the
// registered table's webview cannot be asked what it was told. What the table makes of an edit
// (a scoped entry splice, a table edit as the text a text view shows, an invalid document's
// banner) is view's JSON engine: its jsonEngine/sync.test.ts › Data Explorer .sldd live edit.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { ctx, fakePanel, token, waitFor } from './tools/hostHarness';

// The editable JSON .sldd opens in the tableView, a CustomTextEditorProvider:
// the table is a view of the native TextDocument, so there is ONE document and
// one native undo stack shared by the table and any text view of the same URI.
const TABLE_VIEW = 'dataExplorer.tableView';
// .slx/.mat/.prj remain in the read-only binaryView.
const BINARY_VIEW = 'dataExplorer.binaryView';
// A compressed-binary (zip/OPC) .sldd is editable in its own writable view; the
// read-only binaryView redirects such a file here (mirroring the JSON redirect).
const BINARY_SLDD_VIEW = 'dataExplorer.binarySlddView';

function slddUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, 'data.sldd');
}

function slxUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, 'model.slx');
}

// The active tab, whichever group holds it.
function activeTab(): vscode.Tab | undefined {
  return vscode.window.tabGroups.activeTabGroup.activeTab ?? undefined;
}

// Wait until the active tab's custom-editor viewType matches.
async function waitForActiveViewType(expected: string): Promise<void> {
  const viewType = () => (activeTab()?.input as { viewType?: string } | undefined)?.viewType;
  await waitFor(`the active tab to be a ${expected}`, () => viewType() === expected);
  assert.strictEqual(viewType(), expected, 'active view type did not settle');
}

suite('Data Explorer .sldd live edit', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    // Revert any unsaved edits so the fixture is untouched for the next test/run.
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('a text-view edit dirties the shared document (single source of truth)', async () => {
    // Single-document model: the tableView is a CustomTextEditorProvider, so the
    // table is a view of the native TextDocument — there is ONE document (and one
    // native undo stack) shared by the table tab and any text view of the same
    // URI. A TEXT-view edit therefore dirties that shared TextDocument, and the
    // table tab (which reflects the TextDocument's dirty state) goes dirty with
    // it. This is the fix for the old two-document design, where the table was a
    // separate CustomDocument and a text edit dirtied only the text tab — that
    // asymmetry is gone.
    //
    // We assert the DOCUMENT is dirty (the real contract). We deliberately do NOT
    // assert the custom tab's `.isDirty` separately: with a CustomTextEditor the
    // tab mirrors the TextDocument's dirty state, but reading the exact tab flag
    // can be environment-flaky in the test host.
    const uri = slddUri();

    // Open BOTH views of the same file: the table (CustomTextEditor) and the text
    // editor, side by side.
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    const doc0 = await vscode.workspace.openTextDocument(uri);
    const editor0 = await vscode.window.showTextDocument(doc0, vscode.ViewColumn.Beside);

    // The document starts clean.
    assert.strictEqual(doc0.isDirty, false, 'the shared document starts clean');

    // A table over the same document whose messages can be read: the registered
    // table's webview cannot be asked what it was told. Painted once, and the
    // posts cleared, so anything posted after the edit below is the answer to it.
    const view = fakePanel();
    try {
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc0, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
      view.posts.length = 0;

      // Edit in the TEXT view (valid JSON: prepend whitespace).
      const appliedTextEdit = await editor0.edit((eb) =>
        eb.insert(new vscode.Position(0, 0), ' '),
      );
      assert.strictEqual(appliedTextEdit, true, 'the text edit applied');

      // The provider's onDidChangeTextDocument listener answers the change by
      // repainting the table: the whole table (setRows) for a change outside every
      // entry, as this one is, or one entry's rows (updateEntryRows). Nothing else
      // in this test makes it repaint, so a repaint is the listener's own effect;
      // a provider with no listener never sends one.
      await waitFor('the change listener to repaint the table for the text edit', () =>
        view.posts.some((m) => m.type === 'setRows' || m.type === 'updateEntryRows'),
      );
      await waitFor('the text edit to dirty the shared document', () => doc0.isDirty);

      // The shared TextDocument is dirty — the single source of truth both views
      // observe.
      assert.ok(doc0.isDirty, 'the shared document is dirty after a text-view edit');
      assert.ok(
        vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
        'extension remains active',
      );
    } finally {
      view.close();
    }
  });

  test('opening a JSON .sldd as the table succeeds and the tab is initially clean', async () => {
    // The editable tableView CustomTextEditorProvider opens a JSON .sldd; no edit
    // has been made, so the shared document (and its tab) must not be dirty.
    const uri = slddUri();
    await vscode.commands.executeCommand('vscode.openWith', uri, TABLE_VIEW);
    await waitForActiveViewType(TABLE_VIEW);

    const tab = activeTab();
    assert.ok(tab, 'a table tab is active');
    assert.strictEqual(
      (tab!.input as { viewType?: string })?.viewType,
      TABLE_VIEW,
      'the active tab is the Data Explorer table',
    );
    assert.strictEqual(tab!.isDirty, false, 'a freshly opened table tab is not dirty');
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension is active after opening the table',
    );
  });

  test('a binary .slx opens read-only without error and stays clean', async () => {
    // model.slx is a binary (zip) fixture in the workspace; it opens in the
    // read-only binaryView (never editable, never dirty).
    const uri = slxUri();
    await vscode.workspace.fs.stat(uri); // fixture must exist
    await vscode.commands.executeCommand('vscode.openWith', uri, BINARY_VIEW);
    await waitForActiveViewType(BINARY_VIEW);

    const tab = activeTab();
    assert.ok(tab, 'an .slx tab is active');
    assert.strictEqual(tab!.isDirty, false, 'a read-only binary tab is not dirty');
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension is active after opening the binary .slx',
    );
  });

  test('a binary (zip) .sldd opens in the writable binary-sldd view without error', async () => {
    const ws = vscode.workspace.workspaceFolders![0];
    const uri = vscode.Uri.joinPath(ws.uri, 'binary.sldd');
    await vscode.workspace.fs.stat(uri); // fixture must exist
    // Opening via the DEFAULT binaryView redirects a zip .sldd to the writable
    // binarySlddView, so the active tab settles on that view type.
    await vscode.commands.executeCommand('vscode.openWith', uri, BINARY_VIEW);
    await waitForActiveViewType(BINARY_SLDD_VIEW);
    const tab = activeTab();
    assert.ok(tab, 'a tab is active for the binary .sldd');
    assert.strictEqual((tab!.input as {viewType?:string})?.viewType, BINARY_SLDD_VIEW);
    assert.strictEqual(tab!.isDirty, false, 'a freshly-opened binary .sldd tab is not dirty');
    assert.ok(vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension stays active after opening a binary .sldd');
  });
});
