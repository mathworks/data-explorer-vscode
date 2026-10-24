// Copyright 2026 The MathWorks, Inc.
// A wide repaint that lands while one of the table's own writes is still on its way.
//
// Every structural edit of a JSON .sldd changes the model and PAINTS before it writes, and the
// change event its write fires is then recognised as its own echo and skipped: the rows it
// would repaint are already on screen. That skip is only honest while those rows are still
// the ones on screen. Three things repaint the whole table without waiting for a write — a
// save, a webview that reloads and asks for its rows (`ready`), a clipboard broadcast when the
// rows are out of step — and each of them reads the text as it is NOW, which until the write
// lands is the text from before the edit. So the screen went back to showing the deleted entry,
// the model was rebuilt from the same old text, and the echo that would have repaired both was
// skipped: the table and its tree left saying the entry exists while the file says it does not.
//
// This needs the real host: the race is between a WorkspaceEdit and the event VS Code fires for
// it, and only VS Code orders those.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { findNode } from '../../src/host/SlddModel';
import { ctx, entryNames, fakeTable, isEntryRow, nameOf, quiet, rowNamed, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const entryRowNames = (rows: any[]): string[] => rows.filter(isEntryRow).map(nameOf);

suite('A JSON .sldd table keeps a structural edit a wide repaint overtook', () => {
  test('a delete whose write a reloading webview overtook stays deleted, on screen and in the tree', async () => {
    const uri = wsUri('json_rebuild_during_write_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));
      const row = rowNamed(table.rows(), 'Number');

      // The webview reloads the moment the delete has painted — after the host has handed VS
      // Code the write, before VS Code has applied it — and asks for its rows.
      let reloaded = false;
      table.onPost((msg) => {
        if (reloaded || msg.type !== 'updateEntryRows' || msg.rows.length !== 0) return;
        reloaded = true;
        queueMicrotask(() => table.send({ type: 'ready' }));
      });
      table.send({ type: 'delete', rowIds: [row.ID] });
      await waitFor('the delete to reach the document', () => !entryNames(doc.getText()).includes('Number'));
      assert.ok(reloaded, 'the webview reloaded between the paint and the write');
      await waitFor('the rows to say what the file says', () => !entryRowNames(table.rows()).includes('Number'), 5000, () =>
        `the table shows ${JSON.stringify(entryRowNames(table.rows()))}; posts ${JSON.stringify(table.posts.map((m) => m.type))}`,
      );
      // And long enough for anything still in flight to land over them.
      await quiet(1000, 'a repaint still in flight');

      assert.ok(!entryRowNames(table.rows()).includes('Number'), 'the deleted entry stays off the screen');
      assert.deepStrictEqual(
        entryRowNames(table.rows()),
        entryNames(doc.getText()),
        'the table lists exactly the entries the file does',
      );
      assert.strictEqual(findNode(uri.toString(), row.ID), null, 'and the tree the next edit builds on has let it go');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
