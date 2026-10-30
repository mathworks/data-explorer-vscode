// Copyright 2026 The MathWorks, Inc.
//
// The files a MATLAB live gate judges, saved by the extension's editors in real VS Code: a gate
// outside this repo opens each in every MATLAB release it must open in, and reads back what the
// manifest beside it says the file holds.
//
// Runs only when DEX_GATE_OUT is set. Each writer has a folder of its own there:
//   mat-add/    the MAT-file editor's gallery adds and Bus elements, one save each: NNN_saved.mat,
//               the NNN_original.mat it came from, and manifest.json, { files: [{ file, original,
//               new | edited }] }. With DEX_GATE_FIXTURES set too, every tile core lists and an
//               element of every Bus, into each MAT-file of that folder.
//   numbers/    three huge doubles typed into the JSON dictionary editor: numbers.sldd, and
//               numbers.json, { file, typed }.
//   multiline/  a multi-line Description edited through each table editor: NN_<fixture> per save,
//               and manifest.json, { files: [{ file, descriptions }] }, each Description as
//               character codes.
// The gestures, and the files and manifests, are the ones matAddGallery.test.ts,
// jsonEditorNumbers.test.ts and multiLineDescription.test.ts make and write with DEX_GATE_OUT set.
// Those write all three into DEX_GATE_OUT itself, where the last manifest.json written replaces the
// one written before it.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel } from 'data-explorer-core';
import { MatEditorProvider } from '../../src/host/MatEditorProvider';
import { ctx, fakePanel, nameOf, quiet, token, waitFor } from './tools/hostHarness';
import { closeAll, entryRow, fixturePath, matFixture, openJson, tableOf, type Opened } from './tools/tables';
import { BINARY_EDITOR, MAT_EDITOR, TEXT_EDITOR, type EditorKind, type EditorTab } from './tools/editorTabs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OUT = process.env.DEX_GATE_OUT;
const GATE_FIXTURES = process.env.DEX_GATE_FIXTURES;

/** One writer's folder: the files it was handed, numbered in turn, and the manifest of them. */
function gateFolder(name: string) {
  const dir = join(OUT ?? '', name);
  const files: any[] = [];
  return {
    dir,
    files,
    /** The next file's number, `width` digits wide. */
    next: (width: number) => String(files.length + 1).padStart(width, '0'),
    manifest: () => {
      if (files.length > 0) writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ files }, null, 1));
    },
  };
}

// ---- The MAT-file editor's gallery adds ---------------------------------------------------------

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

const topRowOrNull = (posts: any[], name: string): any => tableOf(posts).find((r) => r.parent == null && nameOf(r) === name) ?? null;
const topRow = (posts: any[], name: string): any => {
  const row = topRowOrNull(posts, name);
  assert.ok(row, `the table has a row for "${name}"`);
  return row;
};
const childrenOf = (posts: any[], row: any): string[] => tableOf(posts).filter((r) => r.parent === row.ID).map(nameOf);
const lastSetRows = (posts: any[]): any => [...posts].reverse().find((p) => p.type === 'setRows');

// Each tile's class, the default name core gives its first variable, and what the gate builds it
// as in MATLAB.
const TILES: Record<string, { name: string; gate: { class: string; construct?: string } }> = {
  MatlabVariable: { name: 'var', gate: { class: 'double', construct: '0' } },
  MatlabStruct: { name: 'Struct', gate: { class: 'struct', construct: 'struct()' } },
  string: { name: 'str', gate: { class: 'string' } },
  'Simulink.Parameter': { name: 'Param', gate: { class: 'Simulink.Parameter' } },
  'Simulink.Signal': { name: 'Signal', gate: { class: 'Simulink.Signal' } },
  'Simulink.Bus': { name: 'Bus', gate: { class: 'Simulink.Bus' } },
  'Simulink.LookupTable': { name: 'LookupTable', gate: { class: 'Simulink.LookupTable' } },
  'Simulink.Breakpoint': { name: 'Breakpoint', gate: { class: 'Simulink.Breakpoint' } },
  'Simulink.NumericType': { name: 'NumericType', gate: { class: 'Simulink.NumericType' } },
  'Simulink.AliasType': { name: 'AliasType', gate: { class: 'Simulink.AliasType' } },
  'Simulink.ValueType': { name: 'ValueType', gate: { class: 'Simulink.ValueType' } },
};

