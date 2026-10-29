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
// The second race is the same one from the other side: a wide repaint that has READ the text
// but not yet posted its rows. It waits for the workspace usage graph before it posts, which is
// seconds over a real folder when the graph is cold, and it declared the rows in step with the
// text the moment it had parsed — so an edit made in that window took the narrow path, painted,
// and was then painted over by rows built before it.
//
// This needs the real host: the race is between a WorkspaceEdit and the event VS Code fires for
// it, and only VS Code orders those.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { findNode, peekModel } from 'data-explorer-view/model';
import { invalidateUsageGraph } from '../../src/host/usageGraph';
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

  test('a delete made while a wide repaint is still on its way is not painted over by it', async () => {
    const uri = wsUri('json_rebuild_in_flight_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));
      const row = rowNamed(table.rows(), 'Number');
      const painted = table.posts.filter((m) => m.type === 'setRows').length;

      // A wide repaint that has to wait for a cold usage graph, and a delete in the same breath.
      invalidateUsageGraph();
      table.send({ type: 'ready' });
      table.send({ type: 'delete', rowIds: [row.ID] });
      await waitFor('the delete to reach the document', () => !entryNames(doc.getText()).includes('Number'));
      await waitFor('the wide repaint to land', () => table.posts.filter((m) => m.type === 'setRows').length > painted);
      await quiet(1000, 'a repaint still in flight');

      assert.deepStrictEqual(
        entryRowNames(table.rows()),
        entryNames(doc.getText()),
        `the table lists exactly the entries the file does (posts ${JSON.stringify(table.posts.map((m) => m.type))})`,
      );
      assert.strictEqual(findNode(uri.toString(), row.ID), null, 'and the tree has let the entry go');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);

  test('two tabs of one document both land their wide repaints, together and after a change', async () => {
    // The session holds ONE tree per document, and each tab's wide repaint registers a fresh
    // one. A landing rule that asked "is the registered tree still the one I built?" was told no
    // by the other tab's repaint, read again, and told the other tab the same — two repaints
    // re-reading each other for ever, on a microtask chain that never let the host breathe.
    const uri = wsUri('json_rebuild_two_tabs_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const left = fakeTable();
    const right = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, left.panel, token());
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, right.panel, token());
      const landed = (t: typeof left) => t.posts.filter((m) => m.type === 'setRows').length;
      left.send({ type: 'ready' });
      right.send({ type: 'ready' });
      await waitFor('both tabs to paint', () => landed(left) > 0 && landed(right) > 0);

      // A change outside every entry, which neither tab can repaint narrowly: both go wide at once.
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), ' ');
      assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
      await waitFor('both tabs to repaint the change', () => landed(left) > 1 && landed(right) > 1);
      await quiet(1000, 'a repaint that keeps re-reading');
      const settled = [landed(left), landed(right)];
      await quiet(500, 'a repaint that keeps re-reading');
      assert.deepStrictEqual([landed(left), landed(right)], settled, 'and then both stop');
      assert.deepStrictEqual(entryRowNames(left.rows()), entryNames(doc.getText()), 'the left tab says what the file says');
      assert.deepStrictEqual(entryRowNames(right.rows()), entryNames(doc.getText()), 'and so does the right');
    } finally {
      left.close();
      right.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);

  test('a full repaint still in flight when the last tab closes leaves nothing behind it', async () => {
    // The repaint waits for the usage graph, and a text that moved meanwhile makes it read the
    // document again — which registered a fresh tree of it (tens of MB on a real dictionary)
    // after the close had released it, with no tab left to release it again, and posted to a
    // panel that was gone.
    const uri = wsUri('json_rebuild_after_close_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));

      invalidateUsageGraph();
      table.send({ type: 'ready' });
      table.close();
      const posted = table.posts.length;
      assert.ok(peekModel(uri.toString()) === null, 'the close released the tree');
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), ' ');
      assert.ok(await vscode.workspace.applyEdit(edit), 'the text moved under the repaint');
      await quiet(1500, 'the repaint in flight landing, or reading the text again');

      assert.ok(peekModel(uri.toString()) === null, 'no tree is registered for a document no tab shows');
      assert.deepStrictEqual(
        table.posts.slice(posted).map((m) => m.type),
        [],
        'and nothing was posted to the closed panel',
      );
    } finally {
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
