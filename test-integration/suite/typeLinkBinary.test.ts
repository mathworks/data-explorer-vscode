// Copyright 2026 The MathWorks, Inc.
// The same Data Type link, out of the OTHER .sldd format.
//
// typeLink.test.ts covers the textual spelling, where the srcId core builds link targets from
// is the document uri and the round trip is invisible. This covers the editable binary one,
// where it is not: BinarySlddEditorProvider prefixes its srcId (`binedit:` + the uri) so its
// model cannot collide, in the DataModel singleton, with the read-only viewer's model of the
// same file. Core then builds `MyAlias@binedit:file:///…`, which is not a uri — and
// `Uri.parse` accepts it anyway, as scheme `binedit` with the whole `file:///…` string as its
// path, naming no file. The click opened a blank tab.
//
// Only an integration test can say this. The provider imports `vscode`, so vitest cannot
// reach it; nothing else in the tree knows what srcId a real opened binary document gets; and
// every unit test on both sides registers its own source, so all of them passed while the
// shipped click was broken. Two formats reaching the same rule by two different srcIds is the
// bug class this repo keeps producing, and this is where the two are pinned to each other.
//
// typelink_binary.sldd is the zip twin of typelink.sldd, written from the same entry list by
// `node test-integration/fixtures/make-typelink.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DataModel } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { buildRows } from '../../src/host/rowBuilder';
import { handleNavigate } from '../../src/host/navigate';
import { binaryEditSrcId } from '../../src/common/srcId';

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

function fixtureUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'typelink', 'typelink_binary.sldd');
}

type Cell = { prefix?: string; text: string; linkTarget?: string } | string;

suite('a Data Type link out of an editable binary .sldd', () => {
  let provider: BinarySlddEditorProvider;
  let doc: vscode.CustomDocument | undefined;
  let panel: vscode.WebviewPanel | undefined;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => (provider = new BinarySlddEditorProvider(ctx())));

  teardown(async () => {
    panel?.dispose();
    doc?.dispose();
    doc = undefined;
    panel = undefined;
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // Painted the way the product paints it — openCustomDocument then resolveCustomEditor —
  // because registration happens on paint, and the srcId under test is the one that
  // registration uses.
  async function rows(): Promise<{ all: Record<string, any>[]; srcId: string }> {
    const uri = fixtureUri();
    doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, new vscode.CancellationTokenSource().token);
    panel = vscode.window.createWebviewPanel('test.typeLinkBinary', 'test', vscode.ViewColumn.One, {
      enableScripts: true,
    });
    await provider.resolveCustomEditor(doc, panel, new vscode.CancellationTokenSource().token);
    // Let the ready/post round-trip settle, as binarySlddEdit.test.ts does.
    await new Promise((r) => setTimeout(r, 500));
    const srcId = (doc as any).srcId as string;
    const node = DataModel.getDataSource(srcId);
    assert.ok(node, 'the paint registered the document as a source');
    return { all: buildRows(node as any) as Record<string, any>[], srcId };
  }

  const dataTypeOf = (all: Record<string, any>[], name: string): Cell => {
    const row = all.find((r) => r.Name?.label === name);
    assert.ok(row, `the fixture holds an entry named ${name}`);
    return row!.DataType as Cell;
  };

  test('the target names this document by its PREFIXED srcId', async () => {
    const uri = fixtureUri();
    const { all, srcId } = await rows();
    // Derived, not spelled again: the pairing of the prefix with its removal is the thing
    // under test, so a second literal here could agree with a broken one in src/.
    assert.strictEqual(srcId, binaryEditSrcId(uri.toString()), 'the document registered its prefixed srcId');
    const cell = dataTypeOf(all, 'Kp');
    assert.ok(typeof cell === 'object' && cell !== null, 'Kp Data Type came through as a link cell');
    assert.strictEqual((cell as { text: string }).text, 'MyAlias');
    // What core actually emits, prefix and all. This is the string the click carries.
    assert.strictEqual((cell as { linkTarget?: string }).linkTarget, `MyAlias@${srcId}`);
  });

  test('handleNavigate reads that target back to this file, not to a binedit: uri', async () => {
    // The regression. Before the fix this resolved to a `binedit:`-scheme uri whose path was
    // the whole `file:///…` string; the editor router sniffed it, found neither a JSON nor a
    // zip dictionary, and fell back to the read-only binary view — an empty tab.
    const uri = fixtureUri();
    const { all } = await rows();
    const cell = dataTypeOf(all, 'Kp') as { linkTarget: string };
    let opened: vscode.Uri | undefined;
    await handleNavigate(cell.linkTarget, async (u) => {
      opened = u;
    });
    assert.ok(opened, 'the link resolved to a document');
    assert.strictEqual(opened!.scheme, 'file', 'resolved to a real file, not the srcId prefix as a scheme');
    assert.strictEqual(opened!.toString(), uri.toString(), 'the link round-tripped to its own document');
  });

  test('a built-in and a non-type name stay plain text here too', async () => {
    // The negative half, in the binary format: the rule must not have become "link anything"
    // on the way through a different reader.
    const { all } = await rows();
    assert.strictEqual(dataTypeOf(all, 'Gain'), 'double');
    assert.strictEqual(dataTypeOf(all, 'Borrowed'), 'Kp');
  });
});
