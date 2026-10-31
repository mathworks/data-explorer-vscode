// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file editor's clipboard, end to end: a cross-format paste through the real providers,
// saved by VS Code, and read back. The gestures themselves (copy, cut, paste, dragStart and drop,
// and what each document then holds and undoes) are view's MAT-file engine's tests now.
//
// A MAT-file takes the same gestures a dictionary does, through the same rules (view's transfer.ts
// and clipboardAction.ts): a copy pasted into the file it came from is a duplicate under a unique
// name, a move within it is the no-op of a move back into its own section (the file is one
// section, ''), and a move into another document is the paste there and the delete here, each its
// own document's undo step. What is the MAT-file's own is what the edit IS: core's pasteEntries,
// all of the entries or none, in ONE undo step; and what a file takes is core's to say, in its
// words.
//
// Every document is a scratch copy in tmpdir, outside the workspace folder: the MAT-files from
// test-integration/fixtures/mat (MATLAB-written), the dictionaries from the workspace's params.sldd
// and its binary twin.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { registers } from '../../src/host/windowRegisters';
import { quiet, waitFor } from './tools/hostHarness';
import { closeAll, entryOf, entryRow, errorsIn, matFixture, openBinary, openJson, openMat, readMat, readSldd, shownCells, variableRow, type BinaryTab, type JsonTab, type MatTab, type Opened } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

const disk = (tab: { path: string }) => new Uint8Array(readFileSync(tab.path));

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
    registers.clearClipboard();
    registers.clearDrag();
  });
  teardown(async () => {
    closeAll(opened);
    registers.clearClipboard();
    registers.clearDrag();
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });
  return { opened, dir: () => dir };
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

suite('MAT-file clipboard and row drags, between a MAT-file and a dictionary', () => {
  const scratchDir = scratch();
  const opened = scratchDir.opened;
  let dir = '';
  setup(() => (dir = scratchDir.dir()));

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
