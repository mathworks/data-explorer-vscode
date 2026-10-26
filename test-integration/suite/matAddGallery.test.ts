// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file editor's Add gallery, end to end: the classes the view is told the file can take,
// one variable of each added as a tile asks for it, saved, and read back by opening the saved file
// again; the add undone; Save As; a Bus's elements added and removed from the table; a file with
// no objects at all, whose first object brings its subsystem; and a read-only file, which offers
// no gallery and takes no add.
//
// As in matEdit.test.ts, every save is held to what it did NOT touch: each variable nobody edited
// is the bytes it was read from. With DEX_GATE_OUT set, every file a save here writes is copied
// there with the file it came from and a manifest, so that MATLAB itself can judge the bytes this
// extension writes: a live gate outside this repo loads each in every release it must load in.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel, parseMat } from 'data-explorer-core';
import { MatEditorProvider } from '../../src/host/MatEditorProvider';
import { ctx, fakePanel, nameOf, quiet, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ctx().extensionUri.fsPath, 'test-integration', 'fixtures', 'mat', name)));

/** A Level-5 file of one double, `x` = 1, and no objects: no subsystem at all. */
function plainMat(): Uint8Array {
  const out = new Uint8Array(128 + 64);
  out.fill(0x20, 0, 116);
  out.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, written by a test'), 0);
  out.set([0x00, 0x01, 0x49, 0x4d], 124);
  const v = new DataView(out.buffer, 128);
  const words: [number, number][] = [[0, 14], [4, 56], [8, 6], [12, 8], [16, 6], [24, 5], [28, 8], [32, 1], [36, 1], [40, (1 << 16) | 1], [48, 9], [52, 8]];
  for (const [at, w] of words) v.setUint32(at, w, true);
  v.setUint8(44, 0x78);
  v.setFloat64(56, 1, true);
  return out;
}

/** The file's records by variable name (the subsystem, which has none, as `''`). */
function recordsOf(bytes: Uint8Array): Map<string, Uint8Array> {
  const parsed: any = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return new Map(parsed.records.map((r: any) => [r.name ?? '', r.bytes]));
}

const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** Every variable record of `before` but `changed` is in `after` as the bytes it was. */
function keptUntouched(before: Uint8Array, after: Uint8Array, changed: string[]): void {
  const now = recordsOf(after);
  for (const [name, rec] of recordsOf(before)) {
    if (name === '' || changed.includes(name)) continue;
    assert.ok(now.has(name), `"${name}" is still in the saved file`);
    assert.ok(same(now.get(name)!, rec), `"${name}" is the bytes it was read from`);
  }
}

/** The rows the table holds now: the last setRows with every updateEntryRows after it spliced in. */
function tableOf(posts: any[]): any[] {
  let rows: any[] = [];
  for (const p of posts) {
    if (p.type === 'setRows') rows = p.rows;
    else if (p.type === 'updateEntryRows') {
      const start = rows.findIndex((r) => r.ID === p.entryRowId);
      if (start < 0) continue;
      const subtree = new Set([p.entryRowId]);
      let end = start + 1;
      while (end < rows.length && subtree.has(rows[end].parent)) subtree.add(rows[end++].ID);
      rows = [...rows.slice(0, start), ...p.rows, ...rows.slice(end)];
    }
  }
  return rows;
}

const topRowOrNull = (posts: any[], name: string): any => tableOf(posts).find((r) => r.parent == null && nameOf(r) === name) ?? null;
const topRow = (posts: any[], name: string): any => {
  const row = topRowOrNull(posts, name);
  assert.ok(row, `the table has a row for "${name}"`);
  return row;
};
const childrenOf = (posts: any[], row: any): string[] => tableOf(posts).filter((r) => r.parent === row.ID).map(nameOf);
const lastSetRows = (posts: any[]): any => [...posts].reverse().find((p) => p.type === 'setRows');

