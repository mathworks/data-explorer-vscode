// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file editor's clipboard and row drags, end to end: the copy, cut, paste, dragStart and
// drop the table posts, through the real providers, into what each document then holds, what VS
// Code was handed to undo, and what a save writes.
//
// A MAT-file takes the same gestures a dictionary does, through the same rules (transfer.ts,
// clipboardAction.ts): a copy pasted into the file it came from is a duplicate under a unique
// name, a move within it is the no-op of a move back into its own section (the file is one
// section, ''), and a move into another document is the paste there and the delete here, each its
// own document's undo step. What is the MAT-file's own is what the edit IS: core's pasteEntries,
// all of the entries or none, in ONE undo step; and what a file takes is core's to say, in its
// words.
//
// Every document is a scratch copy in tmpdir, outside the workspace folder: the MAT-files from
// test-integration/fixtures/mat (MATLAB-written) or made from their records (an empty file, a file
// holding one name twice), the dictionaries from the workspace's params.sldd and its binary twin.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel } from 'data-explorer-core';
import { clearClipboard, getClipboard } from '../../src/host/clipboard';
import { clearDrag, getDrag } from '../../src/host/dragState';
import { quiet, waitFor } from './tools/hostHarness';
import {
  closeAll,
  emptyMat,
  entryOf,
  entryRow,
  errorsIn,
  matFixture,
  openBinary,
  openJson,
  openMat,
  readMat,
  readSldd,
  shownCells,
  tableOf,
  twiceNamedMat,
  variableRow,
  type BinaryTab,
  type JsonTab,
  type MatTab,
  type Opened,
} from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

const disk = (tab: { path: string }) => new Uint8Array(readFileSync(tab.path));

/** The ids the last `selectRows` the view was sent asks for. */
const selected = (posts: any[]): string[] => posts.filter((m) => m.type === 'selectRows').pop()?.rowIds ?? [];

/** Send a gesture to a MAT-file's view and wait for it to be answered: an edit pushed, or a word. */
async function onMat(tab: MatTab, msg: any, what = msg.type): Promise<void> {
  const edits = tab.events.length;
  tab.view.posts.length = 0;
  tab.view.send(msg);
  await waitFor(`the ${what} to land or be refused`, () => tab.events.length > edits || errorsIn(tab.view.posts).length > 0);
}

/** Send a gesture to a JSON dictionary's view and wait for its write, or its word. */
async function onJson(tab: JsonTab, msg: any, what = msg.type): Promise<void> {
  const version = tab.doc.version;
  tab.view.posts.length = 0;
  tab.view.send(msg);
  await waitFor(`the ${what} to land or be refused`, () => tab.doc.version > version || errorsIn(tab.view.posts).length > 0);
}

/** Send a gesture to a binary dictionary's view and wait for its edit, or its word. */
async function onBinary(tab: BinaryTab, msg: any, what = msg.type): Promise<void> {
  const edits = tab.events.length;
  tab.view.posts.length = 0;
  tab.view.send(msg);
  await waitFor(`the ${what} to land or be refused`, () => tab.events.length > edits || errorsIn(tab.view.posts).length > 0);
}

/** A cut's move finishes with the source's delete, after the paste; the clipboard empties first. */
const moveDone = () => waitFor('the cut to be spent', () => getClipboard() === null);

/**
 * A scratch directory per test, and everything a test opened closed after it, with both
 * registers emptied: a test that left a cut or a drag behind would hand the next one its source.
 * Called inside a suite, whose hooks it registers.
 */
function scratch(): { opened: Opened; dir: () => string } {
  let dir = '';
  const opened: Opened = [];
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });
  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-matclip-'));
    clearClipboard();
    clearDrag();
  });
  teardown(async () => {
    closeAll(opened);
    clearClipboard();
    clearDrag();
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });
  return { opened, dir: () => dir };
}

