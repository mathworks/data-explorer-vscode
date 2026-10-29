// Copyright 2026 The MathWorks, Inc.
// An edit that lands while a save of a compressed-binary .sldd is writing, inside real VS Code.
//
// VS Code calls saved whatever a custom document holds when the provider's save resolves, so a
// save that wrote the document as it was asked for, and resolved, would leave the tab clean over
// a file without the edit that landed on its awaits. The save writes again first
// (src/host/settledSave.ts, which the MAT-file editor's save shares: matEdit.test.ts).
//
// The edit is pushed as the message handler pushes one (pushEdit), on the save's first await.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { ctx, token, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

suite('Binary .sldd: an edit landing on a save', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('is written by that save before it resolves, and the document is clean', async () => {
    const provider = new BinarySlddEditorProvider(ctx());
    const uri = wsUri('binary_save_landing_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('binary.sldd'), uri, { overwrite: true });
    const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    try {
      const before: string = doc.chunkXml;
      assert.ok(before.includes('>Kp<'), 'the payload spells the entry this test renames');
      const after = before.replace('>Kp<', '>Ki<');
      const saving = provider.saveCustomDocument(doc, token());
      doc.pushEdit('Edit Name', before, after);
      await saving;
      const zip = unzipSync(await vscode.workspace.fs.readFile(uri));
      assert.strictEqual(new TextDecoder().decode(zip['data/chunk0.xml']), after, 'the edit that landed is on disk');
      assert.strictEqual(doc.edits.dirty, false, 'as VS Code, which calls the document saved, shows it');
    } finally {
      doc.dispose();
      await vscode.workspace.fs.delete(uri);
    }
  });
});