/** The classes the core this runs against says `bytes` can take, read off the source as the view does. */
function coreClasses(bytes: Uint8Array): string[] {
  const srcId = `gate-classes:${Math.random()}`;
  const mat: any = DataModel.addMatSource(srcId, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { path: 'c.mat' });
  try {
    return mat.getAllowedTypes();
  } finally {
    DataModel.removeDataSource(srcId);
  }
}

/**
 * A MAT-file case as matAddGallery.test.ts runs one: a directory and a MAT-file editor of its own,
 * every document it opened closed at the end, and its directory removed once the watchers let go.
 */
async function matCase(run: (c: { open(as: string, bytes: Uint8Array): Promise<any>; save(o: any): Thenable<void> }) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'dex-gate-matadd-'));
  const provider = new MatEditorProvider(ctx());
  const opened: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];
  const open = async (as: string, bytes: Uint8Array) => {
    const path = join(dir, as);
    writeFileSync(path, bytes);
    const doc: any = await provider.openCustomDocument(vscode.Uri.file(path), {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    opened.push({ doc, view });
    const events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    provider.onDidChangeCustomDocument((e) => {
      if (e.document === doc) events.push(e);
    });
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor(`${as}'s first rows`, () => view.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
    return { path, doc, view, events, original: bytes };
  };
  try {
    await run({ open, save: (o) => provider.saveCustomDocument(o.doc, token()) });
  } finally {
    for (const { doc, view } of opened.splice(0)) {
      view.close();
      doc.dispose();
    }
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  }
}

const add = (o: any, className: string, rename = true) => o.view.send({ type: 'addEntry', section: '', className, rename });

// ---- A multi-line Description, through each table editor ----------------------------------------

const LF = "two\nlines, it's";

interface Format extends EditorKind {
  file: string;
}

const FORMATS: Format[] = [
  { ...MAT_EDITOR, file: 'multiline_r2027a.mat' },
  { ...TEXT_EDITOR, file: 'multiline_r2027a_text.sldd' },
  { ...BINARY_EDITOR, file: 'multiline_r2027a_binary.sldd' },
];

const refusalsIn = (posts: any[]) => posts.filter((p) => p.type === 'validationError' || p.type === 'error');

(OUT ? suite : suite.skip)('The files a MATLAB live gate judges, saved by the editors', () => {
  const matAdd = gateFolder('mat-add');
  const numbers = gateFolder('numbers');
  const multiline = gateFolder('multiline');

  /** The saved file and the one it came from, copied for the gate, with what MATLAB should find. */
  const forMatGate = (original: Uint8Array, savedPath: string, entry: { new?: any[]; edited?: any[] }) => {
    mkdirSync(matAdd.dir, { recursive: true });
    const n = matAdd.next(3);
    const file = join(matAdd.dir, `${n}_saved.mat`);
    const before = join(matAdd.dir, `${n}_original.mat`);
    copyFileSync(savedPath, file);
    writeFileSync(before, original);
    matAdd.files.push({ file, original: before, ...entry });
  };

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  suiteTeardown(() => {
    matAdd.manifest();
    multiline.manifest();
  });

  test('MAT-file: each gallery add and Bus element the gate judges, saved on its own', async function () {
    this.timeout(0);
    for (const className of Object.keys(TILES)) {
      await matCase(async ({ open, save }) => {
        const t = TILES[className];
        const o = await open('cases.mat', matFixture('cases.mat'));
        if (!lastSetRows(o.view.posts).add.classes.includes(className)) return; // core does not list it for this file
        add(o, className);
        assert.strictEqual(o.events.length, 1, `${className}: one edit reached VS Code`);
        await waitFor(`the ${t.name} row`, () => !!topRowOrNull(o.view.posts, t.name));
        await save(o);
        forMatGate(o.original, o.path, { new: [{ var: t.name, ...t.gate }] });
      });
    }

    // A string the gallery has no tile for: a variable's Value typed as one; and back to a double.
    for (const [name, typed, becomes] of [['kp', '"abc"', 'string'], ['strScalar', '0', 'double']] as const) {
      await matCase(async ({ open, save }) => {
        const o = await open('cases.mat', matFixture('cases.mat'));
        const row = topRow(o.view.posts, name);
        o.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: row.Value, newValue: typed });
        await waitFor(`${name} a ${becomes}`, () => topRowOrNull(o.view.posts, name)?.Class === becomes);
        await save(o);
        forMatGate(o.original, o.path, { edited: [{ var: name, class: becomes }] });
      });
    }

    // Two pinned adds of one class, which take two names.
    await matCase(async ({ open, save }) => {
      const o = await open('pv_basic.mat', matFixture('pv_basic.mat'));
      add(o, 'Simulink.Signal', false);
      add(o, 'Simulink.Signal', false);
      await waitFor('both rows', () => !!topRowOrNull(o.view.posts, 'Signal') && !!topRowOrNull(o.view.posts, 'Signal1'));
      await save(o);
      forMatGate(o.original, o.path, { new: [{ var: 'Signal', class: 'Simulink.Signal' }, { var: 'Signal1', class: 'Simulink.Signal' }] });
    });

    // A new Bus given two elements from its row, saved; then one removed, and saved again.
    await matCase(async ({ open, save }) => {
      const o = await open('pv_basic.mat', matFixture('pv_basic.mat'));
      add(o, 'Simulink.Bus', false);
      await waitFor('the Bus row', () => !!topRowOrNull(o.view.posts, 'Bus'));
      const bus = topRow(o.view.posts, 'Bus');
      o.view.send({ type: 'addChild', rowId: bus.ID });
      o.view.send({ type: 'addChild', rowId: bus.ID });
      await waitFor('two elements', () => childrenOf(o.view.posts, topRow(o.view.posts, 'Bus')).length === 2);
      assert.deepStrictEqual(childrenOf(o.view.posts, topRow(o.view.posts, 'Bus')), ['a', 'a1']);
      await save(o);
      forMatGate(o.original, o.path, {
        new: [{ var: 'Bus', class: 'Simulink.Bus', code: "obj.Elements(1) = Simulink.BusElement; e = Simulink.BusElement; e.Name = 'a1'; obj.Elements(2) = e;" }],
      });
      const first = tableOf(o.view.posts).find((r) => r.parent === topRow(o.view.posts, 'Bus').ID && nameOf(r) === 'a');
      o.view.send({ type: 'delete', rowIds: [first.ID] });
      await waitFor('one element left', () => childrenOf(o.view.posts, topRow(o.view.posts, 'Bus')).length === 1);
      await save(o);
      forMatGate(o.original, o.path, {
        new: [{ var: 'Bus', class: 'Simulink.Bus', code: "e = Simulink.BusElement; e.Name = 'a1'; obj.Elements(1) = e;" }],
      });
    });

    // A Bus the file holds gains an element and loses its first.
    await matCase(async ({ open, save }) => {
      const o = await open('cases.mat', matFixture('cases.mat'));
      const bus = tableOf(o.view.posts).find((r) => r.parent == null && r.Class === 'Simulink.Bus');
      assert.ok(bus, 'cases.mat holds a Bus');
      const name = nameOf(bus);
      const before = childrenOf(o.view.posts, bus);
      o.view.send({ type: 'addChild', rowId: bus.ID });
      await waitFor('the new element', () => childrenOf(o.view.posts, topRow(o.view.posts, name)).length === before.length + 1);
      const firstRow = tableOf(o.view.posts).find((r) => r.parent === topRow(o.view.posts, name).ID && nameOf(r) === before[0]);
      o.view.send({ type: 'delete', rowIds: [firstRow.ID] });
      await waitFor('the first element gone', () => !childrenOf(o.view.posts, topRow(o.view.posts, name)).includes(before[0]));
      const after = childrenOf(o.view.posts, topRow(o.view.posts, name));
      await save(o);
      const added = after[after.length - 1];
      forMatGate(o.original, o.path, {
        edited: [{ var: name, code: `e = Simulink.BusElement; e.Name = '${added}'; obj.Elements(end+1) = e; obj.Elements(1) = [];` }],
      });
    });

    // A file with no objects at all, whose first object brings its subsystem.
    await matCase(async ({ open, save }) => {
      const o = await open('plain.mat', plainMat());
      add(o, 'Simulink.Parameter');
      add(o, 'string');
      await waitFor('both rows', () => !!topRowOrNull(o.view.posts, 'Param') && !!topRowOrNull(o.view.posts, 'str'));
      await save(o);
      forMatGate(o.original, o.path, { new: [{ var: 'Param', class: 'Simulink.Parameter' }, { var: 'str', class: 'string' }] });
    });
  });

  // Every tile and a Bus element into each MAT-file of DEX_GATE_FIXTURES, each saved on its own, so
  // that the files the gate judges come from originals of the releases it is run in.
  (GATE_FIXTURES ? test : test.skip)('MAT-file: every tile, and a Bus element, into each file of DEX_GATE_FIXTURES', async function () {
    this.timeout(0);
    for (const f of readdirSync(GATE_FIXTURES!).filter((n) => n.endsWith('.mat')).sort()) {
      const bytes = new Uint8Array(readFileSync(join(GATE_FIXTURES!, f)));
      await matCase(async ({ open, save }) => {
        for (const className of coreClasses(bytes)) {
          // A file of its own per add: two documents open on one file are one source of the session.
          const o = await open(`gate_${className}_${f}`, bytes);
          const before = new Set(tableOf(o.view.posts).filter((r) => r.parent == null).map(nameOf));
          add(o, className, false);
          await waitFor(`the new ${className}`, () => tableOf(o.view.posts).some((r) => r.parent == null && !before.has(nameOf(r))));
          const added = nameOf(tableOf(o.view.posts).find((r) => r.parent == null && !before.has(nameOf(r))));
          await save(o);
          forMatGate(bytes, o.path, { new: [{ var: added, ...TILES[className].gate }] });
        }
        const o = await open(`gate_bus_${f}`, bytes);
        const buses = tableOf(o.view.posts).filter((r) => r.parent == null && r.Class === 'Simulink.Bus');
        if (buses.length === 0) return;
        const edited: any[] = [];
        for (const bus of buses) {
          const had = childrenOf(o.view.posts, bus);
          o.view.send({ type: 'addChild', rowId: bus.ID });
          await waitFor('the new element', () => childrenOf(o.view.posts, topRow(o.view.posts, nameOf(bus))).length === had.length + 1);
          const now = childrenOf(o.view.posts, topRow(o.view.posts, nameOf(bus)));
          edited.push({ var: nameOf(bus), code: `e = Simulink.BusElement; e.Name = '${now[now.length - 1]}'; obj.Elements(end+1) = e;` });
        }
        await save(o);
        forMatGate(bytes, o.path, { edited });
      });
    }
  });

  // What is typed where (`at`: the row's place under the entry, each step counted from 0; [] the
  // entry itself), as jsonEditorNumbers.test.ts types it.
  const NUMBERS = [
    { entry: 'gravity', at: [] as number[], typed: '18446744073709551615' },
    { entry: 'myStruct', at: [0], typed: '-9223372036854775808' },
    { entry: 'myStruct', at: [1, 0], typed: '1e300' },
  ];

  test('JSON .sldd: three huge doubles typed into an entry and its elements, saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dex-gate-jsonnum-'));
    const opened: Opened = [];
    try {
      const j = await openJson(opened, dir, 'numbers.sldd');
      const rows = (j.view.posts.filter((m) => m.type === 'setRows').pop()?.rows ?? []) as any[];
      for (const e of NUMBERS) {
        let row = entryRow(j.view.posts, e.entry);
        for (const step of e.at) row = rows.filter((r) => r.parent === row.ID)[step];
        assert.ok(row, `the table has a row ${e.at.join('/')} under ${e.entry}`);
        const version = j.doc.version;
        const cell = row.Value;
        j.view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: typeof cell === 'object' ? cell.text : String(cell), newValue: e.typed });
        await waitFor(`the edit of ${e.entry} to reach the document`, () => j.doc.version !== version);
        assert.deepStrictEqual(refusalsIn(j.view.posts), [], `${e.typed} was taken`);
      }
      assert.ok(await j.doc.save(), 'the dictionary saved');
      mkdirSync(numbers.dir, { recursive: true });
      copyFileSync(j.path, join(numbers.dir, 'numbers.sldd'));
      writeFileSync(join(numbers.dir, 'numbers.json'), JSON.stringify({ file: join(numbers.dir, 'numbers.sldd'), typed: NUMBERS.map((e) => e.typed) }, null, 1));
    } finally {
      closeAll(opened);
      await quiet(200, 'the disposed watchers to stop watching before their directory goes');
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('each table editor: a multi-line Description with a line added, and one held with CR LF, saved', async function () {
    this.timeout(0);
    /** A saved file, copied for the gate, with the Description of each entry MATLAB should find. */
    const forGate = (saved: Uint8Array, file: string, descriptions: Record<string, string>) => {
      mkdirSync(multiline.dir, { recursive: true });
      const path = join(multiline.dir, `${multiline.next(2)}_${file}`);
      writeFileSync(path, saved);
      const asCodes = Object.fromEntries(Object.entries(descriptions).map(([name, text]) => [name, [...text].map((c) => c.charCodeAt(0))]));
      multiline.files.push({ file: path, descriptions: asCodes });
    };
    const editDescription = (tab: EditorTab, row: any, newValue: string) =>
      tab.view.send({ type: 'edit', rowId: row.ID, columnId: 'Description', oldValue: String(row.Description), newValue });

    for (const format of FORMATS) {
      // pCRLF as MATLAB wrote it: its text dictionary writes the CR LF as LF, the other two keep it.
      const crlfHeld = format.file.endsWith('_text.sldd') ? 'first line\nsecond line' : 'first line\r\nsecond line';
      // The two saves multiLineDescription.test.ts hands the gate: a line added to pLF, and pCRLF edited.
      const lineAdded = `${LF}\nand a third`;
      const crlfEdited = crlfHeld.replace('second line', 'second line, edited');
      const cases: [string, string, string, Record<string, string>][] = [
        ['edit', 'pLF', lineAdded, { pLF: lineAdded, pCRLF: crlfHeld, pOne: 'one line' }],
        ['crlf', 'pCRLF', crlfEdited, { pLF: LF, pCRLF: crlfEdited, pOne: 'one line' }],
      ];
      for (const [prefix, name, typed, held] of cases) {
        const dir = mkdtempSync(join(tmpdir(), 'dex-gate-multiline-'));
        const opened: Opened = [];
        try {
          const tab = await format.open(opened, dir, `${prefix}-${format.file}`, fixturePath('multiline', format.file));
          editDescription(tab, tab.row(name), typed);
          await waitFor('the edit to reach the document', () => tab.edited());
          assert.deepStrictEqual(refusalsIn(tab.view.posts), [], `${format.name}, ${name}: the edit was taken`);
          forGate(await tab.save(), format.file, held);
        } finally {
          closeAll(opened);
          await quiet(200, 'the disposed watchers to stop watching before their directory goes');
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  });
});