suite('MAT-file clipboard and row drags, within one file', () => {
  const scratchDir = scratch();
  const opened = scratchDir.opened;
  let dir = '';
  setup(() => (dir = scratchDir.dir()));

  // --- within one MAT-file ---------------------------------------------------------------------

  test('the view offers the clipboard: rows copy, and the file is one paste target', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const set = m.view.posts.find((p) => p.type === 'setRows');
    assert.strictEqual(set.clipboard, undefined, 'no host declines the clipboard any more');
    assert.strictEqual(variableRow(m.view.posts, 'x')._canCopy, true);
    const rules = m.view.posts.find((p) => p.type === 'sectionRules');
    assert.ok(rules, 'the rules follow the rows');
    assert.deepStrictEqual(rules.rules.map((r: any) => [r.sectionName, r.sectionLabel]), [['', 'gains.mat']]);
    assert.ok(rules.rules[0].allowedTypes.includes('MatlabVariable'));
    assert.ok(rules.rules[0].allowedTypes.includes('Simulink.Parameter'));
    assert.ok(m.view.posts.some((p) => p.type === 'clipboardState'), 'and what the clipboard holds');
  });

  test('a copy pasted into its own file is a duplicate under a unique name; one undo takes it out, redo puts it back', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    m.view.send({ type: 'copy', rowIds: [variableRow(m.view.posts, 'x').ID] });
    assert.strictEqual(getClipboard()?.mode, 'copy');
    assert.deepStrictEqual(getClipboard()!.items.map((i) => [i.sourceSection, i.payload.name]), [['', 'x']]);

    await onMat(m, { type: 'paste', rowId: variableRow(m.view.posts, 'p').ID });
    assert.deepStrictEqual(errorsIn(m.view.posts), []);
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x', 'x1']);
    assert.strictEqual(m.events.length, 1, 'ONE edit reached VS Code');
    assert.strictEqual(m.events[0].label, 'Paste');
    assert.strictEqual(m.doc.edits.dirty, true);
    assert.deepStrictEqual(selected(m.view.posts), [m.variable('x1').id], 'the duplicate is selected');
    assert.deepStrictEqual(shownCells(m.variable('x1'))['.'], { ...shownCells(m.variable('x'))['.'], Name: 'x1' });
    assert.ok(getClipboard(), 'a copy stays on the clipboard');
    await waitFor('the duplicate painted', () => tableOf(m.view.posts).some((r) => r.parent == null && r.Name?.label === 'x1'));
    assert.strictEqual(variableRow(m.view.posts, 'x1').Status, 'New');

    await m.events[0].undo();
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x']);
    assert.strictEqual(m.doc.edits.dirty, false, 'undone: clean');
    await m.events[0].redo();
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x', 'x1']);
    assert.strictEqual(m.doc.edits.dirty, true);
  });

  test('a cut pasted back into its own file changes nothing, and is spent', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const q = variableRow(m.view.posts, 'q').ID;
    m.view.send({ type: 'cut', rowIds: [variableRow(m.view.posts, 'x').ID] });
    assert.strictEqual(getClipboard()?.mode, 'cut');
    m.view.posts.length = 0;
    m.view.send({ type: 'paste', rowId: q });
    await waitFor('the cut to be spent', () => getClipboard() === null);
    await quiet(150, 'an edit or a word the no-op must not make');
    assert.deepStrictEqual(errorsIn(m.view.posts), []);
    assert.strictEqual(m.events.length, 0, 'no edit');
    assert.strictEqual(m.doc.edits.dirty, false);
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x']);
  });

  test('a copy of two variables pastes two, as ONE edit one undo takes out', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    m.view.send({ type: 'copy', rowIds: [variableRow(m.view.posts, 'x').ID, variableRow(m.view.posts, 'p').ID] });
    assert.deepStrictEqual(getClipboard()!.items.map((i) => i.payload.name), ['x', 'p']);
    await onMat(m, { type: 'paste', rowId: '' });
    assert.deepStrictEqual(errorsIn(m.view.posts), []);
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x', 'x1', 'p1']);
    assert.strictEqual(m.events.length, 1);
    assert.deepStrictEqual(selected(m.view.posts), [m.variable('x1').id, m.variable('p1').id], 'both are selected');
    assert.deepStrictEqual(shownCells(m.variable('p1')), renamed(shownCells(m.variable('p')), 'p1'));
    await m.events[0].undo();
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x']);
    assert.strictEqual(m.doc.edits.dirty, false);
  });

  test("a cut dims its rows, a copy dashes them, and the mark goes with the clipboard", async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'mark.sldd');
    m.view.send({ type: 'cut', rowIds: [variableRow(m.view.posts, 'x').ID] });
    await waitFor('the cut row repainted', () => variableRow(m.view.posts, 'x').Name?.clipboardMode === 'cut');
    assert.strictEqual(variableRow(m.view.posts, 'q').Name?.clipboardMode, undefined, 'only the cut variable');
    m.view.send({ type: 'copy', rowIds: [variableRow(m.view.posts, 'q').ID] });
    await waitFor('the copied row repainted', () => variableRow(m.view.posts, 'q').Name?.clipboardMode === 'copy');
    assert.strictEqual(variableRow(m.view.posts, 'x').Name?.clipboardMode, undefined, 'and the cut is no longer marked');
    // A copy in another document takes the mark away from this one.
    j.view.send({ type: 'copy', rowIds: [entryRow(j.view.posts, 'gravity').ID] });
    await waitFor('the mark gone', () => variableRow(m.view.posts, 'q').Name?.clipboardMode === undefined);
    const state = m.view.posts.filter((p) => p.type === 'clipboardState').pop();
    assert.strictEqual(state.sourceDocUri, j.uri.toString(), "this view was told what the clipboard holds now");
  });

  // A whole repaint builds its rows and then waits on the Usage column; a copy landing in that
  // wait repaints the rows it marks at once, ahead of the older rows, which then land over them.
  // The table must end up showing the mark the clipboard holds, in either format.
  test('a copy made while the rows are on their way is marked once they land, in a MAT-file and a dictionary', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const x = variableRow(m.view.posts, 'x').ID;
    m.view.posts.length = 0;
    m.view.send({ type: 'ready' });
    m.view.send({ type: 'copy', rowIds: [x] });
    await waitFor('the repaint', () => m.view.posts.some((p) => p.type === 'setRows'));
    await waitFor('the mark on the copied row', () => tableOf(m.view.posts).find((r) => r.ID === x)?.Name?.clipboardMode === 'copy');

    const j = await openJson(opened, dir, 'marks.sldd');
    const gravity = entryRow(j.view.posts, 'gravity').ID;
    j.view.posts.length = 0;
    j.view.send({ type: 'ready' });
    j.view.send({ type: 'cut', rowIds: [gravity] });
    await waitFor('the repaint', () => j.view.posts.some((p) => p.type === 'setRows'));
    await waitFor('the mark on the cut entry', () => tableOf(j.view.posts).find((r) => r.ID === gravity)?.Name?.clipboardMode === 'cut');
    await waitFor("the MAT-file's copy unmarked", () => tableOf(m.view.posts).find((r) => r.ID === x)?.Name?.clipboardMode === undefined);
  });

  test('a paste into an EMPTY MAT-file, aimed at no row, lands', async () => {
    const source = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const m = await openMat(opened, dir, 'empty.mat', emptyMat());
    assert.deepStrictEqual(m.names(), []);
    const rules = m.view.posts.find((p) => p.type === 'sectionRules');
    assert.deepStrictEqual(rules.rules.map((r: any) => r.sectionName), [''], 'an empty file is still one target');
    source.view.send({ type: 'copy', rowIds: [variableRow(source.view.posts, 'x').ID, variableRow(source.view.posts, 'str').ID] });
    await onMat(m, { type: 'paste', rowId: '' });
    assert.deepStrictEqual(errorsIn(m.view.posts), []);
    assert.deepStrictEqual(m.names(), ['x', 'str']);
    await vscodeSave(m);
    assert.deepStrictEqual(readMat(disk(m), (mat) => mat.children.map((v: any) => v.name)), ['x', 'str']);
    assert.deepStrictEqual(
      readMat(disk(m), (mat) => shownCells(mat.children[0])),
      shownCells(source.variable('x')),
      'saved, and read back as the variable it was copied from',
    );
  });
});

