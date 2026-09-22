// Copyright 2026 The MathWorks, Inc.
// Integration tests for the misrouted-tab repair (issue #24). Our three custom
// editors are declared with filename-glob selectors only, so every one of them
// matches *.sldd and a user can force the WRONG one on a file: "Reopen Editor
// With…", VS Code's editor-type picker, or `workbench.editorAssociations`.
//
// The damaging case is the text-backed tableView on a compressed-binary .sldd:
// VS Code fails to resolve the TextDocument ("File seems to be binary and cannot
// be opened as text") BEFORE our provider is reached, so — unlike the two
// provider-side redirects covered in binaryEditor.test.ts — there is no
// resolveCustomEditor call to redirect from, and the user is left with VS Code's
// error page. extension.ts repairs it from the tab that survives the failure.
// Only a real VS Code can produce that failure, so this test lives here.
import * as assert from 'assert';
import * as vscode from 'vscode';

const TABLE_VIEW = 'dataExplorer.tableView';
const BINARY_SLDD_VIEW = 'dataExplorer.binarySlddView';

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

// A tab's custom-editor viewType, or undefined for a plain text editor tab.
function viewTypeOf(tab: vscode.Tab): string | undefined {
  return (tab.input as { viewType?: string } | undefined)?.viewType;
}

function tabsForUri(uri: vscode.Uri): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => (t.input as { uri?: vscode.Uri } | undefined)?.uri?.toString() === uri.toString());
}

// The repair runs off a tab event, so it completes some time after the open that
// triggered it returns (or rejects).
async function waitFor(predicate: () => boolean, message: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(false, message);
}

// Force a viewType the way "Reopen Editor With…" does. The open can also REJECT
// ("cannot be opened as text"); the tab it left behind is still the bug, so the
// rejection is swallowed and the assertions below do the judging.
async function forceOpenWith(uri: vscode.Uri, viewType: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
  } catch {
    /* expected for a binary .sldd forced into the text-backed view */
  }
}

suite('misrouted .sldd tab repair (#24)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('VS Code accepts our hidden-editor-types default, so the picker offers one Data Explorer per .sldd', () => {
    // The other half of #24: prevention. `contributes.configurationDefaults` is
    // silently dropped for settings outside the allowed scopes, and the key did not
    // exist before VS Code 1.134 — neither failure is visible in the manifest, so
    // read back what the running VS Code actually resolved. (The manifest side is
    // pinned in test/manifest.test.ts.)
    const hidden = vscode.workspace
      .getConfiguration('workbench.editor')
      .get<string[]>('hiddenEditorTypes');
    assert.ok(Array.isArray(hidden), 'workbench.editor.hiddenEditorTypes resolved to an array');
    for (const id of [TABLE_VIEW, BINARY_SLDD_VIEW]) {
      assert.ok(hidden!.includes(id), `${id} is hidden from the editor-type picker`);
    }
    assert.ok(
      !hidden!.includes('dataExplorer.binaryView'),
      'the default Data Explorer editor stays in the picker',
    );
  });

  test('a compressed-binary .sldd forced into the text-backed table view is re-routed to the writable binary view', async () => {
    const uri = wsUri('binary.sldd');
    await forceOpenWith(uri, TABLE_VIEW);

    await waitFor(
      () => tabsForUri(uri).some((t) => viewTypeOf(t) === BINARY_SLDD_VIEW),
      'the misrouted tab was never re-routed to the writable binary-sldd view',
    );
    // The replacement is opened first, then the broken tab closed, so the file is
    // never absent from the editor area; what must not survive is the error page.
    await waitFor(
      () => !tabsForUri(uri).some((t) => viewTypeOf(t) === TABLE_VIEW),
      'the broken tableView tab was left open next to the repaired one',
    );
  });

  test('an editable JSON .sldd in the table view is left alone', async () => {
    // The other half of the guard: the repair asks the same content rule the open
    // path asks, so the view type it would pick for editable JSON IS tableView and
    // there is nothing to do. Without that check this handler would fight every
    // legitimate table tab in the editor.
    const uri = wsUri('data.sldd');
    await forceOpenWith(uri, TABLE_VIEW);
    await waitFor(
      () => tabsForUri(uri).some((t) => viewTypeOf(t) === TABLE_VIEW),
      'the JSON .sldd did not open in the table view',
    );

    // Give the repair the same window it needs to act, then assert it did not.
    await new Promise((r) => setTimeout(r, 1000));
    const tabs = tabsForUri(uri);
    assert.strictEqual(tabs.length, 1, 'no second tab was opened for the JSON .sldd');
    assert.strictEqual(viewTypeOf(tabs[0]), TABLE_VIEW, 'the JSON .sldd stayed in the table view');
  });
});
