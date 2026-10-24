// Copyright 2026 The MathWorks, Inc.
//
// The Property Inspector and a JSON .sldd whose selected entry changes under it, inside real
// VS Code.
//
// The inspector is handed a node when a row is selected and builds its rows from it once. A JSON
// dictionary's tree changes under it in all the ways the other two editors' do — a table edit, its
// undo, a keystroke in the text view, a reload from disk — and the inspector went on showing the
// node it was handed until the user clicked another row. The provider now says when it has
// repainted (`onChanged`), and extension.ts answers that with the inspector's one re-resolve, as
// it answers the binary editor's and the MAT-file editor's `onChanged`.
//
// It fires at keystroke rate, so the page's own rule is what keeps that free: a node is sent only
// when it changes what the page shows (inspectorPage.ts). The last case pins that a keystroke in
// another entry reaches the page as nothing at all.
//
// There is no route to the registered provider (activate() returns no API), so this wires its
// own provider to its own inspector the way activate() and PropertiesViewProvider do, and reads
// what the inspector's page was sent.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { InspectorSelection } from '../../src/host/inspectorSelection';
import { InspectorPage } from '../../src/host/inspectorPage';
import { findNode } from '../../src/host/SlddModel';
import { ctx, fakeTable, quiet, rowNamed, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

/** The Value the page was last sent, or undefined before any `showProps`. */
const shownValue = (sent: any[]): string | undefined =>
  (sent.filter((m) => m.type === 'showProps').pop()?.groups as any[] | undefined)
    ?.flatMap((g) => g.properties)
    .find((p: any) => p.name === 'Value')?.value;

suite('JSON .sldd: the Property Inspector follows the entry it shows', () => {
  let uri: vscode.Uri;
  let doc: vscode.TextDocument;
  let table: ReturnType<typeof fakeTable>;
  /** Everything the inspector's page was sent. */
  let sent: any[];

  setup(async () => {
    uri = wsUri('json_inspector_refresh_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    sent = [];
    // As PropertiesViewProvider and activate() wire the registered ones, over a page that has
    // loaded.
    const page = new InspectorPage((message) => void sent.push(message));
    page.opened();
    page.loaded();
    const selection = new InspectorSelection(
      { showNode: (node, from) => page.show(node, from), clear: () => page.clear() },
      findNode,
    );
    const provider = new SlddTextEditorProvider(ctx());
    provider.onSelect = (uriString, rowIds) => selection.show(uriString, rowIds);
    provider.onChanged = (uriString) => selection.refresh(uriString);
    table = fakeTable();
    doc = await vscode.workspace.openTextDocument(uri);
    await provider.resolveCustomTextEditor(doc, table.panel, token());
    table.send({ type: 'ready' });
    await waitFor('the first rows', () => table.posts.some((m) => m.type === 'setRows'));
  });

  teardown(async () => {
    table.close();
    await vscode.workspace.fs.delete(uri);
  });

  const select = (name: string) => table.send({ type: 'select', rowIds: [rowNamed(table.rows(), name).ID] });

  test('a table edit of the shown entry, and its undo, each show its value as it now is', async () => {
    select('Number');
    assert.strictEqual(shownValue(sent), '1');
    const before = doc.getText();
    const span = spanOf(before, 'Number');
    table.send({ type: 'edit', rowId: rowNamed(table.rows(), 'Number').ID, columnId: 'Value', oldValue: '1', newValue: '77' });
    await waitFor('the inspector to show the edit', () => shownValue(sent) === '77', 10000, () =>
      `the page was sent ${JSON.stringify(sent.map((m) => m.type))}`,
    );
    await waitFor('the edit to reach the document', () => doc.getText() !== before);

    // The undo as the bytes it writes (the `undo` command does not take effect in this host).
    const written = spanOf(doc.getText(), 'Number');
    const undo = new vscode.WorkspaceEdit();
    undo.replace(
      uri,
      new vscode.Range(doc.positionAt(written.offset), doc.positionAt(written.offset + written.length)),
      before.slice(span.offset, span.offset + span.length),
    );
    assert.ok(await vscode.workspace.applyEdit(undo), 'the undo applied');
    await waitFor('the inspector to show the undo', () => shownValue(sent) === '1');
  }).timeout(60000);

  test('a change typed into the text view shows in the inspector', async () => {
    select('Number');
    const text = doc.getText();
    const span = spanOf(text, 'Number');
    const record = JSON.parse(text.slice(span.offset, span.offset + span.length));
    record.value = 5;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(doc.positionAt(span.offset), doc.positionAt(span.offset + span.length)),
      JSON.stringify(record, null, '\t'),
    );
    assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
    await waitFor('the inspector to show it', () => shownValue(sent) === '5');
  }).timeout(60000);

  test('a keystroke in another entry repaints the table and sends the inspector nothing', async () => {
    select('Number');
    const pages = sent.length;
    const repaints = table.posts.length;
    const text = doc.getText();
    const pi = spanOf(text, 'PI');
    const valueAt = text.indexOf('"value"', pi.offset);
    assert.ok(valueAt > pi.offset && valueAt < pi.offset + pi.length, 'the fixture spells PI’s value');
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, doc.positionAt(valueAt), ' ');
    assert.ok(await vscode.workspace.applyEdit(edit), 'the keystroke applied');
    await waitFor('the table to repaint the entry it was in', () =>
      table.posts.slice(repaints).some((m) => m.type === 'updateEntryRows'),
    );
    await quiet(500, 'a page post the refresh might send');

    assert.deepStrictEqual(sent.slice(pages), [], 'the inspector’s page was sent nothing');
  }).timeout(60000);
});
