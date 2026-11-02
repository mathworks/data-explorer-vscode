// Copyright 2026 The MathWorks, Inc.
//
// The whole text of a Value the table shows as a summary (`requestEditText`), in each editable
// editor: the JSON dictionary, the compressed dictionary and the MAT-file.
//
// A row whose Value is too long to show whole shows its size instead (`<1x500 double>`), and marks
// that it has a text to edit (`_hasEditText`). Opening the Value editor on it asks the host for that
// text, and the editor opens on the answer for the row it asked about; a row shown whole is
// answered with none, and its editor opens on the cell. The answer is view's (editText.ts, tested
// there with core's reader), and the webview's half is test/wholeValueWiring.test.ts. This is the
// route between them: each provider's message handler, the engine's table, and the panel's post.
//
// The summary is made by an edit, the same in each format: `rowVec` given 500 elements, which is
// then the text the answer must give back.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isEntryRow, nameOf, quiet, waitFor } from './tools/hostHarness';
import { closeAll, matFixture, openBinary, openJson, openMat, tableOf, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LONG = '[' + Array.from({ length: 500 }, (_, i) => i + 1).join(' ') + ']';

interface Kind {
  name: string;
  open(opened: Opened, dir: string): Promise<{ view: { posts: any[]; send(message: any): void } }>;
  /** The row of the entry or variable of that name, as the table holds it now. */
  row(posts: any[], name: string): any;
}

const entry = (posts: any[], name: string) => tableOf(posts).find((r) => isEntryRow(r) && nameOf(r) === name);

const KINDS: Kind[] = [
  { name: 'the JSON dictionary editor', open: (opened, dir) => openJson(opened, dir, 'whole.sldd'), row: entry },
  { name: 'the compressed dictionary editor', open: (opened, dir) => openBinary(opened, dir, 'whole.sldd'), row: entry },
  {
    name: 'the MAT-file editor',
    open: (opened, dir) => openMat(opened, dir, 'whole.mat', matFixture('cases.mat')),
    row: (posts, name) => tableOf(posts).find((r) => r.parent == null && nameOf(r) === name),
  },
];

const editTexts = (posts: any[]) => posts.filter((m) => m.type === 'editText');

suite('The whole text of a Value shown as a summary', () => {
  const opened: Opened = [];
  let dir: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-whole-value-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  for (const kind of KINDS) {
    test(`${kind.name}: comes back for the row asked, and none for a row shown whole`, async () => {
      const { view } = await kind.open(opened, dir);
      const before = kind.row(view.posts, 'rowVec');
      assert.ok(before, 'the file has rowVec');
      view.send({ type: 'edit', rowId: before.ID, columnId: 'Value', oldValue: before.Value, newValue: LONG });
      await waitFor('rowVec to show its size', () => kind.row(view.posts, 'rowVec')?.Value === '<1x500 double>');
      const summary = kind.row(view.posts, 'rowVec');
      assert.strictEqual(summary._hasEditText, true, 'and to mark that it has a text to edit');
      const whole = kind.row(view.posts, 'scalarD');
      assert.ok(whole && !whole._hasEditText, 'scalarD is shown whole');

      // The row shown whole first, so an answer for the wrong row cannot pass as the latest one.
      view.send({ type: 'requestEditText', rowId: whole.ID });
      view.send({ type: 'requestEditText', rowId: summary.ID });
      await waitFor('both answers', () => editTexts(view.posts).length >= 2, 20000, () => JSON.stringify(view.posts.map((m) => m.type)));
      assert.deepStrictEqual(editTexts(view.posts), [
        { type: 'editText', rowId: whole.ID, text: null },
        { type: 'editText', rowId: summary.ID, text: LONG },
      ]);
    });
  }
});
