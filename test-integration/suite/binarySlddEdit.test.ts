// Copyright 2026 The MathWorks, Inc.
// Integration tests for the writable BinarySlddEditorProvider inside real VS Code.
// Drives the provider directly (openCustomDocument + resolveCustomEditor + save)
// to cover the vscode glue the vitest suite cannot: the writable custom-document
// contract, the render shell, and the save gate that re-zips a compressed-binary
// .sldd. The pure transforms are covered by the vitest suite.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';

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
    // Let the ready/post round-trip settle.
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(panel.webview.html.includes('dex-tree-table'), 'render shell present');
    panel.dispose();
    doc.dispose();
  });

  test('save gate rejects malformed chunkXml and does not write', async () => {
    const uri = wsUri('binary.sldd');
    const before = await vscode.workspace.fs.readFile(uri);
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    (doc as any).chunkXml = '<not valid<<<';
    let threw = false;
    try {
      await provider.saveCustomDocument(doc, token());
    } catch {
      threw = true;
    }
    assert.ok(threw, 'save must throw on malformed xml');
    const after = await vscode.workspace.fs.readFile(uri);
    assert.deepStrictEqual(Array.from(after), Array.from(before), 'file must be untouched');
    doc.dispose();
  });

  test('save round-trips: saved bytes re-unzip and contain data/chunk0.xml', async () => {
    const src = wsUri('binary.sldd');
    const dst = wsUri('binary_edit_copy.sldd');
    await vscode.workspace.fs.copy(src, dst, { overwrite: true });
    const doc = await provider.openCustomDocument(dst, {} as vscode.CustomDocumentOpenContext, token());
    await provider.saveCustomDocument(doc, token());
    const bytes = await vscode.workspace.fs.readFile(dst);
    const zip = unzipSync(bytes);
    assert.ok(zip['data/chunk0.xml'], 'chunk0.xml present after save');
    // Every non-chunk OPC part passes through verbatim. This minimal fixture
    // carries metadata/mwcoreProperties.xml — assert it survives the re-zip.
    assert.ok(zip['metadata/mwcoreProperties.xml'], 'pass-through OPC part preserved');
    doc.dispose();
    await vscode.workspace.fs.delete(dst);
  });
});
