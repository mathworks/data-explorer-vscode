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
  mkdirSync,
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
      if (e.document === doc && 'undo' in e) events.push(e);
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

  test('revert reads the disk, and an edit from before it is not undone on the new tree', async () => {
    const changed: string[] = [];
    provider.onChanged = (uri) => changed.push(uri);
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    await save(o);
    edit(o, 'negD', 'Value', '7');
    changed.length = 0;
    await provider.revertCustomDocument(o.doc, token());
    assert.deepStrictEqual(changed, [o.uri.toString()], 'the Property Inspector is told the tree changed, once');
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

  // The id is the shared backupId.ts's, which the binary .sldd editor writes too; one that is a
  // bare uri (that editor's id before it carried a stamp) restores here as well, with no stamp.
  test('a backup id that is a bare uri still restores the backed-up edits', async () => {
    const o = await open('cases.mat');
    edit(o, 'scalarD', 'Value', '42');
    const destination = vscode.Uri.file(join(dir, 'backup.bin'));
    const backup = await provider.backupCustomDocument(o.doc, { destination } as vscode.CustomDocumentBackupContext, token());
    assert.deepStrictEqual(JSON.parse(backup.id), { backup: destination.toString(), stamp: o.doc.stamp }, 'the id names the backup and the stamp');
    o.view.close();
    o.doc.dispose();
    opened.splice(opened.findIndex((x) => x.doc === o.doc), 1);
    const restored: any = await provider.openCustomDocument(o.uri, { backupId: destination.toString() } as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    opened.push({ doc: restored, view });
    await provider.resolveCustomEditor(restored, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the restored rows', () => view.posts.some((p) => p.type === 'setRows'));
    assert.strictEqual(topRow(view.posts, 'scalarD').Value, '42', 'the restore holds the backed-up edit');
    assert.strictEqual(restored.stamp, undefined, 'and no stamp, which no id of that shape carries');
    await provider.saveCustomDocument(restored, token());
    assert.strictEqual(valuesOf(disk(o)).get('scalarD').Value, '42');
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

  test('a file whose folder was deleted under the view is saved, folder and all, and holds the stamp its write left', async () => {
    const folder = join(dir, 'project');
    mkdirSync(folder);
    const o = await open('cases.mat', fixture('cases.mat'), join('project', 'cases.mat'));
    edit(o, 'scalarD', 'Value', '42');
    rmSync(folder, { recursive: true });
    await save(o);
    assert.strictEqual(valuesOf(disk(o)).get('scalarD').Value, '42', 'the edit is on disk, in the folder made again');
    assert.deepStrictEqual(readdirSync(folder), ['cases.mat'], 'and nothing beside it');
    const st = statSync(o.path);
    assert.deepStrictEqual(o.doc.stamp, { mtime: st.mtime.getTime(), size: st.size }, 'the stamp of the file as written');
    edit(o, 'negD', 'Value', '7');
    await save(o);
    assert.deepStrictEqual(asked, [], 'so the next save does not take that write for an outside one');
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