// Each tile's class, the default name core gives its first variable, the class that variable
// reports, and what the creation gate builds it as in MATLAB.
const TILES: Record<string, { name: string; reports: string; gate: { class: string; construct?: string } }> = {
  MatlabVariable: { name: 'var', reports: 'double', gate: { class: 'double', construct: '0' } },
  MatlabStruct: { name: 'Struct', reports: 'struct', gate: { class: 'struct', construct: 'struct()' } },
  string: { name: 'str', reports: 'string', gate: { class: 'string' } },
  'Simulink.Parameter': { name: 'Param', reports: 'Simulink.Parameter', gate: { class: 'Simulink.Parameter' } },
  'Simulink.Signal': { name: 'Signal', reports: 'Simulink.Signal', gate: { class: 'Simulink.Signal' } },
  'Simulink.Bus': { name: 'Bus', reports: 'Simulink.Bus', gate: { class: 'Simulink.Bus' } },
  'Simulink.LookupTable': { name: 'LookupTable', reports: 'Simulink.LookupTable', gate: { class: 'Simulink.LookupTable' } },
  'Simulink.Breakpoint': { name: 'Breakpoint', reports: 'Simulink.Breakpoint', gate: { class: 'Simulink.Breakpoint' } },
  'Simulink.NumericType': { name: 'NumericType', reports: 'Simulink.NumericType', gate: { class: 'Simulink.NumericType' } },
  'Simulink.AliasType': { name: 'AliasType', reports: 'Simulink.AliasType', gate: { class: 'Simulink.AliasType' } },
  'Simulink.ValueType': { name: 'ValueType', reports: 'Simulink.ValueType', gate: { class: 'Simulink.ValueType' } },
};

// ---- What the creation live gate is handed, with DEX_GATE_OUT set ------------------------------

const GATE_OUT = process.env.DEX_GATE_OUT;
const gateFiles: any[] = [];
let gateN = 0;

/** The saved file and the one it came from, copied for the gate, with what MATLAB should find. */
function forGate(original: Uint8Array, savedPath: string, entry: { new?: any[]; edited?: any[]; removed?: string[] }): void {
  if (!GATE_OUT) return;
  mkdirSync(GATE_OUT, { recursive: true });
  const n = String(++gateN).padStart(3, '0');
  const file = join(GATE_OUT, `${n}_saved.mat`);
  const before = join(GATE_OUT, `${n}_original.mat`);
  copyFileSync(savedPath, file);
  writeFileSync(before, original);
  gateFiles.push({ file, original: before, ...entry });
}