/** `cells` with the entry's own row named `name`, as a duplicate's is. */
function renamed(cells: Record<string, Record<string, string>>, name: string): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(cells).map(([at, row]) => [at, at === '.' ? { ...row, Name: name } : row]));
}

/** Save a MAT-file through its provider, as VS Code's Save does. */
async function vscodeSave(m: MatTab): Promise<void> {
  await m.provider.saveCustomDocument(m.doc, new vscode.CancellationTokenSource().token);
  assert.strictEqual(m.doc.edits.dirty, false, 'saved');
}

/** The cells `columns` of every row of `cells`, for a comparison across formats. */
function columnsOf(cells: Record<string, Record<string, string>>, columns: string[]): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(cells).map(([at, row]) => [at, Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]]))]),
  );
}

// What a value IS, as either format's table shows it: the columns both formats' rows carry.
const VALUE_COLUMNS = ['Name', 'Value', 'Class', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'dimensions', 'complexity'];

/** The JSON dictionary's entry `name` as its text says now, read by core. */
const jsonEntry = <T>(j: JsonTab, name: string, read: (entry: any) => T): T =>
  readSldd(new TextEncoder().encode(j.doc.getText()), (dict) => read(entryOf(dict, name)));

/** The binary dictionary's live entry `name`. */
const binaryEntry = (b: BinaryTab, name: string): any => entryOf(DataModel.getDataSource(b.doc.srcId), name);

/** Write the file as another program would, with an mtime later than any the view has seen. */
function writeOutside(path: string, bytes: Uint8Array): void {
  const before = statSync(path).mtimeMs;
  writeFileSync(path, bytes);
  const later = new Date(Math.max(Date.now(), before) + 2000);
  utimesSync(path, later, later);
}

