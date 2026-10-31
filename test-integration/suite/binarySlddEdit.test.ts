// Copyright 2026 The MathWorks, Inc.
// Integration tests for the writable BinarySlddEditorProvider inside real VS Code.
// Drives the provider directly (openCustomDocument + resolveCustomEditor + save)
// to cover the vscode glue the vitest suite cannot: the writable custom-document
// contract, the render shell, and the name the source is registered under. The save
// gate and the re-zip are view's binary engine's tests now.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DataModel } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { waitFor } from './tools/hostHarness';

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

function makePanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel('test.binSlddHost', 'test', vscode.ViewColumn.One, {
    enableScripts: true,
  });
}

function token() {
  return new vscode.CancellationTokenSource().token;
}

suite('BinarySlddEditorProvider', () => {
  let provider: BinarySlddEditorProvider;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => (provider = new BinarySlddEditorProvider(ctx())));

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('exposes the binarySlddView viewType', () => {
    assert.strictEqual(BinarySlddEditorProvider.viewType, 'dataExplorer.binarySlddView');
  });

  test('opens a compressed-binary .sldd as a writable document and renders', async () => {
    const uri = wsUri('binary.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    assert.ok((doc as any).chunkXml.includes('<Object Class="DD.ENTRY">'), 'chunkXml decoded');
    const panel = makePanel();
    await provider.resolveCustomEditor(doc, panel, token());
    // "Renders" is the webview's 'ready' coming back and the paint registering the document,
    // which is asynchronous; the shell html below is set before resolveCustomEditor returns.
    await waitFor('the ready/post round trip to register the document', () => !!DataModel.getDataSource((doc as any).srcId));
    assert.ok(panel.webview.html.includes('dex-tree-table'), 'render shell present');
    panel.dispose();
    doc.dispose();
  });

  // `meta.path` is what lets a model's `x@my params.sldd` link find this open dictionary:
  // core tries the srcId's own basename first, and this provider's srcId is built from
  // `uri.toString()`, which percent-encodes. A space is the everyday case on the paths
  // MATLAB projects live on, so the encoded srcId matching nothing is not a corner.
  //
  // Asserted after BOTH registrations — the paint and the post-save reBaseline — because
  // they are two callers of one rule, and a save that registered a different spelling
  // would silently change whether a model's link resolves. Only an integration test can
  // see this: the provider imports `vscode`, so the vitest suite cannot reach it, and the
  // saved bytes do not carry `meta.path` at all.
  test('registers the source under the DECODED basename, before and after a save', async () => {
    const src = wsUri('binary.sldd');
    const dst = wsUri('my params.sldd');
    await vscode.workspace.fs.copy(src, dst, { overwrite: true });
    const doc = await provider.openCustomDocument(dst, {} as vscode.CustomDocumentOpenContext, token());
    const panel = makePanel();
    // Cleaned up in a `finally` because the copy lands in the workspace folder that
    // sectionsTree's test enumerates: leaking it on a failure here fails that test too,
    // and a second red herring is the last thing a failure needs.
    try {
      await provider.resolveCustomEditor(doc, panel, token());
      const registered = () => (DataModel.getDataSource((doc as any).srcId) as any)?.meta?.path;
      await waitFor('the paint to register the document', () => registered() !== undefined);

      // The srcId really is encoded, so "meta.path differs from it" means the decode is
      // load-bearing and not a restatement of the same string.
      assert.ok((doc as any).srcId.includes('my%20params.sldd'), 'srcId is percent-encoded');
      assert.strictEqual(registered(), 'my params.sldd', 'paint registered the decoded basename');

      await provider.saveCustomDocument(doc, token());
      assert.strictEqual(registered(), 'my params.sldd', 'reBaseline registered the same spelling');
    } finally {
      panel.dispose();
      doc.dispose();
      await vscode.workspace.fs.delete(dst);
    }
  });

  // "Reopen Editor With…" offers this viewType for EVERY *.sldd, because a selector
  // is a filename glob and the two .sldd formats are not distinguishable by name. So
  // the user can land here with a JSON dictionary, which is not a zip and has nothing
  // for `unzipSync` to read. Opening it must route to the editor that fits the bytes,
  // the way an Explorer double-click already does — not throw at the user.
  test('a JSON-text .sldd opened here routes to the view that fits its bytes', async () => {
    const uri = wsUri('data.sldd');
    // The failure this pins is in openCustomDocument, BEFORE any panel exists: the
    // unconditional unzip threw "invalid zip data", which VS Code surfaces as a
    // notification and an empty tab.
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const panel = makePanel();
    let disposed = false;
    panel.onDidDispose(() => (disposed = true));

    await provider.resolveCustomEditor(doc, panel, token());

    assert.ok(disposed, 'the panel for the wrong-format document disposes itself');

    // Routed to the DEFAULT byte-backed view, which owns the one format-to-editor
    // rule — it then lands an editable JSON .sldd in the table view (and keeps an
    // over-the-sync-limit one read-only, which is why the choice is not made here).
    // So the tab the user ends up looking at is the table view.
    await waitFor('the JSON .sldd to open in the editable table view', () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some(
          (t) =>
            (t.input as { viewType?: string })?.viewType === 'dataExplorer.tableView' &&
            (t.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString(),
        ),
    );
    doc.dispose();
  });
});
