// Copyright 2026 The MathWorks, Inc.
//
// Description is just a property, in real VS Code, through each table editor that edits one.
//
// If the object has a Description it is shown and can be edited, and the edit is saved; if
// it has no such property — a plain MATLAB variable, a Simulink.LookupTable — every row says so
// (`_descriptionApplies: false`, from data-explorer-core#182), the table draws the cell not
// applicable and offers no editor, and an edit message that names it anyway (a table painted
// before the row changed, a chord on a stale row) is refused with core's reason and writes
// nothing. The webview half is pinned in test/descriptionNotApplicable*.test.ts; this is the
// host half: what each provider posts and what it writes.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { quiet, token, waitFor } from './tools/hostHarness';
import {
  closeAll,
  entryOf,
  entryRow,
  matFixture,
  openBinary,
  openJson,
  openMat,
  readMat,
  readSldd,
  variableRow,
  type Opened,
} from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

const NEW_TEXT = 'gravity in metres per second squared';

suite('A Description is shown and saved where the object has one, and refused where it has none', () => {
  let dir = '';
  const opened: Opened = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-desc-'));
  });

  teardown(async () => {
    closeAll(opened);
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** The validation error a refused edit is answered with. */
  const refusalIn = async (posts: any[]): Promise<any> => {
    await waitFor('the refusal', () => posts.some((p) => p.type === 'validationError'));
    return posts.find((p) => p.type === 'validationError');
  };

  /** The view offers a Description column, labelled: every host's posted columns left it out. */
  const assertDescriptionColumn = (posts: any[]) => {
    const payload = posts.filter((p) => p.type === 'setRows').pop();
    assert.ok(payload?.columns?.includes('Description'), `the Description column is offered (${payload?.columns})`);
    assert.strictEqual(payload.columnLabels?.Description, 'Description');
  };

  const editDescription = (view: { send(m: any): void }, row: any, newValue: string) =>
    view.send({ type: 'edit', rowId: row.ID, columnId: 'Description', oldValue: String(row.Description ?? ''), newValue });

  // Core's two answers, by what the row is. A plain variable is a value, and core says it has
  // no Description; an object of a class without the property is refused in the form MATLAB's
  // own error for setting an unknown property takes.
  const REFUSAL: Record<string, RegExp> = {
    scalarD: /^Cannot edit "scalarD": an? \S.* has no Description\.$/,
    MyLUT: /^Unrecognized property 'Description' for class 'Simulink\.LookupTable'\.$/,
    x: /^Cannot edit "x": an? \S.* has no Description\.$/,
  };

  test('in a JSON dictionary', async () => {
    const j = await openJson(opened, dir, 'desc.sldd');
    assertDescriptionColumn(j.view.posts);
    // Read off the first paint before any case clears the posts it searches.
    const [scalarD, lut, gravity] = ['scalarD', 'MyLUT', 'gravity'].map((n) => entryRow(j.view.posts, n));

    for (const [name, row] of [['scalarD', scalarD], ['MyLUT', lut]] as const) {
      assert.strictEqual(row._descriptionApplies, false, `${name} has no Description`);
      assert.strictEqual(row._descriptionEditable, false);
      const version = j.doc.version;
      j.view.posts.length = 0;
      editDescription(j.view, row, 'typed anyway');
      const error = await refusalIn(j.view.posts);
      assert.match(error.reason, REFUSAL[name]);
      await quiet(200, 'a write the refusal must not make');
      assert.strictEqual(j.doc.version, version, `${name}: the text was not written`);
      assert.strictEqual(j.doc.isDirty, false);
    }

    assert.strictEqual(gravity._descriptionApplies, true, 'a Simulink.Parameter has a Description');
    j.view.posts.length = 0;
    editDescription(j.view, gravity, NEW_TEXT);
    await waitFor('the edit written', () => j.doc.getText().includes(NEW_TEXT));
    assert.ok(!j.view.posts.some((p) => p.type === 'validationError'), 'the edit was not refused');
    assert.ok(await j.doc.save(), 'the dictionary saved');
    const saved = readSldd(new Uint8Array(readFileSync(j.path)), (dict) => entryOf(dict, 'gravity').toRow().Description);
    assert.strictEqual(saved, NEW_TEXT, 'the Description survives a fresh read of the saved file');
  });

  test('in a binary dictionary', async () => {
    const b = await openBinary(opened, dir, 'desc.sldd');
    assertDescriptionColumn(b.view.posts);
    const [scalarD, lut, gravity] = ['scalarD', 'MyLUT', 'gravity'].map((n) => entryRow(b.view.posts, n));

    for (const [name, row] of [['scalarD', scalarD], ['MyLUT', lut]] as const) {
      assert.strictEqual(row._descriptionApplies, false, `${name} has no Description`);
      const chunk = b.doc.chunkXml;
      b.view.posts.length = 0;
      editDescription(b.view, row, 'typed anyway');
      const error = await refusalIn(b.view.posts);
      assert.match(error.reason, REFUSAL[name]);
      assert.strictEqual(b.events.length, 0, `${name}: no edit reached VS Code`);
      assert.strictEqual(b.doc.chunkXml, chunk);
      assert.strictEqual(b.doc.edits.dirty, false);
    }

    assert.strictEqual(gravity._descriptionApplies, true, 'a Simulink.Parameter has a Description');
    b.view.posts.length = 0;
    editDescription(b.view, gravity, NEW_TEXT);
    await waitFor('the edit pushed', () => b.events.length > 0);
    assert.ok(!b.view.posts.some((p) => p.type === 'validationError'), 'the edit was not refused');
    await b.provider.saveCustomDocument(b.doc, token());
    const saved = readSldd(new Uint8Array(readFileSync(b.path)), (dict) => entryOf(dict, 'gravity').toRow().Description);
    assert.strictEqual(saved, NEW_TEXT, 'the Description survives a fresh read of the saved file');
  });

  test('in a MAT-file', async () => {
    const m = await openMat(opened, dir, 'desc.mat', matFixture('pv_basic.mat'));
    assertDescriptionColumn(m.view.posts);

    const [x, p] = ['x', 'p'].map((n) => variableRow(m.view.posts, n));
    assert.strictEqual(x._descriptionApplies, false, 'a plain variable has no Description');
    m.view.posts.length = 0;
    editDescription(m.view, x, 'typed anyway');
    const error = await refusalIn(m.view.posts);
    assert.match(error.reason, REFUSAL.x);
    assert.strictEqual(m.events.length, 0, 'no edit reached VS Code');
    assert.strictEqual(m.doc.edits.dirty, false);

    assert.strictEqual(p._descriptionApplies, true, 'a Simulink.Parameter has a Description');
    m.view.posts.length = 0;
    editDescription(m.view, p, NEW_TEXT);
    await waitFor('the edit pushed', () => m.events.length > 0);
    assert.ok(!m.view.posts.some((post) => post.type === 'validationError'), 'the edit was not refused');
    await m.provider.saveCustomDocument(m.doc, token());
    const saved = readMat(new Uint8Array(readFileSync(m.path)), (mat) =>
      (mat.children as any[]).find((v) => v.name === 'p').toRow().Description,
    );
    assert.strictEqual(saved, NEW_TEXT, 'the Description survives a fresh read of the saved file');
  });
});
