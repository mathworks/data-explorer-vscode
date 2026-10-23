// Copyright 2026 The MathWorks, Inc.
//
// The MAT-file editor, end to end: a gesture as the table sends it, the edit VS Code is handed,
// its undo and redo, and the file a save writes, read back with core's own reader and compared
// record by record with the file as it was.
//
// The baseline every test here serves: a save never breaks the user's file. So each one that
// writes asserts what it did NOT touch as well as what it did — every variable nobody edited is
// the bytes it was read from — and each one that refuses asserts that the file on disk is the
// file it was before.
//
// The fixtures are MATLAB-written files from data-explorer-core's test corpus, in
// test-integration/fixtures/mat: `cases.mat` (-v7, every class and shape), `pv_basic.mat`
// (-v7, two Simulink.Parameter objects) and `nested_handles.mat` (-v6, function handles in a
// struct and a cell). Each test works on a copy in tmpdir, outside the workspace folder.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel, parseMat } from 'data-explorer-core';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { MatEditorProvider } from '../../src/host/MatEditorProvider';
import { ctx, fakePanel, nameOf, quiet, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ctx().extensionUri.fsPath, 'test-integration', 'fixtures', 'mat', name)));

/** The file's records by variable name (the subsystem, which has none, as `''`). */
function recordsOf(bytes: Uint8Array): Map<string, { bytes: Uint8Array; compressed: boolean }> {
  const parsed: any = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const out = new Map<string, { bytes: Uint8Array; compressed: boolean }>();
  for (const r of parsed.records) out.set(r.name ?? '', { bytes: r.bytes, compressed: !!r.compressed });
  return out;
}

const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/**
 * Every record of `before` that is not one of `changed`, the subsystem included, is in `after`
 * as the bytes it was: the save kept what nobody edited.
 */
function keptUntouched(before: Uint8Array, after: Uint8Array, changed: string[]): void {
  const was = recordsOf(before);
  const now = recordsOf(after);
  for (const [name, rec] of was) {
    if (changed.includes(name)) continue;
    const kept = now.get(name);
    assert.ok(kept, `"${name || '(objects)'}" is still in the saved file`);
    assert.ok(same(kept!.bytes, rec.bytes), `"${name || '(objects)'}" is the bytes it was read from`);
  }
}

/** The value text core shows for each top-level variable of `bytes`, by name. */
function valuesOf(bytes: Uint8Array): Map<string, any> {
  const srcId = `matedit-readback:${Math.random()}`;
  const mat: any = DataModel.addMatSource(
    srcId,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { path: 'readback.mat' },
  );
  try {
    return new Map(mat.children.map((c: any) => [c.name, c.toRow()]));
  } finally {
    DataModel.removeDataSource(srcId);
  }
}

const rowsOf = (posts: any[]): any[] => {
  const last = [...posts].reverse().find((p) => p.type === 'setRows');
  return (last?.rows ?? []) as any[];
};

/**
 * The rows the table holds now: the last setRows with every updateEntryRows after it spliced
 * in, as the webview splices them (rowUpdates.spliceEntryRows).
 */
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

const topRow = (posts: any[], name: string): any => {
  const row = tableOf(posts).find((r) => r.parent == null && nameOf(r) === name);
  assert.ok(row, `the table has a row for "${name}"`);
  return row;
};

/** Write the file as another program would, with an mtime later than any the view has seen. */
function writeOutside(path: string, bytes: Uint8Array): void {
  const before = statSync(path).mtimeMs;
  writeFileSync(path, bytes);
  const later = new Date(Math.max(Date.now(), before) + 2000);
  utimesSync(path, later, later);
}

