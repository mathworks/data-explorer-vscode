// Copyright 2026 The MathWorks, Inc.
//
// Set as Active Configuration in the model editor (MatEditorProvider's MODEL_EDITOR): the message
// the table's menu sends (setActiveConfigSet) reaches the model's engine, makes the set active as
// one edit on VS Code's stack, undone and redone with it, and a save writes it into the file, every
// other part as read. A reference to a set is refused, saying why, and nothing changes. Driven
// through the provider with a fake panel, as the MAT-file editor's suite is (matEdit.test.ts).
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { unzipSync } from 'fflate';
import { parseSlx } from 'data-explorer-core';
import { MatEditorProvider, MODEL_EDITOR } from '../../src/host/MatEditorProvider';
import { ctx, fakePanel, nameOf, quiet, token, waitFor } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(ctx().extensionUri.fsPath, 'test-integration', 'fixtures', 'active-config', name)));
const buffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const activeIn = (b: Uint8Array) => parseSlx(buffer(b), 'saved.slx').configSets.filter((c: any) => c.active).map((c: any) => c.name);
const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

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

const setRow = (posts: any[], name: string): any => {
  const row = tableOf(posts).find((r) => r.parent === 'section:config' && nameOf(r) === name);
  assert.ok(row, `the Configurations section has a row for "${name}"`);
  return row;
};

suite('Model editor: Set as Active Configuration', () => {
  let dir: string;
  let provider: MatEditorProvider;
  const opened: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-activeconfig-'));
    provider = new MatEditorProvider(ctx(), MODEL_EDITOR);
  });

  teardown(async () => {
    for (const { doc, view } of opened.splice(0)) {
      view.close();
      doc.dispose();
    }
    await quiet(200, 'the disposed watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  async function open(name: string) {
    const path = join(dir, name);
    const original = fixture(name);
    writeFileSync(path, original);
    const doc: any = await provider.openCustomDocument(vscode.Uri.file(path), {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    opened.push({ doc, view });
    const events: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    provider.onDidChangeCustomDocument((e) => {
      if (e.document === doc && 'undo' in e) events.push(e);
    });
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor(`${name}'s first rows`, () => view.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
    return { path, doc, view, events, original };
  }

  const painted = (o: { view: any }, name: string) =>
    waitFor(`${name} painted active`, () => setRow(o.view.posts, name).Name.iconId === 'check_settings');

  test('a set made active is one edit, undone and redone with VS Code’s stack, and saved', async () => {
    const o = await open('acs_sets.slx');
    assert.strictEqual(setRow(o.view.posts, 'Configuration')._canSetActive, false);
    assert.strictEqual(setRow(o.view.posts, 'Fast')._canSetActive, true);
    o.view.send({ type: 'setActiveConfigSet', rowId: setRow(o.view.posts, 'Fast').ID });
    await painted(o, 'Fast');
    assert.strictEqual(o.events.length, 1, 'one edit on the stack');
    assert.strictEqual(o.doc.edits.dirty, true);
    await o.events[0].undo();
    await painted(o, 'Configuration');
    assert.strictEqual(o.doc.edits.dirty, false, 'undone: clean');
    await o.events[0].redo();
    await painted(o, 'Fast');
    await provider.saveCustomDocument(o.doc, token());
    const saved = new Uint8Array(readFileSync(o.path));
    assert.deepStrictEqual(activeIn(saved), ['Fast']);
    const read = unzipSync(o.original);
    const written = unzipSync(saved);
    const changed = Object.keys(read).filter((n) => !same(read[n], written[n]));
    assert.deepStrictEqual(changed, ['simulink/configSetInfo.json'], 'the mark alone changed');
    assert.strictEqual(o.doc.edits.dirty, false);
  });

  test('a reference to a set is refused, saying why, and nothing changes', async () => {
    const o = await open('acs_ref.slx');
    const ref = setRow(o.view.posts, 'RefFromDict');
    assert.strictEqual(ref._canSetActive, false);
    o.view.send({ type: 'setActiveConfigSet', rowId: ref.ID });
    await waitFor('the refusal', () => o.view.posts.some((p) => p.type === 'refused'));
    const refused = o.view.posts.find((p) => p.type === 'refused');
    assert.strictEqual(refused.title, 'Cannot Set Active Configuration');
    assert.match(refused.reason, /^Cannot make "RefFromDict" the active configuration set: it refers to "dictCfg"/);
    assert.strictEqual(o.events.length, 0);
    assert.strictEqual(o.doc.edits.dirty, false);
  });
});
