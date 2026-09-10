// Copyright 2026 The MathWorks, Inc.
// Integration tests for the writable BinarySlddEditorProvider inside real VS Code.
// Drives the provider directly (openCustomDocument + resolveCustomEditor + save)
// to cover the vscode glue the vitest suite cannot: the writable custom-document
// contract, the render shell, and the save gate that re-zips a compressed-binary
// .sldd. The pure transforms are covered by the vitest suite.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
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

  // The pass-through bag is the one place the data member must NOT appear, and this is the
  // only test that can say so. The saved bytes cannot: `writeTo` spreads the bag and then
  // re-inserts the member from `chunkXml`, so a bag that wrongly carried it still saves
  // byte-identically, and core's reader ignores that member in the bag it is handed. So a
  // missing exclusion is invisible everywhere except here — while costing a duplicate copy
  // of the whole payload, per open document, for a file this editor exists because it is
  // 47.8 MB.
  //
  // Asserted on both bags that get built: the one `openCustomDocument` makes and the one
  // `resetParts` makes when an external change replaces an already-open document. They are
  // one rule with two callers, which is why they share a function — and asserting only the
  // first would let the second drift.
  test('the pass-through parts exclude the member the chunk is edited as', async () => {
    const uri = wsUri('binary.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const members = Object.keys(unzipSync(await vscode.workspace.fs.readFile(uri)));

    // The file really does carry the member, so "absent from zipMeta" means excluded and
    // not merely missing from this fixture.
    assert.ok(members.includes('data/chunk0.xml'), 'fixture carries the data member');
    assert.ok(
      !Object.keys((doc as any).zipMeta).includes('data/chunk0.xml'),
      'openCustomDocument excluded the data member from zipMeta',
    );
    // Everything else came through, byte-for-byte — the exclusion must take exactly one
    // member, not filter by a prefix that also swallows a sibling part.
    assert.deepStrictEqual(
      Object.keys((doc as any).zipMeta).sort(),
      members.filter((m) => m !== 'data/chunk0.xml').sort(),
      'every other member carried through',
    );

    (doc as any).resetParts(unzipSync(await vscode.workspace.fs.readFile(uri)));
    assert.ok(
      !Object.keys((doc as any).zipMeta).includes('data/chunk0.xml'),
      'resetParts excluded it too',
    );
    assert.deepStrictEqual(
      Object.keys((doc as any).zipMeta).sort(),
      members.filter((m) => m !== 'data/chunk0.xml').sort(),
      'resetParts carried every other member through',
    );
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
      await new Promise((r) => setTimeout(r, 500));

      // The srcId really is encoded, so "meta.path differs from it" means the decode is
      // load-bearing and not a restatement of the same string.
      assert.ok((doc as any).srcId.includes('my%20params.sldd'), 'srcId is percent-encoded');
      const registered = () => (DataModel.getDataSource((doc as any).srcId) as any)?.meta?.path;
      assert.strictEqual(registered(), 'my params.sldd', 'paint registered the decoded basename');

      await provider.saveCustomDocument(doc, token());
      assert.strictEqual(registered(), 'my params.sldd', 'reBaseline registered the same spelling');
    } finally {
      panel.dispose();
      doc.dispose();
      await vscode.workspace.fs.delete(dst);
    }
  });

  // Both shapes of unreadable chunkXml, because the reader no longer throws for
  // either: it reports `source-unreadable` and answers an empty dictionary, which
  // is right for an open and is the content the save gate must refuse to write.
  // The second case is the dangerous one — well-formed XML under the wrong root
  // reads as a dictionary with zero entries, i.e. as a successful parse.
  for (const [label, chunk] of [
    ['malformed', '<not valid<<<'],
    ['well-formed but not a dictionary', '<Other Class="DD.THING"/>'],
  ] as const) {
    test(`save gate rejects ${label} chunkXml and does not write`, async () => {
      const uri = wsUri('binary.sldd');
      const before = await vscode.workspace.fs.readFile(uri);
      const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
      (doc as any).chunkXml = chunk;
      let threw = false;
      try {
        await provider.saveCustomDocument(doc, token());
      } catch {
        threw = true;
      }
      assert.ok(threw, `save must throw on ${label} xml`);
      const after = await vscode.workspace.fs.readFile(uri);
      assert.deepStrictEqual(Array.from(after), Array.from(before), 'file must be untouched');
      doc.dispose();
    });
  }

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