suite('MAT-file editor: edit, undo, save', () => {
  let dir: string;
  let provider: MatEditorProvider;
  let asked: string[];
  let answer: string | undefined;
  const opened: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-matedit-'));
    provider = new MatEditorProvider(ctx());
    asked = [];
    answer = undefined;
    provider.askSaveConflict = async (message: string) => {
      asked.push(message);
      return answer;
    };
  });

  teardown(async () => {
    for (const { doc, view } of opened.splice(0)) {
      view.close();
      doc.dispose();
    }
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  /** A copy of `name` in this test's directory, opened and painted, with every edit it raises. */
  async function open(name: string, bytes: Uint8Array = fixture(name), as = name) {
    const path = join(dir, as);
    writeFileSync(path, bytes);
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
    await waitFor(`${as}'s first rows`, () => view.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
    return { path, uri, doc, view, events, original: bytes };
  }

  const edit = (o: { view: any; doc: any }, name: string, columnId: string, newValue: string) => {
    const row = topRow(o.view.posts, name);
    o.view.send({ type: 'edit', rowId: row.ID, columnId, oldValue: '', newValue });
  };
  const save = (o: { doc: any }) => provider.saveCustomDocument(o.doc, token());
  const disk = (o: { path: string }) => new Uint8Array(readFileSync(o.path));

  test('the view is editable, offers the gallery of the classes the file takes, and offers no clipboard', async () => {
    const o = await open('cases.mat');
    const set = o.view.posts.find((p) => p.type === 'setRows');
    assert.strictEqual(set.editable, true);
    // Which classes, and each tile end to end, is matAddGallery.test.ts.
    assert.ok(set.add.classes.includes('MatlabVariable'), 'the gallery offers a plain variable');
    assert.strictEqual(set.clipboard, false);
    assert.strictEqual(set.notice, undefined);
    // The menu's flags come with each row, from core's gate.
    const vec = topRow(o.view.posts, 'rowVec');
    assert.strictEqual(vec._canDelete, true);
    assert.strictEqual(vec._canAddChild, true);
    assert.strictEqual(vec._canCopy, false);
    assert.strictEqual(topRow(o.view.posts, 'strScalar')._valueEditable, true, 'a string takes a value edit');
  });

  test('a value edit saves as that variable written fresh, and every other record as it was', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    assert.strictEqual(o.events.length, 1, 'one edit reached VS Code');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '42', 'the row was repainted');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Status, 'Modified');
    await save(o);
    const saved = disk(o);
    assert.strictEqual(valuesOf(saved).get('scalarD').Value, '42');
    keptUntouched(o.original, saved, ['scalarD']);
    assert.ok(recordsOf(saved).get('scalarD')!.compressed, 'compressed, as the -v7 file it was written into');
    assert.strictEqual(o.doc.edits.dirty, false);
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Status, '', 'saved: the row no longer differs from the file');
  });

  test('undo and redo move the tree and the dirty flag with VS Code’s stack', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    edit(o, 'kp', 'Name', 'gain');
    assert.strictEqual(o.events.length, 2);
    await o.events[1].undo();
    assert.ok(tableOf(o.view.posts).some((r) => nameOf(r) === 'kp'), 'the rename is undone');
    await o.events[0].undo();
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '3.141592653589793', 'the value is undone');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Status, '', 'and no longer differs from the file');
    assert.strictEqual(o.doc.edits.dirty, false, 'both undone: clean');
    await o.events[0].redo();
    await o.events[1].redo();
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '42');
    assert.ok(tableOf(o.view.posts).some((r) => nameOf(r) === 'gain'));
    await save(o);
    const back = valuesOf(disk(o));
    assert.strictEqual(back.get('scalarD').Value, '42');
    assert.ok(back.has('gain') && !back.has('kp'));
    keptUntouched(o.original, disk(o), ['scalarD', 'kp']);
  });

  test('an edit can still be undone after the save that wrote it, and the next save writes the undo', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    await save(o);
    assert.strictEqual(valuesOf(disk(o)).get('scalarD').Value, '42');
    // The save replaced the file (a new file renamed over it), which the watcher hears as a
    // create. It is the view's own write, so the tree, and its undo stack, stay.
    await quiet(500, 'the watcher to hear the save and leave the tree alone');
    assert.strictEqual(o.doc.generation, 0, 'the save was not taken for an outside change');
    await o.events[0].undo();
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '3.141592653589793');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Status, 'Modified', 'differs from the file as saved');
    assert.strictEqual(o.doc.edits.dirty, true);
    await save(o);
    assert.strictEqual(valuesOf(disk(o)).get('scalarD').Value, '3.141592653589793');
    keptUntouched(o.original, disk(o), ['scalarD']);
  });

  test('an edit that lands while a save is writing is written by that save before it resolves', async () => {
    // VS Code calls saved whatever the document holds when the save resolves, so a save that
    // resolved with the first edit only would leave the tab clean over a file without the second.
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const saving = save(o);
    // On the save's awaits: it serialized the tree before the first of them.
    edit(o, 'negD', 'Value', '7');
    await saving;
    const back = valuesOf(disk(o));
    assert.strictEqual(back.get('scalarD').Value, '42');
    assert.strictEqual(back.get('negD').Value, '7', 'the edit that landed is on disk');
    keptUntouched(o.original, disk(o), ['scalarD', 'negD']);
    assert.strictEqual(o.doc.edits.dirty, false, 'and the document is clean, as VS Code shows it');
    assert.strictEqual(topRow(o.view.posts, 'negD').Status, '', 'nothing differs from the file');
    // An undo and a new edit that put the stack back where the save read it are a move too.
    const again = save(o);
    await o.events[1].undo();
    edit(o, 'negD', 'Value', '8');
    await again;
    assert.strictEqual(valuesOf(disk(o)).get('negD').Value, '8');
    assert.strictEqual(o.doc.edits.dirty, false);
  });

  test('a paint in flight across a save paints the Status the save left', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const version = o.doc.version;
    // Which of the paint's await and the save's write ends first, the test host cannot order;
    // what makes the paint build again whichever does is that the save moves the version.
    const from = o.view.posts.length;
    o.view.send({ type: 'ready' });
    await save(o);
    assert.ok(o.doc.version > version, 'the save moved the version a paint checks after its await');
    await waitFor('the paint', () => o.view.posts.slice(from).some((p) => p.type === 'setRows'));
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Status, '', 'not the Modified it built before the save');
  });

  test('a variable typed over as another class is Modified, and one added since the save stays New', async () => {
    // Core swaps a variable typed as another class for a new one of its name, in its place.
    const o = await open('cases.mat');
    const top = (name: string) => tableOf(o.view.posts).find((r) => r.parent == null && nameOf(r) === name);
    const str = topRow(o.view.posts, 'strScalar');
    o.view.send({ type: 'edit', rowId: str.ID, columnId: 'Value', oldValue: str.Value, newValue: '0' });
    await waitFor('strScalar a double', () => top('strScalar')?.Class === 'double');
    assert.strictEqual(top('strScalar').Status, 'Modified', 'the file holds a strScalar');
    o.view.send({ type: 'addEntry', className: 'MatlabVariable', rename: false });
    await waitFor('the added variable', () => !!top('var'));
    const added = top('var');
    o.view.send({ type: 'edit', rowId: added.ID, columnId: 'Value', oldValue: added.Value, newValue: '"abc"' });
    await waitFor('var a string', () => top('var')?.Class === 'string');
    assert.strictEqual(top('var').Status, 'New', 'the file holds no var');
    await save(o);
    const again = top('var');
    o.view.send({ type: 'edit', rowId: again.ID, columnId: 'Value', oldValue: again.Value, newValue: '1' });
    await waitFor('var a double', () => top('var')?.Class === 'double');
    assert.strictEqual(top('var').Status, 'Modified', 'saved, the file holds it');
  });

  test('an undo or a redo that moves the classes core offers tells the gallery, as a gesture does', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const classes = () => [...o.view.posts].reverse().find((p) => p.type === 'setRows').add.classes as string[];
    const offered = classes();
    assert.ok(offered.length > 1, 'the file takes more than a plain variable');
    // Core's answer, moved by the undo: stood in for, as no edit of this file moves it.
    const mat: any = DataModel.getDataSource(o.doc.srcId);
    mat.getAllowedTypes = () => ['MatlabVariable'];
    try {
      await o.events[0].undo();
      await waitFor('the gallery told of the undo', () => classes().length === 1);
      delete mat.getAllowedTypes;
      await o.events[0].redo();
      await waitFor('and of the redo', () => classes().length === offered.length);
    } finally {
      delete mat.getAllowedTypes;
    }
  });

  test('a save repaints the Status of the variables in the file, and not of one deleted from it', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    o.view.send({ type: 'delete', rowIds: [topRow(o.view.posts, 'negD').ID] });
    await waitFor('the deleted variable to leave the table', () => !tableOf(o.view.posts).some((r) => nameOf(r) === 'negD'));
    const from = o.view.posts.length;
    const held = new Set(tableOf(o.view.posts).map((r) => r.ID));
    await save(o);
    const spliced = o.view.posts.slice(from).filter((p) => p.type === 'updateEntryRows');
    assert.deepStrictEqual(
      spliced.map((p) => p.entryRowId),
      [topRow(o.view.posts, 'scalarD').ID],
      'the one variable whose Status the save cleared, and no rows the table does not hold',
    );
    assert.ok(spliced.every((p) => held.has(p.entryRowId)));
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Status, '');
  });

  test('a rename is the record with its new name; a delete leaves the rest as they were', async () => {
    const o = await open('cases.mat');
    edit(o, 'kp', 'Name', 'kpRenamed');
    o.view.send({ type: 'delete', rowIds: [topRow(o.view.posts, 'negD').ID] });
    assert.strictEqual(o.events.length, 2);
    // Which variables the file holds changed, so the whole table is repainted.
    await waitFor('the deleted variable to leave the table', () => !tableOf(o.view.posts).some((r) => nameOf(r) === 'negD'));
    await save(o);
    const saved = disk(o);
    const back = valuesOf(saved);
    assert.strictEqual(back.get('kpRenamed').Value, '1.5');
    assert.ok(!back.has('kp') && !back.has('negD'));
    keptUntouched(o.original, saved, ['kp', 'negD']);
  });

  test('Add makes `var` = 0, opens its name editor, and saves as a double', async () => {
    const o = await open('cases.mat');
    o.view.send({ type: 'addEntry', section: '', className: 'MatlabVariable', rename: true });
    assert.strictEqual(o.events.length, 1);
    await waitFor('the added row', () => tableOf(o.view.posts).some((r) => nameOf(r) === 'var'));
    const rename = o.view.posts.find((p) => p.type === 'beginRename');
    assert.ok(rename && rename.rowId === topRow(o.view.posts, 'var').ID, 'its name editor is asked for');
    assert.strictEqual(topRow(o.view.posts, 'var').Status, 'New');
    edit(o, 'var', 'Name', 'added1');
    await save(o);
    const back = valuesOf(disk(o));
    assert.strictEqual(back.get('added1').Value, '0');
    assert.strictEqual(back.get('added1').Class, 'double');
    keptUntouched(o.original, disk(o), []);
  });

  test('two elements of a vector deleted in one gesture are one edit', async () => {
    const o = await open('cases.mat');
    const vec = topRow(o.view.posts, 'rowVec');
    const kids = tableOf(o.view.posts).filter((r) => r.parent === vec.ID);
    assert.strictEqual(kids.length, 3);
    o.view.send({ type: 'delete', rowIds: [kids[0].ID, kids[2].ID] });
    assert.strictEqual(o.events.length, 1, 'one gesture, one edit');
    assert.strictEqual(topRow(o.view.posts, 'rowVec').Value, '2');
    await o.events[0].undo();
    assert.strictEqual(topRow(o.view.posts, 'rowVec').Value, '[1 2 3]', 'one undo puts both back');
    await o.events[0].redo();
    await save(o);
    assert.strictEqual(valuesOf(disk(o)).get('rowVec').Value, '2');
    keptUntouched(o.original, disk(o), ['rowVec']);
  });

  test('a Parameter takes an edit of its Value and its Storage Class; a property the save cannot write is refused', async () => {
    const o = await open('pv_basic.mat');
    // Of the object's CoderInfo a save writes the Storage Class, and nothing else: the Header File
    // is refused, in core's words, naming the variable.
    edit(o, 'p', 'headerFile', 'a.h');
    const refused = o.view.posts.find((m) => m.type === 'validationError');
    assert.ok(refused, 'the edit is refused');
    assert.match(refused.reason, /"p"/);
    assert.ok(!refused.reason.includes('binedit:'), 'the refusal names the variable, not the srcId');
    assert.strictEqual(o.events.length, 0, 'and nothing reached VS Code');
    assert.strictEqual(o.doc.edits.dirty, false);
    edit(o, 'p', 'storageClass', 'ExportedGlobal');
    edit(o, 'p', 'Value', '7');
    assert.strictEqual(o.events.length, 2);
    await save(o);
    const saved = disk(o);
    const p = valuesOf(saved).get('p');
    assert.strictEqual(p.Value, '7');
    assert.strictEqual(p.storageClass?.text ?? p.storageClass, 'ExportedGlobal');
    assert.strictEqual(valuesOf(saved).get('q').Value, '5', 'the other Parameter is untouched');
    // The object's edit is written into the file's objects; every variable record is as it was.
    keptUntouched(o.original, saved, ['']);
  });

  test('a -v6 file stays uncompressed through a rename and a delete', async () => {
    const o = await open('nested_handles.mat');
    assert.strictEqual(topRow(o.view.posts, 's_fh')._valueEditable, false, 'a struct of function handles takes no value edit');
    edit(o, 's_fh', 'Name', 's_renamed');
    o.view.send({ type: 'delete', rowIds: [topRow(o.view.posts, 'c_fh').ID] });
    assert.strictEqual(o.events.length, 2);
    await save(o);
    const saved = disk(o);
    for (const [name, rec] of recordsOf(saved)) assert.strictEqual(rec.compressed, false, `"${name}" is uncompressed`);
    const back = valuesOf(saved);
    assert.ok(back.has('s_renamed') && !back.has('s_fh') && !back.has('c_fh'));
    keptUntouched(o.original, saved, ['s_fh', 'c_fh']);
  });

  test('a save with no edit writes the file byte for byte', async () => {
    const o = await open('cases.mat');
    await save(o);
    assert.ok(same(disk(o), o.original));
  });

  test('a save core refuses writes nothing, keeps the edits, and says why', async () => {
    const o = await open('cases.mat');
    const before = statSync(o.path).mtimeMs;
    edit(o, 'scalarD', 'Value', '42');
    // The bytes the tree was read from, handed away (transferred) after the edit: core cannot
    // write what nobody edited as it was, and refuses the whole save.
    const mat: any = DataModel.getDataSource(o.doc.srcId);
    structuredClone(mat.headerBytes.buffer, { transfer: [mat.headerBytes.buffer] });
    await assert.rejects(save(o), (err: Error) => {
      assert.match(err.message, /^Cannot save "cases\.mat": /);
      assert.match(err.message, /Nothing was written\.$/);
      return true;
    });
    assert.ok(same(disk(o), o.original), 'the file on disk is the file it was');
    assert.strictEqual(statSync(o.path).mtimeMs, before, 'not even rewritten with the same bytes');
    assert.strictEqual(o.doc.edits.dirty, true, 'the edit is still unsaved');
    assert.deepStrictEqual(readdirSync(dir), ['cases.mat'], 'and no temporary file is left behind');
  });

  test('a save replaces the file whole, keeping its mode, and leaves no temporary file', async () => {
    const o = await open('cases.mat');
    chmodSync(o.path, 0o600);
    edit(o, 'scalarD', 'Value', '42');
    await save(o);
    assert.strictEqual(statSync(o.path).mode & 0o777, 0o600);
    assert.deepStrictEqual(readdirSync(dir), ['cases.mat']);
    assert.strictEqual(valuesOf(disk(o)).get('scalarD').Value, '42');
  });

  test('a file changed on disk while there are unsaved edits is not overwritten without asking', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const outside = fixture('pv_basic.mat');
    writeOutside(o.path, outside);
    await quiet(400, 'the watcher to see the outside write and leave the unsaved edit alone');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '42', 'the unsaved edit stays');
    await assert.rejects(save(o), (err: unknown) => err instanceof vscode.CancellationError);
    await waitFor('the conflict prompt', () => asked.length === 1);
    assert.match(asked[0], /cases\.mat/);
    assert.ok(same(disk(o), outside), 'the outside version is still the file');
    assert.strictEqual(o.doc.edits.dirty, true);
  });

  test('a file changed on disk with no unsaved edits is followed', async () => {
    const o = await open('cases.mat');
    const renamed = fixture('pv_basic.mat');
    writeOutside(o.path, renamed);
    await waitFor('the reload', () => tableOf(o.view.posts).some((r) => r.parent == null && nameOf(r) === 'p'));
    assert.ok(!tableOf(o.view.posts).some((r) => nameOf(r) === 'scalarD'));
  });

  test('a paint that awaited the usage graph across a reload paints the tree the reload put in', async () => {
    const o = await open('cases.mat');
    const from = o.view.posts.length;
    // A paint, now on its one await; the reload lands on it, and paints again itself.
    o.view.send({ type: 'ready' });
    const other = fixture('pv_basic.mat');
    o.doc.replace({ stamp: undefined, bytes: other.buffer.slice(other.byteOffset, other.byteOffset + other.byteLength) });
    const paints = () => o.view.posts.slice(from).filter((p) => p.type === 'setRows');
    await waitFor('both paints', () => paints().length >= 2);
    for (const paint of paints()) {
      const names = paint.rows.filter((r: any) => r.parent == null).map(nameOf);
      assert.ok(names.includes('p'), 'the reloaded file’s variables');
      assert.ok(!names.includes('scalarD'), 'and none of the tree the reload replaced');
    }
  });

  test('revert reads the disk, and an edit from before it is not undone on the new tree', async () => {
    const replaced: string[] = [];
    provider.onReplaced = (uri) => replaced.push(uri);
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    await save(o);
    edit(o, 'negD', 'Value', '7');
    await provider.revertCustomDocument(o.doc, token());
    assert.deepStrictEqual(replaced, [o.uri.toString()], 'the Property Inspector is told the tree changed');
    await waitFor('the reverted rows', () => topRow(o.view.posts, 'negD').Value === '-2.5');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '42', 'the disk holds the save');
    await o.events[0].undo();
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '42', 'the old tree’s edit does nothing to this one');
    const mat: any = DataModel.getDataSource(o.doc.srcId);
    assert.strictEqual(mat.children.find((c: any) => c.name === 'scalarD').toRow().Value, '42');
  });

  test('a revert that cannot read the disk puts the tree back to the file as last saved', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    await save(o);
    edit(o, 'negD', 'Value', '7');
    rmSync(o.path);
    await assert.rejects(provider.revertCustomDocument(o.doc, token()));
    // VS Code shows the document clean, so the tree must hold no edit the revert dropped.
    assert.strictEqual(o.doc.edits.dirty, false);
    await waitFor('the rows as saved', () => topRow(o.view.posts, 'negD').Value === '-2.5');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '42');
  });

  test('a gesture that throws part-way is still one edit, so Undo lands on the edit it undoes', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const vec = topRow(o.view.posts, 'rowVec');
    const kids = tableOf(o.view.posts).filter((r) => r.parent === vec.ID);
    // The second of the gesture's two steps throws, after core recorded the first.
    const session = DataModel as any;
    const real = session.deleteNodeById;
    let calls = 0;
    session.deleteNodeById = (id: string) => {
      if (++calls === 2) throw new Error('the second step failed');
      return real.call(DataModel, id);
    };
    try {
      o.view.send({ type: 'delete', rowIds: [kids[0].ID, kids[2].ID] });
    } finally {
      session.deleteNodeById = real;
    }
    assert.strictEqual(o.events.length, 2, 'the step core recorded is an edit VS Code knows of');
    assert.match(o.view.posts.filter((p) => p.type === 'error').pop().message, /the second step failed/);
    await waitFor('the rows as core left them', () => topRow(o.view.posts, 'rowVec').Value === '[2 3]');
    await o.events[1].undo();
    await waitFor('the delete undone', () => topRow(o.view.posts, 'rowVec').Value === '[1 2 3]');
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '42', 'and only the delete');
    await o.events[0].undo();
    assert.strictEqual(topRow(o.view.posts, 'scalarD').Value, '3.141592653589793');
    assert.strictEqual(o.doc.edits.dirty, false);
  });

  test('Save As onto the file itself is a save', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    await provider.saveCustomDocumentAs(o.doc, o.uri, token());
    assert.strictEqual(valuesOf(disk(o)).get('scalarD').Value, '42');
    assert.strictEqual(o.doc.edits.dirty, false);
    await quiet(500, 'the watcher to hear the write and leave the tree alone');
    assert.strictEqual(o.doc.generation, 0, 'its own write, not an outside change');
  });

  test('a restored backup asks before writing over a file changed since the backup', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const destination = vscode.Uri.file(join(dir, 'backup.bin'));
    const backup = await provider.backupCustomDocument(o.doc, { destination } as vscode.CustomDocumentBackupContext, token());
    o.view.close();
    o.doc.dispose();
    opened.splice(opened.findIndex((x) => x.doc === o.doc), 1);
    // Another program writes the file while VS Code is closed.
    const outside = fixture('pv_basic.mat');
    writeOutside(o.path, outside);
    const restored: any = await provider.openCustomDocument(o.uri, { backupId: backup.id } as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    opened.push({ doc: restored, view });
    await provider.resolveCustomEditor(restored, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the restored rows', () => view.posts.some((p) => p.type === 'setRows'));
    await assert.rejects(provider.saveCustomDocument(restored, token()), (err: unknown) => err instanceof vscode.CancellationError);
    await waitFor('the conflict prompt', () => asked.length === 1);
    assert.ok(same(disk(o), outside), 'the other program’s file is still the file');
    await backup.delete();
  });

  test('a backup core refuses keeps the last one that could be written standing', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const first = vscode.Uri.file(join(dir, 'backup1.bin'));
    const second = vscode.Uri.file(join(dir, 'backup2.bin'));
    const b1 = await provider.backupCustomDocument(o.doc, { destination: first } as vscode.CustomDocumentBackupContext, token());
    edit(o, 'negD', 'Value', '7');
    // Core can no longer write the tree (its bytes handed away), so neither a save nor a backup can.
    const mat: any = DataModel.getDataSource(o.doc.srcId);
    structuredClone(mat.headerBytes.buffer, { transfer: [mat.headerBytes.buffer] });
    const b2 = await provider.backupCustomDocument(o.doc, { destination: second } as vscode.CustomDocumentBackupContext, token());
    assert.strictEqual(b2.id, b1.id, 'the last backup is handed on');
    assert.throws(() => statSync(second.fsPath), 'and nothing is written for the refused one');
    // The extension host deletes a backup when it is handed the next one: the file survives that.
    await b1.delete();
    assert.ok(statSync(first.fsPath).size > 0);
    const kept: any = await provider.openCustomDocument(o.uri, { backupId: b2.id } as vscode.CustomDocumentOpenContext, token());
    opened.push({ doc: kept, view: fakePanel() });
    assert.strictEqual(valuesOf(new Uint8Array(readFileSync(first.fsPath))).get('scalarD').Value, '42');
    await b2.delete();
    assert.throws(() => statSync(first.fsPath), 'the last handle takes the file with it');
  });

  test('a hot-exit backup is a whole MAT-file, and restoring it restores the edits', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const destination = vscode.Uri.file(join(dir, 'backup.bin'));
    const backup = await provider.backupCustomDocument(o.doc, { destination } as vscode.CustomDocumentBackupContext, token());
    assert.ok(same(disk(o), o.original), 'a backup does not touch the file');
    const restored: any = await provider.openCustomDocument(o.uri, { backupId: backup.id } as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    opened.push({ doc: restored, view });
    o.view.close();
    o.doc.dispose();
    opened.splice(opened.findIndex((x) => x.doc === o.doc), 1);
    await provider.resolveCustomEditor(restored, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the restored rows', () => view.posts.some((p) => p.type === 'setRows'));
    assert.strictEqual(topRow(view.posts, 'scalarD').Value, '42');
    assert.strictEqual(restored.edits.dirty, true, 'a restored backup is unsaved');
    await provider.saveCustomDocument(restored, token());
    assert.strictEqual(valuesOf(disk(o)).get('scalarD').Value, '42');
    keptUntouched(o.original, disk(o), ['scalarD']);
    await backup.delete();
  });

  test('a file whose records do not tile it opens read-only, and takes no edit', async () => {
    const junk = new Uint8Array([...fixture('pv_basic.mat'), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const o = await open('pv_basic.mat', junk, 'tail.mat');
    const set = o.view.posts.find((p) => p.type === 'setRows');
    assert.strictEqual(set.editable, false);
    assert.match(set.notice, /^Read-only: Cannot save "tail\.mat": /);
    edit(o, 'x', 'Name', 'y');
    assert.strictEqual(o.events.length, 0);
    assert.strictEqual(o.doc.edits.dirty, false);
  });

  test('a -v7.3 file shows why it cannot be opened', async () => {
    const header = new Uint8Array(600);
    header.set(new TextEncoder().encode('MATLAB 7.3 MAT-file, Platform: x'));
    header[124] = 0x00;
    header[125] = 0x02;
    header[126] = 0x49; // 'I'
    header[127] = 0x4d; // 'M'
    const o = await open('cases.mat', header, 'hdf5.mat');
    const error = o.view.posts.find((p) => p.type === 'error');
    assert.ok(error, 'the tab says it failed');
    assert.match(error.message, /7\.3/);
  });

  test('a .mat that lands in the read-only view is handed to this editor', async () => {
    const o = await open('cases.mat');
    const ro = new BinaryEditorProvider(ctx());
    const doc = await ro.openCustomDocument(o.uri, {} as vscode.CustomDocumentOpenContext, token());
    const panel = vscode.window.createWebviewPanel('test.matRedirect', 'test', vscode.ViewColumn.One, {});
    let disposed = false;
    panel.onDidDispose(() => (disposed = true));
    await ro.resolveCustomEditor(doc, panel, token());
    assert.ok(disposed, 'the read-only panel went away');
    await waitFor('the MAT-file editor tab', () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === MatEditorProvider.viewType && t.input.uri.toString() === o.uri.toString()),
    );
    doc.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
