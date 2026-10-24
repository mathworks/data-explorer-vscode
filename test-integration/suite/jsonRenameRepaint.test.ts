// Copyright 2026 The MathWorks, Inc.
// A rename typed into a JSON .sldd's table, repainted where the table holds it.
//
// A row id is a PATH, so a rename re-keys the entry's whole run of rows. The edit paints first —
// the run the table holds under the old name, replaced by rows under the new one — and only then
// writes. Everything after the paint has to address the run by its NEW id, and two things still
// addressed it by the old one, which the table no longer holds:
//
//   - the echo of the write, which confirms the paint by repainting the entry from the bytes
//     written: its splice missed, and the table answered the miss as it answers any splice that
//     cannot land — by asking for the whole payload (`ready`). So every rename ended in a full
//     re-parse and repaint of the dictionary, ~1.4 s on a 47.8 MB one.
//   - the repair when the write is refused, which puts back the rows the file still spells:
//     the same miss, the same round trip, for the one edit that did not happen.
//
// The table's splice is the real one (rowUpdates, through tools/hostHarness.ts fakeTable), so a
// miss here is a miss there.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { ctx, entryNames, fakeTable, isEntryRow, nameOf, quiet, rowNamed, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const entryRowNames = (rows: any[]): string[] => rows.filter(isEntryRow).map(nameOf);

async function opened(file: string) {
  const uri = wsUri(file);
  await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
  const table = fakeTable();
  const doc = await vscode.workspace.openTextDocument(uri);
  await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
  table.send({ type: 'ready' });
  await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));
  return { uri, doc, table };
}

suite('A JSON .sldd table repaints a rename over the rows it painted', () => {
  test('a rename is confirmed in place: no full payload asked for, none sent', async () => {
    const { uri, doc, table } = await opened('json_rename_repaint_copy.sldd');
    try {
      const row = rowNamed(table.rows(), 'Number');
      table.posts.length = 0;
      table.send({ type: 'edit', rowId: row.ID, columnId: 'Name', oldValue: 'Number', newValue: 'Number2' });
      await waitFor('the rename to reach the document', () => entryNames(doc.getText()).includes('Number2'));
      // The echo's repaint, and a round trip had it missed.
      await quiet(1000, 'the echo repaint, and any full payload it asks for');

      assert.strictEqual(table.readyAsks(), 0, 'every repaint landed on a run the table holds');
      assert.ok(
        !table.posts.some((m) => m.type === 'setRows'),
        `the table was never rebuilt (posts ${JSON.stringify(table.posts.map((m) => m.type))})`,
      );
      assert.ok(table.posts.filter((m) => m.type === 'updateEntryRows').length >= 2, 'painted, then confirmed');
      assert.deepStrictEqual(entryRowNames(table.rows()), entryNames(doc.getText()), 'the table says what the file says');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);

  test('a rename the document refuses is taken back over the run it painted', async () => {
    const { uri, doc, table } = await opened('json_rename_refused_copy.sldd');
    try {
      const row = rowNamed(table.rows(), 'Number');
      // VS Code refuses an edit whose document moved after the host read it. A change to another
      // entry, sent ahead of the rename, reaches the document first: the rename was stated
      // against the version before it, and is turned down.
      const before = doc.getText();
      const pi = before.indexOf('"name": "PI"');
      assert.ok(pi >= 0, 'the fixture spells the entry PI');
      const valueAt = before.indexOf('"value"', pi);
      assert.ok(valueAt > pi, 'and its value');
      const other = new vscode.WorkspaceEdit();
      other.insert(uri, doc.positionAt(valueAt), ' ');
      table.posts.length = 0;
      const ahead = vscode.workspace.applyEdit(other);
      table.send({ type: 'edit', rowId: row.ID, columnId: 'Name', oldValue: 'Number', newValue: 'Number2' });
      assert.ok(await ahead, 'the change ahead of the rename applied');
      await waitFor('the refusal to be reported', () => table.posts.some((m) => m.type === 'error'), 10000, () =>
        `posts ${JSON.stringify(table.posts.map((m) => m.type))}`,
      );
      await quiet(1000, 'any full payload the repair asks for');

      assert.ok(!entryNames(doc.getText()).includes('Number2'), 'the rename never reached the file');
      assert.strictEqual(table.readyAsks(), 0, 'the repair landed on the run the paint left');
      assert.deepStrictEqual(entryRowNames(table.rows()), entryNames(doc.getText()), 'the table says what the file says');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
