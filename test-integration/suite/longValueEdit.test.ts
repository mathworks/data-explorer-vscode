// Copyright 2026 The MathWorks, Inc.
//
// A value too long to show stays editable, in every table editor, in real VS Code. An array of 500
// doubles is typed into a variable's or an entry's Value and saved; opened again, its cell shows a
// summary (`<1x500 double>`), the row says it takes an editor of its whole text (`_hasEditText`)
// without carrying it, and the editor opening asks for it (`requestEditText`), which the host
// answers with the whole value written out (`editText`). That text committed as it is writes
// nothing; one element changed in it is saved, and the file then holds the array with that element
// changed.
//
// Before, a value shown as a summary took no editor at all: an array typed in whole could be saved,
// but once reopened the row was locked against any further edit. The webview's half, that the
// editor is seeded with the answer and posts the whole text, is test/treeTableWholeValue.test.ts
// and test/wholeValueWiring.test.ts.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel } from 'data-explorer-core';
import { quiet, waitFor, ws } from './tools/hostHarness';
import { closeAll, fixturePath, type Opened } from './tools/tables';
import { BINARY_EDITOR, MAT_EDITOR, TEXT_EDITOR, type EditorKind, type EditorTab } from './tools/editorTabs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LONG = '[' + Array.from({ length: 500 }, (_, i) => i + 1).join(' ') + ']';
const EDITED = LONG.replace('[1 2 ', '[7 2 ');

const CASES: { editor: EditorKind; from: () => string; name: string }[] = [
  { editor: MAT_EDITOR, from: () => fixturePath('mat', 'cases.mat'), name: 'rowVec' },
  { editor: TEXT_EDITOR, from: () => join(ws().fsPath, 'params.sldd'), name: 'colVec' },
  { editor: BINARY_EDITOR, from: () => join(ws().fsPath, '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd'), name: 'colVec' },
];

const shown = (cell: any): string => (cell && typeof cell === 'object' ? String(cell.text ?? '') : String(cell ?? ''));
const problemsIn = (posts: any[]) => posts.filter((p) => p.type === 'validationError' || p.type === 'error');

suite('A value shown as a summary for its size is edited as its whole text, in every table editor', () => {
  let dir = '';
  const opened: Opened = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-longvalue-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** Send the edit the table sends for `row`, and wait for it to reach the document. */
  const edit = async (tab: EditorTab, row: any, oldValue: string, newValue: string) => {
    tab.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue, newValue });
    await waitFor('the edit to reach the document', () => tab.edited() || problemsIn(tab.view.posts).length > 0);
    assert.deepStrictEqual(problemsIn(tab.view.posts), [], 'the edit was taken');
  };

  /** Ask for `row`'s whole Value text as the table does when its editor opens, and answer the reply. */
  const editTextOf = async (tab: EditorTab, row: any): Promise<any> => {
    const mark = tab.view.posts.length;
    tab.view.send({ type: 'requestEditText', rowId: row.ID });
    await waitFor('the whole text', () => tab.view.posts.slice(mark).some((p) => p.type === 'editText'));
    return tab.view.posts.slice(mark).find((p) => p.type === 'editText');
  };

  for (const c of CASES) {
    test(`in ${c.editor.name}: an array of 500 typed, saved, reopened, and one element of it edited`, async () => {
      const ext = c.from().endsWith('.mat') ? '.mat' : '.sldd';
      const first = await c.editor.open(opened, dir, `typed${ext}`, c.from());
      const before = first.row(c.name);
      await edit(first, before, shown(before.Value), LONG);
      const saved = join(dir, `saved${ext}`);
      writeFileSync(saved, await first.save());

      const second = await c.editor.open(opened, dir, `reopened${ext}`, saved);
      const row = second.row(c.name);
      assert.strictEqual(shown(row.Value), '<1x500 double>', 'the cell shows a summary');
      assert.strictEqual(row._valueEditable, true, 'and takes an editor');
      assert.strictEqual(row._hasEditText, true, 'of its whole text');
      assert.ok(!('_editText' in row), 'which the row does not carry');

      const reply = await editTextOf(second, row);
      assert.deepStrictEqual(reply, { type: 'editText', rowId: row.ID, text: LONG }, 'the whole value, as core writes it');

      second.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: reply.text, newValue: reply.text });
      await quiet(300, 'a write the unchanged text must not make');
      assert.strictEqual(second.edited(), false, 'the whole text committed as it is writes nothing');
      assert.deepStrictEqual(problemsIn(second.view.posts), []);

      await edit(second, row, reply.text, EDITED);
      const resaved = await second.save();
      assert.strictEqual(
        c.editor.readBack(resaved, c.name, (n) => DataModel.editText(n.id)),
        EDITED,
        'the saved file holds the array with that one element changed',
      );
    });
  }
});