suite('MAT-file editor: the Add gallery', () => {
  let dir: string;
  let provider: MatEditorProvider;
  const opened: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  suiteTeardown(() => {
    if (GATE_OUT && gateFiles.length > 0) writeFileSync(join(GATE_OUT, 'manifest.json'), JSON.stringify({ files: gateFiles }, null, 1));
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-matadd-'));
    provider = new MatEditorProvider(ctx());
  });

  teardown(async () => {
    for (const { doc, view } of opened.splice(0)) {
      view.close();
      doc.dispose();
    }
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** A copy of `bytes` in this test's directory as `as`, opened and painted, with every edit it raises. */
  async function open(as: string, bytes: Uint8Array) {
    const path = join(dir, as);
    writeFileSync(path, bytes);
    return openPath(path, bytes);
  }

  /**
   * The file at `path` as another tab would open it after the save: a copy, so that it is a
   * document of its own (one uri is one source of the session, and opening the saved file itself
   * again would take it over from the view still editing it).
   */
  let reopened = 0;
  async function reopen(path: string) {
    const copy = join(dir, `reopened${++reopened}.mat`);
    copyFileSync(path, copy);
    return openPath(copy);
  }

  async function openPath(path: string, original: Uint8Array = new Uint8Array(readFileSync(path))) {
    const uri = vscode.Uri.file(path);
    const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    opened.push({ doc, view });
    const events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    provider.onDidChangeCustomDocument((e) => {
      if (e.document === doc) events.push(e);
    });
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor(`${path}'s first rows`, () => view.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
    return { path, uri, doc, view, events, original };
  }

  type Opened = Awaited<ReturnType<typeof open>>;
  const save = (o: { doc: any }) => provider.saveCustomDocument(o.doc, token());
  const disk = (o: { path: string }) => new Uint8Array(readFileSync(o.path));
  const add = (o: Opened, className: string, rename = true) => o.view.send({ type: 'addEntry', section: '', className, rename });

  /** The classes the core this runs against says `bytes` can take, read off the source as the view does. */
  function coreClasses(bytes: Uint8Array): string[] {
    const srcId = `matadd-classes:${Math.random()}`;
    const mat: any = DataModel.addMatSource(srcId, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { path: 'c.mat' });
    try {
      return mat.getAllowedTypes();
    } finally {
      DataModel.removeDataSource(srcId);
    }
  }

  test('the view is told the classes core lists for the file, and the gallery is those', async () => {
    const o = await open('cases.mat', fixture('cases.mat'));
    const set = lastSetRows(o.view.posts);
    assert.strictEqual(set.editable, true);
    assert.deepStrictEqual(set.add, { classes: coreClasses(o.original) });
    for (const c of ['MatlabVariable', 'MatlabStruct', 'Simulink.Parameter', 'Simulink.Bus', 'string']) {
      assert.ok(set.add.classes.includes(c), `the file can take a new ${c}`);
    }
    for (const c of set.add.classes) assert.ok(TILES[c], `every class core lists is one this suite adds (${c})`);
  });

  for (const className of Object.keys(TILES)) {
    test(`a ${className} tile adds one, which saves, reopens as it was, undoes, and saves as`, async () => {
      const t = TILES[className];
      const o = await open('cases.mat', fixture('cases.mat'));
      if (!lastSetRows(o.view.posts).add.classes.includes(className)) return; // core does not list it for this file
      add(o, className);
      assert.strictEqual(o.events.length, 1, 'one edit reached VS Code');
      await waitFor(`the ${t.name} row`, () => !!topRowOrNull(o.view.posts, t.name));
      const row = topRow(o.view.posts, t.name);
      assert.strictEqual(row.Class, t.reports);
      assert.strictEqual(row.Status, 'New');
      const rename = o.view.posts.find((p) => p.type === 'beginRename');
      assert.ok(rename && rename.rowId === row.ID, 'its name editor is asked for');
      await save(o);
      assert.strictEqual(o.doc.edits.dirty, false);
      keptUntouched(o.original, disk(o), [t.name]);
      forGate(o.original, o.path, { new: [{ var: t.name, ...t.gate }] });
      // Reopened from the disk: the row it showed before the save.
      const again = await reopen(o.path);
      const back = topRow(again.view.posts, t.name);
      assert.strictEqual(back.Class, row.Class);
      assert.strictEqual(back.Value, row.Value);
      // Undone, the file saves as it was read.
      await o.events[0].undo();
      await waitFor('the added row gone', () => !topRowOrNull(o.view.posts, t.name));
      await save(o);
      assert.ok(!recordsOf(disk(o)).has(t.name), 'the undone variable is not saved');
      keptUntouched(o.original, disk(o), []);
      // Redone and saved elsewhere: the copy holds it, the file it came from is left as last saved.
      await o.events[0].redo();
      await waitFor('the row back', () => !!topRowOrNull(o.view.posts, t.name));
      const target = vscode.Uri.file(join(dir, 'copy.mat'));
      await provider.saveCustomDocumentAs(o.doc, target, token());
      const copy = new Uint8Array(readFileSync(target.fsPath));
      assert.ok(recordsOf(copy).has(t.name), 'Save As wrote the new variable');
      keptUntouched(o.original, copy, [t.name]);
      assert.ok(!recordsOf(disk(o)).has(t.name), 'and left the original file as it was last saved');
    });
  }

  // The way to a string the gallery has no tile for (MAT_OMITTED): a variable's Value typed as one.
  test('a variable whose Value is typed "abc" becomes a string, which saves in its place, reopens as one, and undoes', async () => {
    const o = await open('cases.mat', fixture('cases.mat'));
    const order = (posts: any[]) => tableOf(posts).filter((r) => r.parent == null).map(nameOf);
    const before = order(o.view.posts);
    const row = topRow(o.view.posts, 'kp');
    assert.notStrictEqual(row.Class, 'string');
    o.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: row.Value, newValue: '"abc"' });
    await waitFor('kp a string', () => topRowOrNull(o.view.posts, 'kp')?.Class === 'string');
    assert.strictEqual(topRow(o.view.posts, 'kp').Value, '"abc"');
    assert.deepStrictEqual(order(o.view.posts), before, 'in its place in the table');
    assert.strictEqual(o.events.length, 1, 'one edit reached VS Code');
    await save(o);
    assert.strictEqual(o.doc.edits.dirty, false);
    keptUntouched(o.original, disk(o), ['kp']);
    forGate(o.original, o.path, { edited: [{ var: 'kp', class: 'string' }] });
    // Reopened from the disk: a string, where it was.
    const again = await reopen(o.path);
    assert.strictEqual(topRow(again.view.posts, 'kp').Class, 'string');
    assert.strictEqual(topRow(again.view.posts, 'kp').Value, '"abc"');
    assert.deepStrictEqual(order(again.view.posts), before, 'and in its place in the file');
    // Undone, the variable is what it was, and the file saves as it was read.
    await o.events[0].undo();
    await waitFor('kp back as it was', () => topRowOrNull(o.view.posts, 'kp')?.Class === row.Class);
    assert.strictEqual(topRow(o.view.posts, 'kp').Value, row.Value);
    await save(o);
    keptUntouched(o.original, disk(o), []);
  });

  test('a string variable whose Value is typed 0 becomes a double, which saves in its place and reopens as one', async () => {
    const o = await open('cases.mat', fixture('cases.mat'));
    const order = (posts: any[]) => tableOf(posts).filter((r) => r.parent == null).map(nameOf);
    const before = order(o.view.posts);
    const row = topRow(o.view.posts, 'strScalar');
    assert.strictEqual(row.Class, 'string');
    o.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: row.Value, newValue: '0' });
    await waitFor('strScalar a double', () => topRowOrNull(o.view.posts, 'strScalar')?.Class === 'double');
    assert.strictEqual(topRow(o.view.posts, 'strScalar').Value, '0');
    assert.deepStrictEqual(order(o.view.posts), before, 'in its place in the table');
    await save(o);
    keptUntouched(o.original, disk(o), ['strScalar']);
    forGate(o.original, o.path, { edited: [{ var: 'strScalar', class: 'double' }] });
    const again = await reopen(o.path);
    assert.strictEqual(topRow(again.view.posts, 'strScalar').Class, 'double');
    assert.strictEqual(topRow(again.view.posts, 'strScalar').Value, '0');
    assert.deepStrictEqual(order(again.view.posts), before, 'and in its place in the file');
    // Undone, the string is back, and the file saves as it was read.
    await o.events[0].undo();
    await waitFor('strScalar a string again', () => topRowOrNull(o.view.posts, 'strScalar')?.Class === 'string');
    assert.strictEqual(topRow(o.view.posts, 'strScalar').Value, row.Value);
    await save(o);
    keptUntouched(o.original, disk(o), []);
  });

  test('a variable added and deleted before a save, or added and undone, leaves the file byte for byte as it was', async () => {
    const o = await open('pv_basic.mat', fixture('pv_basic.mat'));
    add(o, 'Simulink.Parameter', false);
    await waitFor('the Param row', () => !!topRowOrNull(o.view.posts, 'Param'));
    o.view.send({ type: 'delete', rowIds: [topRow(o.view.posts, 'Param').ID] });
    await waitFor('the Param row gone', () => !topRowOrNull(o.view.posts, 'Param'));
    await save(o);
    assert.ok(same(disk(o), o.original), 'the save wrote the file as it was read');
    const u = await open('plain.mat', plainMat());
    add(u, 'Simulink.Signal', false);
    await waitFor('the Signal row', () => !!topRowOrNull(u.view.posts, 'Signal'));
    await u.events[0].undo();
    await waitFor('the Signal row gone', () => !topRowOrNull(u.view.posts, 'Signal'));
    await save(u);
    assert.ok(same(disk(u), u.original), 'no subsystem is written for an object no longer there');
  });

  test('a pinned add asks for no name editor, and two adds of a class take two names', async () => {
    const o = await open('pv_basic.mat', fixture('pv_basic.mat'));
    add(o, 'Simulink.Signal', false);
    add(o, 'Simulink.Signal', false);
    await waitFor('both rows', () => !!topRowOrNull(o.view.posts, 'Signal') && !!topRowOrNull(o.view.posts, 'Signal1'));
    assert.strictEqual(o.view.posts.filter((p) => p.type === 'beginRename').length, 0);
    assert.strictEqual(o.events.length, 2);
    await save(o);
    keptUntouched(o.original, disk(o), ['Signal', 'Signal1']);
    forGate(o.original, o.path, { new: [{ var: 'Signal', class: 'Simulink.Signal' }, { var: 'Signal1', class: 'Simulink.Signal' }] });
  });

  test("a new Bus's elements are added and removed from its row, and save", async () => {
    const o = await open('pv_basic.mat', fixture('pv_basic.mat'));
    add(o, 'Simulink.Bus', false);
    await waitFor('the Bus row', () => !!topRowOrNull(o.view.posts, 'Bus'));
    const bus = topRow(o.view.posts, 'Bus');
    assert.strictEqual(bus._canAddChild, true, 'a Bus row takes a child');
    assert.deepStrictEqual(childrenOf(o.view.posts, bus), []);
    o.view.send({ type: 'addChild', rowId: bus.ID });
    o.view.send({ type: 'addChild', rowId: bus.ID });
    await waitFor('two elements', () => childrenOf(o.view.posts, topRow(o.view.posts, 'Bus')).length === 2);
    assert.deepStrictEqual(childrenOf(o.view.posts, topRow(o.view.posts, 'Bus')), ['a', 'a1']);
    await save(o);
    keptUntouched(o.original, disk(o), ['Bus']);
    forGate(o.original, o.path, {
      new: [{ var: 'Bus', class: 'Simulink.Bus', code: "obj.Elements(1) = Simulink.BusElement; e = Simulink.BusElement; e.Name = 'a1'; obj.Elements(2) = e;" }],
    });
    const again = await reopen(o.path);
    assert.deepStrictEqual(childrenOf(again.view.posts, topRow(again.view.posts, 'Bus')), ['a', 'a1']);
    // One removed, from the table as a delete of its row.
    const first = tableOf(o.view.posts).find((r) => r.parent === topRow(o.view.posts, 'Bus').ID && nameOf(r) === 'a');
    assert.strictEqual(first._canDelete, true);
    o.view.send({ type: 'delete', rowIds: [first.ID] });
    await waitFor('one element left', () => childrenOf(o.view.posts, topRow(o.view.posts, 'Bus')).length === 1);
    await save(o);
    const third = await reopen(o.path);
    assert.deepStrictEqual(childrenOf(third.view.posts, topRow(third.view.posts, 'Bus')), ['a1']);
    forGate(o.original, o.path, {
      new: [{ var: 'Bus', class: 'Simulink.Bus', code: "e = Simulink.BusElement; e.Name = 'a1'; obj.Elements(1) = e;" }],
    });
  });

  test("a Bus the file holds gains an element and loses one, and every other variable is as it was", async () => {
    const o = await open('cases.mat', fixture('cases.mat'));
    const bus = tableOf(o.view.posts).find((r) => r.parent == null && r.Class === 'Simulink.Bus');
    assert.ok(bus, 'cases.mat holds a Bus');
    const name = nameOf(bus);
    const before = childrenOf(o.view.posts, bus);
    assert.ok(before.length > 0);
    o.view.send({ type: 'addChild', rowId: bus.ID });
    await waitFor('the new element', () => childrenOf(o.view.posts, topRow(o.view.posts, name)).length === before.length + 1);
    const firstRow = tableOf(o.view.posts).find((r) => r.parent === topRow(o.view.posts, name).ID && nameOf(r) === before[0]);
    o.view.send({ type: 'delete', rowIds: [firstRow.ID] });
    await waitFor('the first element gone', () => !childrenOf(o.view.posts, topRow(o.view.posts, name)).includes(before[0]));
    const after = childrenOf(o.view.posts, topRow(o.view.posts, name));
    await save(o);
    keptUntouched(o.original, disk(o), [name]);
    const again = await reopen(o.path);
    assert.deepStrictEqual(childrenOf(again.view.posts, topRow(again.view.posts, name)), after);
    const added = after[after.length - 1];
    forGate(o.original, o.path, {
      edited: [{ var: name, code: `e = Simulink.BusElement; e.Name = '${added}'; obj.Elements(end+1) = e; obj.Elements(1) = [];` }],
    });
  });

  test('a file with no objects at all takes a Simulink object, and its subsystem comes with it', async () => {
    const o = await open('plain.mat', plainMat());
    assert.ok(!recordsOf(o.original).has(''), 'the file has no subsystem');
    const set = lastSetRows(o.view.posts);
    assert.deepStrictEqual(set.add, { classes: coreClasses(o.original) });
    assert.ok(set.add.classes.includes('Simulink.Parameter'));
    add(o, 'Simulink.Parameter');
    add(o, 'string');
    await waitFor('both rows', () => !!topRowOrNull(o.view.posts, 'Param') && !!topRowOrNull(o.view.posts, 'str'));
    await save(o);
    const saved = disk(o);
    assert.ok(recordsOf(saved).has(''), 'the save wrote a subsystem');
    keptUntouched(o.original, saved, ['Param', 'str']);
    forGate(o.original, o.path, { new: [{ var: 'Param', class: 'Simulink.Parameter' }, { var: 'str', class: 'string' }] });
    const again = await reopen(o.path);
    assert.strictEqual(topRow(again.view.posts, 'Param').Class, 'Simulink.Parameter');
    assert.strictEqual(topRow(again.view.posts, 'str').Class, 'string');
    assert.strictEqual(topRow(again.view.posts, 'x').Value, '1');
  });

  test('a read-only file offers no gallery and takes no add', async () => {
    const junk = new Uint8Array([...fixture('pv_basic.mat'), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const o = await open('tail.mat', junk);
    const set = lastSetRows(o.view.posts);
    assert.strictEqual(set.editable, false, 'no Add button: the table draws one only where it can add');
    assert.deepStrictEqual(set.add, { classes: [] });
    add(o, 'Simulink.Parameter');
    assert.strictEqual(o.events.length, 0);
    assert.strictEqual(o.doc.edits.dirty, false);
  });

  // Only for the live gate, with DEX_GATE_OUT and DEX_GATE_FIXTURES set: one variable of every
  // class core lists added to each MAT-file of DEX_GATE_FIXTURES, and an element to every Bus it
  // holds, each saved on its own — so the files MATLAB judges come from originals of the
  // releases it is run in (an R2027a-written original with a LookupTable in it does not even
  // re-save in R2023b, edited or not).
  const GATE_FIXTURES = process.env.DEX_GATE_FIXTURES;
  (GATE_OUT && GATE_FIXTURES ? test : test.skip)('every tile, and a Bus element, into each file of DEX_GATE_FIXTURES, for the live gate', async () => {
    const { readdirSync } = await import('fs');
    for (const f of readdirSync(GATE_FIXTURES!).filter((n) => n.endsWith('.mat')).sort()) {
      const bytes = new Uint8Array(readFileSync(join(GATE_FIXTURES!, f)));
      for (const className of coreClasses(bytes)) {
        // A file of its own per add: two documents open on one file are one source of the session.
        const o = await open(`gate_${className}_${f}`, bytes);
        const before = new Set(tableOf(o.view.posts).filter((r) => r.parent == null).map(nameOf));
        add(o, className, false);
        await waitFor(`the new ${className}`, () => tableOf(o.view.posts).some((r) => r.parent == null && !before.has(nameOf(r))));
        const added = nameOf(tableOf(o.view.posts).find((r) => r.parent == null && !before.has(nameOf(r))));
        await save(o);
        forGate(bytes, o.path, { new: [{ var: added, ...TILES[className].gate }] });
      }
      const o = await open(`gate_bus_${f}`, bytes);
      const buses = tableOf(o.view.posts).filter((r) => r.parent == null && r.Class === 'Simulink.Bus');
      if (buses.length === 0) continue;
      const edited: any[] = [];
      for (const bus of buses) {
        const had = childrenOf(o.view.posts, bus);
        o.view.send({ type: 'addChild', rowId: bus.ID });
        await waitFor('the new element', () => childrenOf(o.view.posts, topRow(o.view.posts, nameOf(bus))).length === had.length + 1);
        const now = childrenOf(o.view.posts, topRow(o.view.posts, nameOf(bus)));
        edited.push({ var: nameOf(bus), code: `e = Simulink.BusElement; e.Name = '${now[now.length - 1]}'; obj.Elements(end+1) = e;` });
      }
      await save(o);
      forGate(bytes, o.path, { edited });
    }
  });

  for (const className of ['Simulink.ConfigSet', 'Simulink.data.dictionary.EnumTypeDefinition']) {
    test(`an add of a class the file takes no new variable of (${className}) is refused in core's words, and adds nothing`, async () => {
      const o = await open('cases.mat', fixture('cases.mat'));
      if (lastSetRows(o.view.posts).add.classes.includes(className)) return; // core offers it after all
      const before = tableOf(o.view.posts).length;
      add(o, className);
      await waitFor('the refusal', () => o.view.posts.some((p) => p.type === 'refused'));
      const refusal = o.view.posts.filter((p) => p.type === 'refused').pop();
      assert.strictEqual(refusal.title, 'Cannot Add', 'in the refusal dialog');
      const message: string = refusal.reason;
      // Core's reason (MatNode.addEntryRefusal), with the file named as every other message names it.
      assert.match(message, new RegExp(className.replace('.', '\\.')));
      assert.match(message, /takes a new variable of a plain value, a struct, or one of /);
      assert.ok(message.includes('cases.mat'), `the message names the file: ${message}`);
      assert.ok(!message.includes('binedit:'), 'and not the session source it was opened as');
      assert.strictEqual(o.events.length, 0, 'no edit reached VS Code');
      assert.strictEqual(o.doc.edits.dirty, false);
      assert.strictEqual(tableOf(o.view.posts).length, before, 'no row was added');
    });
  }
});
