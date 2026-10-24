// Copyright 2026 The MathWorks, Inc.
// What a JSON .sldd's "Modified" marks are measured against: the file on disk.
//
// A mark says an entry differs from what the file holds. The table took that baseline ONCE — from
// the document's text, the first time it painted — and replaced it only on a save. Three ordinary
// ways of opening or getting back to a file broke that:
//
//   - the file changes on disk while the document is clean, and VS Code reloads it: every entry
//     the other tool changed was marked Modified in a document with nothing to save;
//   - the user reverts: the document goes back to the file — which may itself have changed on
//     disk meanwhile — and the marks stayed measured against the text it was opened with;
//   - the document is already dirty when the table opens (a window restored with unsaved
//     changes, or edits made in the text view first): the baseline was the EDITED text, so the
//     entries that differ from the file showed nothing at all.
//
// Each needs the real host: what VS Code reports at a reload, a revert and a dirty open — and
// that it reports a reload with no dirty-state event at all — is what the table has to read it
// from.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { ctx, fakeTable, isEntryRow, nameOf, quiet, rowNamed, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const marked = (rows: any[]): string[] => rows.filter((r) => isEntryRow(r) && r.Status === 'Modified').map(nameOf);

/** The `{...}` span of the entries[] element whose "name" is `name`. */
function spanOf(text: string, name: string): { offset: number; length: number } {
  const idx = text.indexOf(`"name": ${JSON.stringify(name)}`);
  assert.ok(idx >= 0, `the text spells the entry "${name}"`);
  const start = text.lastIndexOf('{', idx);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { offset: start, length: i + 1 - start };
  }
  throw new Error(`no element span for "${name}"`);
}

/** `text` with the entry Number holding `value` — as another tool would write it. */
function withNumber(text: string, value: number): string {
  const span = spanOf(text, 'Number');
  const record = JSON.parse(text.slice(span.offset, span.offset + span.length));
  record.value = value;
  return text.slice(0, span.offset) + JSON.stringify(record, null, '\t') + text.slice(span.offset + span.length);
}

const write = (uri: vscode.Uri, text: string) => vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));

suite('A JSON .sldd table marks what differs from the file on disk', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('a file changed on disk and reloaded is not marked Modified', async () => {
    const uri = wsUri('json_baseline_reload_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));

      const next = withNumber(doc.getText(), 7);
      await write(uri, next);
      await waitFor('VS Code to reload the document', () => doc.getText() === next, 20000);
      assert.ok(!doc.isDirty, 'the reloaded document has nothing to save');
      await waitFor('the table to show the value the file now holds', () => rowNamed(table.rows(), 'Number').Value === '7');
      await quiet(1000, 'a repaint of the marks');

      assert.deepStrictEqual(marked(table.rows()), [], 'no entry differs from the file, so none is marked');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);

  test('a revert to a file changed on disk clears the marks', async () => {
    const uri = wsUri('json_baseline_revert_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));

      // An unsaved edit in the table, then another tool changes the same entry on disk.
      const row = rowNamed(table.rows(), 'Number');
      table.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: '1', newValue: '77' });
      await waitFor('the edit to make the document dirty', () => doc.isDirty);
      await waitFor('the edit to be marked', () => marked(table.rows()).includes('Number'));
      const onDisk = withNumber(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)), 9);
      await write(uri, onDisk);

      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await waitFor('the revert to bring the file back', () => !doc.isDirty && doc.getText() === onDisk, 20000);
      await waitFor('the table to show the value the file holds', () => rowNamed(table.rows(), 'Number').Value === '9');
      await quiet(1000, 'a repaint of the marks');

      assert.deepStrictEqual(marked(table.rows()), [], 'the document is the file again, so nothing is marked');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);

  test('a document already dirty when the table opens marks what differs from the file', async () => {
    const uri = wsUri('json_baseline_dirty_open_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const table = fakeTable();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const edited = withNumber(doc.getText(), 55);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), edited);
      assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
      await waitFor('the document to be dirty', () => doc.isDirty);

      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, table.panel, token());
      table.send({ type: 'ready' });
      await waitFor('the first paint', () => table.posts.some((m) => m.type === 'setRows'));
      await waitFor('the entry the file does not hold to be marked', () => marked(table.rows()).includes('Number'), 10000, () =>
        `marked ${JSON.stringify(marked(table.rows()))}`,
      );
      await quiet(500, 'a later repaint taking the mark away');

      assert.deepStrictEqual(marked(table.rows()), ['Number'], 'that entry, and only it');
    } finally {
      table.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
