// Copyright 2026 The MathWorks, Inc.
// Integration tests for BinaryEditorProvider — the read-only, byte-backed custom
// editor for .slx/.mat/.prj. It is the DEFAULT for *.sldd too, but redirects both
// editable-JSON .sldd (→ tableView) and compressed-binary .sldd (→ binarySlddView)
// to their writable editors. Run inside a real VS Code so the webview, Uri, and
// workspace.fs APIs are genuine. We drive the provider directly
// (openCustomDocument + resolveCustomEditor against a real WebviewPanel) to cover
// the vscode glue the vitest suite cannot: the read-only render shell
// (CSP/nonce/webview HTML) and both .sldd redirects. The row-building itself is
// covered by the rowBuilder/matRowBuilder unit suites.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';

const TABLE_VIEW = 'dataExplorer.tableView';
const BINARY_SLDD_VIEW = 'dataExplorer.binarySlddView';

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  // The provider only reads context.extensionUri; a minimal stand-in suffices.
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

// A throwaway webview panel to resolve the editor into. Any viewType works: the
// provider only touches webviewPanel.webview / .dispose() / .onDidDispose().
function makePanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel('test.binaryHost', 'test', vscode.ViewColumn.One, {
    enableScripts: true,
  });
}

suite('BinaryEditorProvider', () => {
  let provider: BinaryEditorProvider;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => (provider = new BinaryEditorProvider(ctx())));

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('the provider exposes the binaryView viewType', () => {
    assert.strictEqual(BinaryEditorProvider.viewType, 'dataExplorer.binaryView');
  });

  test('openCustomDocument returns a document bound to the URI', async () => {
    const uri = wsUri('model.slx');
    const token = new vscode.CancellationTokenSource().token;
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token);
    assert.strictEqual(doc.uri.toString(), uri.toString());
    doc.dispose(); // no-op, but exercises the CustomDocument contract
  });

  test('resolving a binary .slx renders the read-only webview shell (CSP + nonce)', async () => {
    const uri = wsUri('model.slx');
    const token = new vscode.CancellationTokenSource().token;
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token);
    const panel = makePanel();
    try {
      await provider.resolveCustomEditor(doc, panel, token);
      const html = panel.webview.html;
      assert.ok(html.includes('<dex-tree-table'), 'renders the tree-table element');
      assert.ok(html.includes('Content-Security-Policy'), 'sets a CSP');
      // The script tag carries a nonce that also appears in the script-src CSP.
      const m = /nonce="([0-9a-f]{32})"/.exec(html);
      assert.ok(m, 'a 32-hex nonce is present on the script tag');
      assert.ok(html.includes(`'nonce-${m![1]}'`), 'the same nonce gates script-src');
      assert.ok(panel.webview.options.enableScripts, 'scripts are enabled for the render');
    } finally {
      panel.dispose();
    }
  });

  test('resolving a binary (zip) .sldd redirects to the writable binary-sldd view and disposes the binary panel', async () => {
    const uri = wsUri('binary.sldd');
    const token = new vscode.CancellationTokenSource().token;
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token);
    const panel = makePanel();
    let disposed = false;
    panel.onDidDispose(() => (disposed = true));

    await provider.resolveCustomEditor(doc, panel, token);

    // A compressed-binary .sldd is now editable → the read-only view calls
    // openWith(binarySlddView) and disposes THIS panel, mirroring the JSON
    // redirect above.
    assert.ok(disposed, 'the redundant binary panel disposes itself after redirect');

    // Poll for the binarySlddView tab the redirect opened.
    const start = Date.now();
    let found = false;
    while (Date.now() - start < 5000) {
      found = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some(
          (t) =>
            (t.input as { viewType?: string; uri?: vscode.Uri })?.viewType === BINARY_SLDD_VIEW &&
            (t.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString(),
        );
      if (found) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(found, 'the binary (zip) .sldd was redirected into the writable view');
  });

  test('resolving an editable JSON .sldd redirects to the table view and disposes the binary panel', async () => {
    const uri = wsUri('data.sldd');
    const token = new vscode.CancellationTokenSource().token;
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token);
    const panel = makePanel();
    let disposed = false;
    panel.onDidDispose(() => (disposed = true));

    await provider.resolveCustomEditor(doc, panel, token);

    // The editable JSON path calls openWith(tableView) and disposes THIS panel.
    assert.ok(disposed, 'the redundant binary panel disposes itself after redirect');

    // Poll for the tableView tab the redirect opened.
    const start = Date.now();
    let found = false;
    while (Date.now() - start < 5000) {
      found = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some(
          (t) =>
            (t.input as { viewType?: string; uri?: vscode.Uri })?.viewType === TABLE_VIEW &&
            (t.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString(),
        );
      if (found) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(found, 'the editable JSON .sldd was redirected into the table view');
  });

  test('the onSelect relay is invoked wiring (defaults to undefined until set)', () => {
    // The provider exposes an optional onSelect hook wired by extension.ts to feed
    // the Property Inspector. It is undefined until assigned; assigning it is safe.
    assert.strictEqual(provider.onSelect, undefined);
    let called: unknown = null;
    provider.onSelect = (uriString, rowIds) => (called = { uriString, rowIds });
    provider.onSelect!('file:///x', ['row1']);
    assert.deepStrictEqual(called, { uriString: 'file:///x', rowIds: ['row1'] });
  });
});