suite('MAT-file clipboard and row drags, between a MAT-file and a dictionary', () => {
  const scratchDir = scratch();
  const opened = scratchDir.opened;
  let dir = '';
  setup(() => (dir = scratchDir.dir()));

  test('a MAT-file copy pasted into a JSON dictionary lands there, and leaves the MAT-file as it was', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'target.sldd');
    m.view.send({ type: 'copy', rowIds: [variableRow(m.view.posts, 'x').ID, variableRow(m.view.posts, 'p').ID] });
    await onJson(j, { type: 'paste', rowId: 'section:design' });
    assert.deepStrictEqual(errorsIn(j.view.posts), []);
    assert.ok(j.names().includes('x') && j.names().includes('p'), 'both landed');
    assert.strictEqual(j.doc.isDirty, true);
    for (const name of ['x', 'p']) {
      assert.deepStrictEqual(
        jsonEntry(j, name, (e) => columnsOf(shownCells(e), VALUE_COLUMNS)),
        columnsOf(shownCells(m.variable(name)), VALUE_COLUMNS),
        `${name} reads in the dictionary as the variable it was copied from`,
      );
    }
    assert.strictEqual(m.events.length, 0);
    assert.strictEqual(m.doc.edits.dirty, false);
    assert.ok(getClipboard(), 'a copy stays on the clipboard');
  });

  test('a MAT-file cut pasted into a JSON dictionary moves the variable: its removal is the MAT-file\'s own undo step', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'target.sldd');
    m.view.send({ type: 'cut', rowIds: [variableRow(m.view.posts, 'x').ID] });
    await onJson(j, { type: 'paste', rowId: 'section:design' });
    await moveDone();
    await waitFor('the original taken out', () => !m.names().includes('x'));
    assert.deepStrictEqual(errorsIn(j.view.posts), []);
    assert.ok(j.names().includes('x'));
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str']);
    assert.strictEqual(m.events.length, 1, 'ONE edit in the MAT-file');
    assert.strictEqual(m.events[0].label, 'Move (remove source)');
    assert.strictEqual(m.doc.edits.dirty, true);
    await m.events[0].undo();
    assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x'], 'its undo puts the original back');
    assert.strictEqual(m.doc.edits.dirty, false);
  });

  test('a MAT-file copy and cut pasted into a binary dictionary', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const b = await openBinary(opened, dir, 'target.sldd');
    m.view.send({ type: 'copy', rowIds: [variableRow(m.view.posts, 'p').ID] });
    await onBinary(b, { type: 'paste', rowId: 'section:design' });
    assert.deepStrictEqual(errorsIn(b.view.posts), []);
    assert.ok(b.names().includes('p'), 'the copy landed');
    assert.deepStrictEqual(columnsOf(shownCells(binaryEntry(b, 'p')), VALUE_COLUMNS), columnsOf(shownCells(m.variable('p')), VALUE_COLUMNS));
    assert.strictEqual(m.events.length, 0, 'the copy changed nothing in the MAT-file');

    m.view.send({ type: 'cut', rowIds: [variableRow(m.view.posts, 'str').ID] });
    await onBinary(b, { type: 'paste', rowId: 'section:design' });
    await moveDone();
    await waitFor('the original taken out', () => !m.names().includes('str'));
    assert.deepStrictEqual(errorsIn(b.view.posts), []);
    assert.ok(b.names().includes('str'));
    assert.deepStrictEqual(m.names(), ['p', 'q', 'x']);
    assert.strictEqual(m.events.length, 1);
    assert.strictEqual(b.events.length, 2, 'two pastes, two edits in the dictionary');
  });

  for (const format of ['JSON', 'binary'] as const) {
    test(`${format} dictionary entries pasted into a MAT-file: a plain value, a struct, a Parameter with its properties, a Bus with its elements`, async () => {
      const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
      const d = format === 'JSON' ? await openJson(opened, dir, 'source.sldd') : await openBinary(opened, dir, 'source.sldd');
      const names = ['charStr', 'myStruct', 'gravity', 'MyBus'];
      const source = (name: string) => (format === 'JSON' ? jsonEntry(d as JsonTab, name, (e) => shownCells(e)) : shownCells(binaryEntry(d as BinaryTab, name)));
      d.view.send({ type: 'copy', rowIds: names.map((n) => entryRow(d.view.posts, n).ID) });
      await onMat(m, { type: 'paste', rowId: variableRow(m.view.posts, 'q').ID });
      assert.deepStrictEqual(errorsIn(m.view.posts), []);
      assert.deepStrictEqual(m.names(), ['p', 'q', 'str', 'x', ...names]);
      assert.strictEqual(m.events.length, 1, 'ONE edit for the four');
      for (const name of names) {
        assert.deepStrictEqual(columnsOf(shownCells(m.variable(name)), VALUE_COLUMNS), columnsOf(source(name), VALUE_COLUMNS), `${name} is what was copied`);
      }
      const gravity = shownCells(m.variable('gravity'))['.'];
      assert.deepStrictEqual([gravity.Value, gravity.Min, gravity.Max, gravity.Unit, gravity.Description], ['9.81', '0', '100', 'm/s^2', 'gravity accel']);
      assert.deepStrictEqual(Object.values(shownCells(m.variable('MyBus'))).map((r) => r.Name), ['MyBus', 'x', 'y'], 'the Bus came with its elements');

      // A cut: the entry leaves the dictionary once it has landed here.
      const fresh = await openMat(opened, dir, 'fresh.mat', emptyMat());
      d.view.send({ type: 'cut', rowIds: [entryRow(d.view.posts, 'gravity').ID] });
      await onMat(fresh, { type: 'paste', rowId: '' });
      await moveDone();
      await waitFor('the original taken out of the dictionary', () => !d.names().includes('gravity'));
      assert.deepStrictEqual(errorsIn(fresh.view.posts), []);
      assert.deepStrictEqual(fresh.names(), ['gravity']);
    });
  }

  // What a dictionary of one kind cannot hold is that dictionary's paste to refuse, since a copy
  // does not know where it will land: a function handle travels (a text dictionary holds one as
  // its literal), and the binary dictionary's paste refuses it as it writes the entry's XML — the
  // writer core's copyRefusal(id, 'xml') dry-runs, so the two say the same.
  test('a function handle copied out of a MAT-file pastes into a JSON dictionary, and is refused by a binary one in core\'s words', async () => {
    const m = await openMat(opened, dir, 'handles.mat', matFixture('nested_handles.mat'));
    const j = await openJson(opened, dir, 'target.sldd');
    const b = await openBinary(opened, dir, 'bin.sldd');
    const xmlRefusal = DataModel.copyRefusal(m.variable('s_fh').id, 'xml');
    assert.ok(xmlRefusal, 'core says a binary dictionary cannot hold it');
    m.view.send({ type: 'copy', rowIds: [variableRow(m.view.posts, 's_fh').ID] });
    assert.ok(getClipboard(), 'it can be copied');
    await onJson(j, { type: 'paste', rowId: 'section:design' });
    assert.deepStrictEqual(errorsIn(j.view.posts), []);
    assert.ok(j.names().includes('s_fh'), 'a text dictionary takes it');
    const chunk = b.doc.chunkXml;
    await onBinary(b, { type: 'paste', rowId: 'section:design' });
    const [said] = errorsIn(b.view.posts);
    assert.ok(said, 'the binary dictionary refused it');
    assert.ok(
      said.includes(xmlRefusal!.replace(/^Cannot copy "s_fh" into a binary dictionary: /, '').replace(/ Nothing was copied\.$/, '').replace(/\.$/, '')),
      `in the words core's copyRefusal gives (${said})`,
    );
    assert.strictEqual(b.doc.chunkXml, chunk, 'and wrote nothing');
    assert.strictEqual(b.events.length, 0);
  });

  test('row drags between a MAT-file and both dictionary formats, both ways, moving and copying', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'json.sldd');
    const b = await openBinary(opened, dir, 'bin.sldd');
    // Row ids as first painted: a gesture's own repaint of a dictionary is entry-scoped.
    const [jGravity, jStruct, bGravity] = [entryRow(j.view.posts, 'gravity').ID, entryRow(j.view.posts, 'myStruct').ID, entryRow(b.view.posts, 'gravity').ID];

    // MAT-file -> JSON dictionary, moved: the original leaves as the MAT-file's own edit.
    m.view.send({ type: 'dragStart', rowIds: [variableRow(m.view.posts, 'x').ID] });
    await onJson(j, { type: 'drop', rowId: jGravity, mode: 'move' });
    await waitFor('the original moved out', () => !m.names().includes('x'));
    assert.ok(j.names().includes('x'));
    assert.strictEqual(m.events.length, 1);
    assert.strictEqual(getDrag(), null);

    // MAT-file -> binary dictionary, copied.
    m.view.send({ type: 'dragStart', rowIds: [variableRow(m.view.posts, 'str').ID] });
    await onBinary(b, { type: 'drop', rowId: 'section:design', mode: 'copy' });
    assert.ok(b.names().includes('str'));
    assert.ok(m.names().includes('str'), 'a copy leaves its original');

    // JSON dictionary -> MAT-file, moved: the entry leaves the dictionary's text.
    j.view.send({ type: 'dragStart', rowIds: [jStruct] });
    await onMat(m, { type: 'drop', rowId: '', mode: 'move' });
    await waitFor('the entry moved out of the JSON dictionary', () => !j.names().includes('myStruct'));
    assert.ok(m.names().includes('myStruct'));

    // Binary dictionary -> MAT-file, moved: the entry leaves the dictionary's chunk.
    b.view.send({ type: 'dragStart', rowIds: [bGravity] });
    await onMat(m, { type: 'drop', rowId: variableRow(m.view.posts, 'p').ID, mode: 'move' });
    await waitFor('the entry moved out of the binary dictionary', () => !b.names().includes('gravity'));
    assert.ok(m.names().includes('gravity'));
    assert.deepStrictEqual(errorsIn(m.view.posts), []);
    assert.strictEqual(getDrag(), null);
  });

  test('MAT-file to MAT-file: a copy, a cut, a drop that moves and one that copies', async () => {
    const a = await openMat(opened, dir, 'a.mat', matFixture('pv_basic.mat'));
    const c = await openMat(opened, dir, 'c.mat', emptyMat());
    a.view.send({ type: 'copy', rowIds: [variableRow(a.view.posts, 'x').ID] });
    await onMat(c, { type: 'paste', rowId: '' });
    assert.deepStrictEqual(c.names(), ['x']);
    assert.strictEqual(a.events.length, 0);

    a.view.send({ type: 'cut', rowIds: [variableRow(a.view.posts, 'str').ID] });
    await onMat(c, { type: 'paste', rowId: '' });
    await moveDone();
    assert.deepStrictEqual(c.names(), ['x', 'str']);
    assert.deepStrictEqual(a.names(), ['p', 'q', 'x']);
    assert.strictEqual(a.events.length, 1);

    a.view.send({ type: 'dragStart', rowIds: [variableRow(a.view.posts, 'q').ID] });
    assert.ok(getDrag(), 'the drag is on');
    await onMat(c, { type: 'drop', rowId: '', mode: 'move' });
    await waitFor('the original moved out', () => !a.names().includes('q'));
    assert.deepStrictEqual(c.names(), ['x', 'str', 'q']);
    assert.strictEqual(getDrag(), null, 'a drop ends the drag');

    a.view.send({ type: 'dragStart', rowIds: [variableRow(a.view.posts, 'p').ID] });
    await onMat(c, { type: 'drop', rowId: variableRow(c.view.posts, 'x').ID, mode: 'copy' });
    assert.deepStrictEqual(c.names(), ['x', 'str', 'q', 'p']);
    assert.deepStrictEqual(a.names(), ['p', 'x'], 'a copy leaves its original');
    assert.deepStrictEqual(columnsOf(shownCells(c.variable('p')), VALUE_COLUMNS), columnsOf(shownCells(a.variable('p')), VALUE_COLUMNS));
  });

  test('a drag within one MAT-file: a move is the no-op, a copy a duplicate', async () => {
    const a = await openMat(opened, dir, 'a.mat', matFixture('pv_basic.mat'));
    const [x, p] = [variableRow(a.view.posts, 'x').ID, variableRow(a.view.posts, 'p').ID];
    a.view.send({ type: 'dragStart', rowIds: [x] });
    a.view.posts.length = 0;
    a.view.send({ type: 'drop', rowId: p, mode: 'move' });
    await waitFor('the drag to end', () => getDrag() === null);
    await quiet(150, 'an edit or a word the no-op must not make');
    assert.deepStrictEqual(errorsIn(a.view.posts), []);
    assert.strictEqual(a.events.length, 0);
    a.view.send({ type: 'dragStart', rowIds: [x] });
    await onMat(a, { type: 'drop', rowId: '', mode: 'copy' });
    assert.deepStrictEqual(a.names(), ['p', 'q', 'str', 'x', 'x1']);
  });

  test('saved after a cross-format paste, and read back: the values are what was copied', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'both.sldd');
    const b = await openBinary(opened, dir, 'bin.sldd');
    const names = ['charStr', 'myStruct', 'gravity', 'MyBus'];
    j.view.send({ type: 'copy', rowIds: names.map((n) => entryRow(j.view.posts, n).ID) });
    await onMat(m, { type: 'paste', rowId: '' });
    await vscodeSave(m);
    for (const name of names) {
      assert.deepStrictEqual(
        readMat(disk(m), (mat) => columnsOf(shownCells(mat.children.find((v: any) => v.name === name)), VALUE_COLUMNS)),
        jsonEntry(j, name, (e) => columnsOf(shownCells(e), VALUE_COLUMNS)),
        `${name}, saved into the MAT-file and read back`,
      );
    }

    m.view.send({ type: 'copy', rowIds: [variableRow(m.view.posts, 'x').ID, variableRow(m.view.posts, 'p').ID] });
    await onJson(j, { type: 'paste', rowId: 'section:design' });
    assert.ok(await j.doc.save(), 'the JSON dictionary saved');
    await onBinary(b, { type: 'paste', rowId: 'section:design' });
    await b.provider.saveCustomDocument(b.doc, new vscode.CancellationTokenSource().token);
    for (const name of ['x', 'p']) {
      const want = columnsOf(shownCells(m.variable(name)), VALUE_COLUMNS);
      assert.deepStrictEqual(readSldd(disk(j), (d) => columnsOf(shownCells(entryOf(d, name)), VALUE_COLUMNS)), want, `${name} in the saved JSON dictionary`);
      assert.deepStrictEqual(readSldd(disk(b), (d) => columnsOf(shownCells(entryOf(d, name)), VALUE_COLUMNS)), want, `${name} in the saved binary dictionary`);
    }
  });
});

