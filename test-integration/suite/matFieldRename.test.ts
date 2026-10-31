// Copyright 2026 The MathWorks, Inc.
//
// A struct field renamed in the MAT-file editor, end to end: the save writes it, another tab shows
// it, Save As writes it too. The rename's own rules (an editable Name cell, one gesture that undoes
// and redoes, core's refusals, a struct array, a field just added, the Modified mark until the
// save) are view's MAT-file engine's tests now.
//
// As in matEdit.test.ts, every save is held to what it did NOT touch: each other variable is the
// bytes it was read from. The fixture is core's `cases.mat` (-v7), copied to a tmpdir per test.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DataModel, parseMat } from 'data-explorer-core';
import { MatEditorProvider } from '../../src/host/MatEditorProvider';
import { ctx, fakePanel, nameOf, quiet, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ctx().extensionUri.fsPath, 'test-integration', 'fixtures', 'mat', name)));

/** The file's records by variable name (the subsystem, which has none, as `''`). */
function recordsOf(bytes: Uint8Array): Map<string, Uint8Array> {
  const parsed: any = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return new Map(parsed.records.map((r: any) => [r.name ?? '', r.bytes]));
}

const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** Every record of `before` but `changed` (the subsystem included) is in `after` as the bytes it was. */
function keptUntouched(before: Uint8Array, after: Uint8Array, changed: string[]): void {
  const now = recordsOf(after);
  for (const [name, rec] of recordsOf(before)) {
    if (changed.includes(name)) continue;
    assert.ok(now.has(name), `"${name || '(objects)'}" is still in the saved file`);
    assert.ok(same(now.get(name)!, rec), `"${name || '(objects)'}" is the bytes it was read from`);
  }
}

/** The field names core reads in `bytes` under the variable path `path` (element by element for an array). */
function fieldsIn(bytes: Uint8Array, path: string[]): string[] {
  const srcId = `fieldrename-readback:${Math.random()}`;
  const mat: any = DataModel.addMatSource(srcId, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { path: 'r.mat' });
  try {
    let node: any = mat;
    for (const n of path) node = node.children.find((c: any) => c.name === n);
    return node.children.map((c: any) => c.name);
  } finally {
    DataModel.removeDataSource(srcId);
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

const topRow = (posts: any[], name: string): any => {
  const row = tableOf(posts).find((r) => r.parent == null && nameOf(r) === name);
  assert.ok(row, `the table has a row for "${name}"`);
  return row;
};
/** The row at `path` under the variable `path[0]`. */
const rowAt = (posts: any[], path: string[]): any => {
  let row = topRow(posts, path[0]);
  for (const n of path.slice(1)) {
    const next = tableOf(posts).find((r) => r.parent === row.ID && nameOf(r) === n);
    assert.ok(next, `the table has a row for ${path.join('.')}`);
    row = next;
  }
  return row;
};
const childNames = (posts: any[], path: string[]): string[] => {
  const row = rowAt(posts, path);
  return tableOf(posts).filter((r) => r.parent === row.ID).map(nameOf);
};

suite('MAT-file editor: struct field rename', () => {
  let dir: string;
  let provider: MatEditorProvider;
  const opened: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-fieldrename-'));
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

  async function openPath(path: string) {
    const original = new Uint8Array(readFileSync(path));
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

  type Opened = Awaited<ReturnType<typeof openPath>>;

  async function open(name = 'cases.mat') {
    const path = join(dir, name);
    writeFileSync(path, fixture(name));
    return openPath(path);
  }

  // The saved file as another tab opens it: a copy, so that it is a document of its own.
  let reopened = 0;
  async function reopen(path: string) {
    const copy = join(dir, `reopened${++reopened}.mat`);
    copyFileSync(path, copy);
    return openPath(copy);
  }

  const rename = (o: Opened, path: string[], newValue: string) => {
    const row = rowAt(o.view.posts, path);
    o.view.send({ type: 'edit', rowId: row.ID, columnId: 'Name', oldValue: path[path.length - 1], newValue });
  };
  const save = (o: Opened) => provider.saveCustomDocument(o.doc, token());
  const disk = (o: Opened) => new Uint8Array(readFileSync(o.path));

  test('the rename saves; another tab shows it; Save As writes it; every other variable is as it was', async () => {
    const o = await open();
    rename(o, ['structScalar', 'b'], 'beta');
    await waitFor('the renamed row', () => childNames(o.view.posts, ['structScalar']).includes('beta'));
    await save(o);
    assert.strictEqual(o.doc.edits.dirty, false);
    await waitFor('the Status cleared by the save', () => topRow(o.view.posts, 'structScalar').Status !== 'Modified');
    const saved = disk(o);
    assert.deepStrictEqual(fieldsIn(saved, ['structScalar']), ['a', 'beta']);
    keptUntouched(o.original, saved, ['structScalar']);
    const again = await reopen(o.path);
    assert.deepStrictEqual(childNames(again.view.posts, ['structScalar']), ['a', 'beta']);
    // Save As of a further rename: the copy holds both, the file it came from only the saved one.
    rename(o, ['structScalar', 'a'], 'alpha');
    await waitFor('the second rename', () => childNames(o.view.posts, ['structScalar']).includes('alpha'));
    const target = vscode.Uri.file(join(dir, 'copy.mat'));
    await provider.saveCustomDocumentAs(o.doc, target, token());
    const copy = new Uint8Array(readFileSync(target.fsPath));
    assert.deepStrictEqual(fieldsIn(copy, ['structScalar']), ['alpha', 'beta']);
    keptUntouched(o.original, copy, ['structScalar']);
    assert.deepStrictEqual(fieldsIn(disk(o), ['structScalar']), ['a', 'beta'], 'the file it came from is as last saved');
  });
});
