// Copyright 2026 The MathWorks, Inc.
// Integration test for the Data Type link's ONE untestable seam.
//
// Core builds a link target as `<name>@<srcId>`, where srcId is whatever string the host
// passed to addDataSource; vscode reads it back with vscode.Uri.parse (host/navigate.ts).
// Every unit test on both sides registers its own source, so all of them would still pass
// if the host registered a dictionary under its BASENAME — and then every Data Type link in
// the product would resolve to nothing, or to a same-named file elsewhere in the workspace.
//
// This is also the only test that runs against the INSTALLED core rather than a local
// working copy, so it is what a bad pin bump breaks loudly.
//
// typelink.sldd sits outside the workspace folder (fixtures/typelink), the same arrangement
// singleFileUsage.test.ts uses. Regenerate it with
// `node test-integration/fixtures/make-typelink.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { buildRows } from 'data-explorer-view/model';
import { getModel, invalidate } from 'data-explorer-view/host';
import { handleNavigate } from '../../src/host/navigate';

function fixtureUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'typelink', 'typelink.sldd');
}

type Cell = { prefix?: string; text: string; linkTarget?: string } | string;

async function rows(): Promise<Record<string, any>[]> {
  const uri = fixtureUri();
  const doc = await vscode.workspace.openTextDocument(uri);
  invalidate(uri.toString());
  // Registered exactly as SlddTextEditorProvider registers it: the uriString as srcId.
  const node = getModel(uri.toString(), 'typelink.sldd', doc.getText());
  return buildRows(node) as Record<string, any>[];
}

const dataTypeOf = (all: Record<string, any>[], name: string): Cell => {
  const row = all.find((r) => r.Name?.label === name);
  assert.ok(row, `the fixture holds an entry named ${name}`);
  return row!.DataType as Cell;
};

suite('a Data Type link resolves back to the document it came from', () => {
  test('handleNavigate reads that target back to the same file', async () => {
    const uri = fixtureUri();
    const cell = dataTypeOf(await rows(), 'Kp') as { linkTarget: string };
    let opened: vscode.Uri | undefined;
    await handleNavigate(cell.linkTarget, async (u) => {
      opened = u;
    });
    assert.strictEqual(opened?.toString(), uri.toString(), 'the link round-tripped to its own document');
  });
});
