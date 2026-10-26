// Copyright 2026 The MathWorks, Inc.
//
// An Add Child or a Delete the file will not take is refused alike by every table editor, in real
// VS Code: in the refusal dialog (`refused`, host/refusal.ts), titled by the gesture, with the
// sentence the context menu shows for the row it greys, the same words in a MAT-file, a text
// dictionary and a binary one; and nothing is written.
//
// Each editor said it in the banner before, which the next repaint clears, and each said it
// differently: "This item takes no children." in a MAT-file, "Failed to apply edit: This item
// cannot have children added." in a dictionary, as if the edit had broken. Core gives no reason of
// its own for either refusal yet (canAddChild, canRemoveChild, addChildTo and deleteNodeById
// answer only yes or no), which is why the sentence is the menu's.
//
// The rows are the same in the three files: `cplxScalar`, a complex double, which takes no child,
// and the elements of `mat2x3`, a 2x3 double, which cannot leave it without breaking its shape.
// The table greys both gestures; these messages are what a stale row or a chord would send.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isEntryRow, nameOf, quiet, waitFor } from './tools/hostHarness';
import { closeAll, matFixture, openBinary, openJson, openMat, tableOf, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ADD_CHILD = { title: 'Cannot Add Child', reason: 'This item takes no children.' };
const DELETE = { title: 'Cannot Delete', reason: "This element can't be removed from its parent." };

interface Tab {
  view: { posts: any[]; send(message: any): void };
  /** The rows the table holds now. */
  rows(): any[];
  /** Whether any edit reached the document since it was opened, and whether it is dirty. */
  touched(): boolean;
}

const lastRows = (posts: any[]): any[] => posts.filter((m) => m.type === 'setRows').pop()?.rows ?? [];

const EDITORS: { name: string; open(opened: Opened, dir: string): Promise<Tab> }[] = [
  {
    name: 'a MAT-file',
    open: async (opened, dir) => {
      const m = await openMat(opened, dir, 'refusals.mat', matFixture('cases.mat'));
      return { view: m.view, rows: () => tableOf(m.view.posts), touched: () => m.events.length > 0 || m.doc.edits.dirty };
    },
  },
  {
    name: 'a text dictionary',
    open: async (opened, dir) => {
      const j = await openJson(opened, dir, 'refusals.sldd');
      const version = j.doc.version;
      return { view: j.view, rows: () => lastRows(j.view.posts), touched: () => j.doc.version !== version || j.doc.isDirty };
    },
  },
  {
    name: 'a binary dictionary',
    open: async (opened, dir) => {
      const b = await openBinary(opened, dir, 'refusals.sldd');
      return { view: b.view, rows: () => lastRows(b.view.posts), touched: () => b.events.length > 0 || b.doc.edits.dirty };
    },
  },
];

suite('An Add Child or a Delete the file will not take is refused alike in every table editor', () => {
  let dir = '';
  const opened: Opened = [];
  // What each editor said, per gesture, for the cross-editor comparison at the end.
  const said: Record<string, Record<string, any>> = {};

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-refusals-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  const topRow = (tab: Tab, name: string): any => {
    // A MAT-file's variables are its top rows, a dictionary's entries the rows under its sections.
    const tops = tab.rows().filter((r) => r.parent == null || isEntryRow(r));
    const row = tops.find((r) => nameOf(r) === name);
    assert.ok(row, `the table has a row for "${name}" (it has ${tops.map(nameOf).join(', ')})`);
    return row;
  };
  const childrenOf = (tab: Tab, row: any): any[] => tab.rows().filter((r) => r.parent === row.ID);

  /** Send `message`, and answer what the host posted back once it has had its say. */
  const refusalOf = async (tab: Tab, message: any): Promise<{ refused: any[]; errors: any[] }> => {
    // Marked, not cleared: the rows the table holds are read from the posts.
    const mark = tab.view.posts.length;
    const answer = () => tab.view.posts.slice(mark);
    tab.view.send(message);
    await waitFor('the answer', () => answer().some((m) => m.type === 'refused' || m.type === 'error'));
    await quiet(300, 'a write the refused gesture must not make');
    return {
      refused: answer().filter((m) => m.type === 'refused').map(({ title, reason }) => ({ title, reason })),
      errors: answer().filter((m) => m.type === 'error' || m.type === 'validationError'),
    };
  };

  for (const editor of EDITORS) {
    test(`in ${editor.name}`, async () => {
      const tab = await editor.open(opened, dir);
      const scalar = topRow(tab, 'cplxScalar');
      assert.strictEqual(scalar._canAddChild, false, 'the menu greys Add Child on it');
      const elements = childrenOf(tab, topRow(tab, 'mat2x3'));
      assert.strictEqual(elements.length, 6, 'the 2x3 matrix shows its six elements');
      assert.strictEqual(elements[0]._canDelete, false, 'the menu greys Delete on them');

      const cases: [string, any, { title: string; reason: string }][] = [
        ['addChild', { type: 'addChild', rowId: scalar.ID }, ADD_CHILD],
        ['delete one', { type: 'delete', rowIds: [elements[0].ID] }, DELETE],
        ['delete two', { type: 'delete', rowIds: [elements[0].ID, elements[1].ID] }, DELETE],
      ];
      said[editor.name] = {};
      for (const [what, message, expected] of cases) {
        const { refused, errors } = await refusalOf(tab, message);
        assert.deepStrictEqual(errors, [], `${what}: no failure is reported`);
        assert.deepStrictEqual(refused, [expected], `${what}: refused in the dialog, in the menu's words`);
        assert.strictEqual(tab.touched(), false, `${what}: nothing was written`);
        said[editor.name][what] = refused;
      }
      assert.strictEqual(childrenOf(tab, topRow(tab, 'mat2x3')).length, 6, 'the matrix keeps its elements');
    });
  }

  test('and the three editors said the same', () => {
    const names = EDITORS.map((e) => e.name);
    assert.deepStrictEqual(Object.keys(said), names, 'every editor was asked');
    for (const name of names) assert.deepStrictEqual(Object.keys(said[name]), ['addChild', 'delete one', 'delete two'], `${name} answered every gesture`);
    for (const name of names.slice(1)) assert.deepStrictEqual(said[name], said[names[0]], `${name} says what ${names[0]} says`);
  });
});