suite('MAT-file pastes and drops refused', () => {
  const scratchDir = scratch();
  const opened = scratchDir.opened;
  let dir = '';
  setup(() => (dir = scratchDir.dir()));

  /** Asserts the MAT-file took nothing: no edit, still clean, the same variables. */
  const unchanged = (m: MatTab, names: string[]) => {
    assert.strictEqual(m.events.length, 0, 'no edit reached VS Code');
    assert.strictEqual(m.doc.edits.dirty, false);
    assert.deepStrictEqual(m.names(), names);
  };

  test("what a MAT-file cannot take is refused in core's words, nothing changes, and a cut keeps its source", async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'source.sldd');
    const was = m.names();

    j.view.send({ type: 'copy', rowIds: [entryRow(j.view.posts, 'MyEnum').ID] });
    await onMat(m, { type: 'paste', rowId: '' });
    assert.deepStrictEqual(errorsIn(m.view.posts), [
      'Cannot paste "MyEnum" into "gains.mat": it is an enumeration\'s definition, which a MAT-file does not hold: ' +
        'MATLAB defines an enumeration in a class file or a data dictionary. Nothing was pasted.',
    ]);
    unchanged(m, was);

    j.view.send({ type: 'cut', rowIds: [entryRow(j.view.posts, 'MyLUT').ID] });
    await onMat(m, { type: 'paste', rowId: '' });
    assert.match(errorsIn(m.view.posts)[0], /^Cannot paste "MyLUT" into "gains\.mat": it is a Simulink\.LookupTable, /);
    unchanged(m, was);
    assert.strictEqual(getClipboard()?.mode, 'cut', 'the cut is kept for another try');
    await quiet(150, 'a source delete the refusal must not make');
    assert.ok(j.names().includes('MyLUT'), 'and its source keeps the entry');

    // All of them or none: a value core will not make as it was copied refuses the whole paste.
    j.view.send({ type: 'copy', rowIds: [entryRow(j.view.posts, 'charStr').ID, entryRow(j.view.posts, 'pInt16').ID] });
    await onMat(m, { type: 'paste', rowId: '' });
    assert.match(errorsIn(m.view.posts)[0], /^Cannot paste "pInt16" into "gains\.mat": pInt16\.Value is a 1x1 int16/);
    unchanged(m, was);
  });

  test('a read-only MAT-file is no target, and says why', async () => {
    const junk = new Uint8Array([...matFixture('pv_basic.mat'), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const ro = await openMat(opened, dir, 'tail.mat', junk);
    const j = await openJson(opened, dir, 'source.sldd');
    assert.deepStrictEqual(ro.view.posts.find((p) => p.type === 'sectionRules').rules, [], 'no drop or paste rule');
    const was = ro.names();
    j.view.send({ type: 'copy', rowIds: [entryRow(j.view.posts, 'charStr').ID] });
    await onMat(ro, { type: 'paste', rowId: '' });
    assert.match(errorsIn(ro.view.posts)[0], /^Read-only: Cannot save "tail\.mat": /);
    unchanged(ro, was);
    j.view.send({ type: 'dragStart', rowIds: [entryRow(j.view.posts, 'charStr').ID] });
    await onMat(ro, { type: 'drop', rowId: '', mode: 'move' });
    assert.match(errorsIn(ro.view.posts)[0], /^Read-only: /);
    unchanged(ro, was);
    assert.strictEqual(getDrag(), null);
    assert.ok(j.names().includes('charStr'), 'the refused move left its source alone');
  });

  test('a variable whose name its file holds twice offers no Copy or Cut; the file says why, and the others travel', async () => {
    const d = await openMat(opened, dir, 'twice.mat', twiceNamedMat());
    assert.deepStrictEqual(d.names(), ['x', 'str', 'x']);
    const set = d.view.posts.find((p) => p.type === 'setRows');
    assert.match(JSON.stringify(set.warnings), /Two entries in twice\.mat are named 'x'/, 'the banner names the file, not its srcId');
    const [x, str] = [variableRow(d.view.posts, 'x').ID, variableRow(d.view.posts, 'str').ID];
    // Its rows offer no Copy (and so no Cut): the menu says so before anything is clicked.
    const rows = d.view.posts.find((p) => p.type === 'setRows').rows as any[];
    assert.deepStrictEqual(rows.filter((r) => r.parent == null).map((r) => [r.Name.label, r._canCopy]), [
      ['x', false],
      ['str', true],
      ['x', false],
    ]);
    // And a chord or a stale menu that sends one anyway is answered, not acted on.
    for (const mode of ['copy', 'cut'] as const) {
      d.view.posts.length = 0;
      d.view.send({ type: mode, rowIds: [x] });
      assert.deepStrictEqual(errorsIn(d.view.posts), [`Could not ${mode} the selected item.`]);
      assert.strictEqual(getClipboard(), null);
    }
    d.view.send({ type: 'cut', rowIds: [str] });
    assert.deepStrictEqual(getClipboard()?.items.map((i) => i.payload.name), ['str']);
  });

  test('a move whose original became one of two of its name is pasted, and the original kept, said', async () => {
    const a = await openMat(opened, dir, 'back.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'target.sldd');
    a.view.send({ type: 'cut', rowIds: [variableRow(a.view.posts, 'x').ID] });
    // Another program writes the file over, holding two x: the view, which has no unsaved edit,
    // reloads it, and the cut's original is now one of two.
    writeOutside(a.path, twiceNamedMat());
    await waitFor('the reload', () => a.names().join() === 'x,str,x');
    await onJson(j, { type: 'paste', rowId: 'section:design' });
    await moveDone();
    await waitFor('the report', () => errorsIn(j.view.posts).length > 0);
    assert.deepStrictEqual(errorsIn(j.view.posts), [
      'Pasted here, but the original in back.mat could not be removed: it holds more than one "x", and a move takes its original out by name. Remove it there by hand.',
    ]);
    assert.ok(j.names().includes('x'), 'the paste landed');
    assert.deepStrictEqual(a.names(), ['x', 'str', 'x'], 'and nothing was guessed at in the MAT-file');
    assert.strictEqual(a.events.length, 0);
  });

  test('a move whose source delete core recorded and then threw is answered by what the file holds: done', async () => {
    const a = await openMat(opened, dir, 'throws.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'target.sldd');
    a.view.send({ type: 'cut', rowIds: [variableRow(a.view.posts, 'x').ID] });
    const deleteNodesById = (DataModel as any).deleteNodesById;
    (DataModel as any).deleteNodesById = (...args: unknown[]) => {
      const done = deleteNodesById(...args);
      throw new Error(`after the delete (${done})`);
    };
    try {
      await onJson(j, { type: 'paste', rowId: 'section:design' });
      await moveDone();
      await waitFor('the original taken out', () => !a.names().includes('x'));
      await quiet(150, 'a report the move must not make');
    } finally {
      (DataModel as any).deleteNodesById = deleteNodesById;
    }
    assert.deepStrictEqual(errorsIn(j.view.posts), [], 'no "remove it there by hand" for an original that is gone');
    assert.ok(j.names().includes('x'));
    assert.strictEqual(a.events.length, 1, 'the delete is an edit VS Code was handed');
    await a.events[0].undo();
    assert.ok(a.names().includes('x'), 'and its undo puts the original back');
  });

  test('the drag register is let go of after a drop that landed, one refused, and one that failed', async () => {
    const m = await openMat(opened, dir, 'gains.mat', matFixture('pv_basic.mat'));
    const j = await openJson(opened, dir, 'source.sldd');

    j.view.send({ type: 'dragStart', rowIds: [entryRow(j.view.posts, 'charStr').ID] });
    await onMat(m, { type: 'drop', rowId: '', mode: 'copy' });
    assert.deepStrictEqual(errorsIn(m.view.posts), []);
    assert.ok(m.names().includes('charStr'));
    assert.strictEqual(getDrag(), null, 'landed');

    j.view.send({ type: 'dragStart', rowIds: [entryRow(j.view.posts, 'MyEnum').ID] });
    await onMat(m, { type: 'drop', rowId: '', mode: 'copy' });
    assert.match(errorsIn(m.view.posts)[0], /^Cannot paste "MyEnum" into "gains\.mat"/);
    assert.strictEqual(getDrag(), null, 'refused');

    const paste = (DataModel as any).pasteEntries;
    (DataModel as any).pasteEntries = () => {
      throw new Error('the paste broke');
    };
    try {
      j.view.send({ type: 'dragStart', rowIds: [entryRow(j.view.posts, 'myStruct').ID] });
      m.view.posts.length = 0;
      m.view.send({ type: 'drop', rowId: '', mode: 'move' });
      await waitFor('the failure said', () => errorsIn(m.view.posts).length > 0);
    } finally {
      (DataModel as any).pasteEntries = paste;
    }
    assert.deepStrictEqual(errorsIn(m.view.posts), ['Failed to apply edit: the paste broke']);
    assert.strictEqual(getDrag(), null, 'failed');
    assert.ok(j.names().includes('myStruct'), 'a failed move takes nothing out of its source');
  });
});
