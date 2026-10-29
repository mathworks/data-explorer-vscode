// Copyright 2026 The MathWorks, Inc.
//
// An Add Child, a Delete or an Add the file will not take is refused alike by every table editor,
// in real VS Code: before anything changes, in the refusal dialog (`refused`, host/refusal.ts),
// titled by the gesture, in core's words, which name the row and say why (addChildRefusal,
// deleteRefusal, addEntryRefusal); the same words in a MAT-file, a text dictionary and a binary
// one, and nothing is written.
//
// Each editor said it in the banner before, which the next repaint clears, and each said it in
// words of its own: "This item takes no children." in a MAT-file, "Failed to apply edit: This item
// cannot have children added." in a dictionary, as if the edit had broken.
//
// The rows are the same in the three files: `cplxScalar`, a complex double, which takes no child,
// and the elements of `mat2x3`, a 2x3 double, which cannot leave it without breaking its shape.
// The table greys both gestures; these messages are what a stale row or a chord would send. The
// Add is of a Simulink.ConfigSet, which neither a MAT-file nor a dictionary's Design Data takes.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel } from 'data-explorer-core';
import { isEntryRow, nameOf, quiet, waitFor } from './tools/hostHarness';
import { closeAll, matFixture, openBinary, openJson, openMat, tableOf, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Tab {
  view: { posts: any[]; send(message: any): void };
  /** The rows the table holds now. */
  rows(): any[];
  /** Whether any edit reached the document since it was opened, and whether it is dirty. */
  touched(): boolean;
  /** The Add of `className` as the gallery sends it here. */
  add(className: string): any;
}

const lastRows = (posts: any[]): any[] => posts.filter((m) => m.type === 'setRows').pop()?.rows ?? [];

const EDITORS: { name: string; open(opened: Opened, dir: string): Promise<Tab> }[] = [
  {
    name: 'a MAT-file',
    open: async (opened, dir) => {
      const m = await openMat(opened, dir, 'refusals.mat', matFixture('cases.mat'));
      return {
        view: m.view,
        rows: () => tableOf(m.view.posts),
        touched: () => m.events.length > 0 || m.doc.edits.dirty,
        add: (className) => ({ type: 'addEntry', section: '', className, rename: false }),
      };
    },
  },
  {
    name: 'a text dictionary',
    open: async (opened, dir) => {
      const j = await openJson(opened, dir, 'refusals.sldd');
      const version = j.doc.version;
      return {
        view: j.view,
        rows: () => lastRows(j.view.posts),
        touched: () => j.doc.version !== version || j.doc.isDirty,
        add: (className) => ({ type: 'addEntry', section: 'design', className, rename: false }),
      };
    },
  },
  {
    name: 'a binary dictionary',
    open: async (opened, dir) => {
      const b = await openBinary(opened, dir, 'refusals.sldd');
      return {
        view: b.view,
        rows: () => lastRows(b.view.posts),
        touched: () => b.events.length > 0 || b.doc.edits.dirty,
        add: (className) => ({ type: 'addEntry', section: 'design', className, rename: false }),
      };
    },
  },
];

suite('An Add Child, a Delete or an Add the file will not take is refused alike in every table editor', () => {
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

  // A MAT-file's variables are its top rows, a dictionary's entries the rows under its sections.
  const tops = (tab: Tab): any[] => tab.rows().filter((r) => r.parent == null || isEntryRow(r));
  const topRow = (tab: Tab, name: string): any => {
    const row = tops(tab).find((r) => nameOf(r) === name);
    assert.ok(row, `the table has a row for "${name}" (it has ${tops(tab).map(nameOf).join(', ')})`);
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

      // Core's own answer for each, asked of the rows this editor's file holds.
      const noChild = DataModel.addChildRefusal(scalar.ID);
      const noDelete = DataModel.deleteRefusal(elements[0].ID);
      assert.match(String(noChild), /^Cannot add to "cplxScalar": .+\. Nothing was added\.$/);
      assert.match(String(noDelete), /^Cannot delete "mat2x3\(1,1\)": .+\. Nothing was deleted\.$/);

      const cases: [string, any, { title: string; reason: string | RegExp }][] = [
        ['addChild', { type: 'addChild', rowId: scalar.ID }, { title: 'Cannot Add Child', reason: noChild! }],
        ['delete one', { type: 'delete', rowIds: [elements[0].ID] }, { title: 'Cannot Delete', reason: noDelete! }],
        ['delete two', { type: 'delete', rowIds: [elements[0].ID, elements[1].ID] }, { title: 'Cannot Delete', reason: noDelete! }],
        ['add', tab.add('Simulink.ConfigSet'), { title: 'Cannot Add', reason: /^Cannot add a Simulink\.ConfigSet to "[^"]+": .+\.$/ }],
      ];
      const topsBefore = tops(tab).length;
      said[editor.name] = {};
      for (const [what, message, expected] of cases) {
        const { refused, errors } = await refusalOf(tab, message);
        assert.deepStrictEqual(errors, [], `${what}: no failure is reported`);
        assert.strictEqual(refused.length, 1, `${what}: refused in the dialog (${JSON.stringify(refused)})`);
        assert.strictEqual(refused[0].title, expected.title, `${what}: titled by the gesture`);
        if (expected.reason instanceof RegExp) assert.match(refused[0].reason, expected.reason, `${what}: in core's words`);
        else assert.strictEqual(refused[0].reason, expected.reason, `${what}: in core's words`);
        assert.strictEqual(tab.touched(), false, `${what}: nothing was written`);
        said[editor.name][what] = refused;
      }
      assert.strictEqual(childrenOf(tab, topRow(tab, 'mat2x3')).length, 6, 'the matrix keeps its elements');
      assert.strictEqual(tops(tab).length, topsBefore, 'no entry was added');
    });
  }

  test('and the three editors said the same of the same rows', () => {
    const names = EDITORS.map((e) => e.name);
    assert.deepStrictEqual(Object.keys(said), names, 'every editor was asked');
    for (const name of names) assert.deepStrictEqual(Object.keys(said[name]), ['addChild', 'delete one', 'delete two', 'add'], `${name} answered every gesture`);
    // The Add names where it was refused, a file or a section, so it is the one that differs.
    const same = (name: string) => ({ ...said[name], add: undefined });
    for (const name of names.slice(1)) assert.deepStrictEqual(same(name), same(names[0]), `${name} says what ${names[0]} says`);
  });
});
