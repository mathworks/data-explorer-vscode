// Copyright 2026 The MathWorks, Inc.
//
// Set as Active Configuration in the model editor (MatEditorProvider's MODEL_EDITOR): the message
// the table's menu sends (setActiveConfigSet) reaches the model's engine, makes the set active as
// one edit on VS Code's stack, undone and redone with it, and a save writes it into the file, every
// other part as read. And the edits of the sets themselves: a set added from the gallery's
// Configurations tile (the first paint offers it, `addSections`), copied and pasted, renamed and
// deleted, each one edit on VS Code's stack, and saved. A reference to a set is made active too, with VS Code's warning of what that
// cannot check without MATLAB (read off `vscode.window.showWarningMessage`, wrapped for this suite:
// the extension's `vscode` module is one object for every file of it). Driven through the provider
// with a fake panel, as the MAT-file editor's suite is (matEdit.test.ts).
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

suite('Model editor: configuration sets', () => {
  let dir: string;
  let provider: MatEditorProvider;
  const opened: { doc: any; view: ReturnType<typeof fakePanel> }[] = [];
  const warned: string[] = [];
  const window = vscode.window as any;
  const warn = window.showWarningMessage;

  setup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-activeconfig-'));
    provider = new MatEditorProvider(ctx(), MODEL_EDITOR);
    warned.length = 0;
    window.showWarningMessage = (message: string) => {
      warned.push(message);
      return Promise.resolve(undefined);
    };
  });

  teardown(async () => {
    window.showWarningMessage = warn;
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

  test('a reference to a set is made active, with a warning that MATLAB alone can check it, and saved', async () => {
    const o = await open('acs_ref.slx');
    const ref = setRow(o.view.posts, 'RefFromDict');
    assert.strictEqual(ref._canSetActive, true);
    o.view.send({ type: 'setActiveConfigSet', rowId: ref.ID });
    await waitFor('the reference painted active', () => setRow(o.view.posts, 'RefFromDict').Name.iconId === 'check_configurationReference');
    assert.strictEqual(o.events.length, 1);
    assert.deepStrictEqual(warned, [
      '"RefFromDict" refers to the configuration set "dictCfg" in the data dictionary "acs_dict.sldd". Without MATLAB this editor ' +
        'cannot check that the set is there: open the model in MATLAB to confirm.',
    ]);
    await provider.saveCustomDocument(o.doc, token());
    assert.deepStrictEqual(activeIn(new Uint8Array(readFileSync(o.path))), ['RefFromDict']);
  });

  test('a model of one set, as most are, offers the gallery’s Configurations tiles and takes a set added', async () => {
    const o = await open('one.slx');
    const first = o.view.posts.find((p) => p.type === 'setRows');
    assert.deepStrictEqual(first.addSections, ['config']);
    assert.strictEqual(setRow(o.view.posts, 'Configuration').Name.editable, true);
    o.view.send({ type: 'addEntry', className: 'Simulink.ConfigSet', section: 'config', rename: false });
    await waitFor('the added set', () => tableOf(o.view.posts).some((r) => r.parent === 'section:config' && nameOf(r) === 'Configuration1'));
    await provider.saveCustomDocument(o.doc, token());
    const sets = parseSlx(buffer(new Uint8Array(readFileSync(o.path))), 'saved.slx').configSets.map((c: any) => c.name);
    assert.deepStrictEqual(sets, ['Configuration', 'Configuration1']);
  });

  test('a set copied and pasted into Configurations is named as MATLAB names a duplicate, one edit, and saved', async () => {
    const o = await open('acs_sets.slx');
    const rules = [...o.view.posts].reverse().find((p) => p.type === 'sectionRules');
    assert.deepStrictEqual(rules.rules.map((r: any) => r.sectionName), ['workspace', 'config'], 'the sets take a paste');
    o.view.send({ type: 'copy', rowIds: [setRow(o.view.posts, 'Fast').ID] });
    o.view.send({ type: 'paste', rowId: 'section:config' });
    await waitFor('the pasted set', () => tableOf(o.view.posts).some((r) => r.parent === 'section:config' && nameOf(r) === 'Fast1'));
    assert.strictEqual(o.events.length, 1, 'one edit on the stack');
    await provider.saveCustomDocument(o.doc, token());
    const sets = parseSlx(buffer(new Uint8Array(readFileSync(o.path))), 'saved.slx').configSets.map((c: any) => c.name);
    assert.deepStrictEqual(sets, ['Configuration', 'Fast', 'Slow', 'Fast1']);
  });

  test('a set added from the gallery, renamed and another deleted, is one edit each on VS Code’s stack, and saved', async () => {
    const o = await open('acs_sets.slx');
    const names = () => tableOf(o.view.posts).filter((r) => r.parent === 'section:config').map(nameOf);
    const first = o.view.posts.find((p) => p.type === 'setRows');
    assert.deepStrictEqual(first.addSections, ['config'], 'the gallery offers the Configurations tiles');
    o.view.send({ type: 'addEntry', className: 'Simulink.ConfigSet', section: 'config', rename: false });
    await waitFor('the added set', () => names().includes('Configuration1'));
    o.view.send({ type: 'edit', rowId: setRow(o.view.posts, 'Configuration1').ID, columnId: 'Name', oldValue: 'Configuration1', newValue: 'Newest' });
    await waitFor('the renamed set', () => names().includes('Newest'));
    o.view.send({ type: 'delete', rowIds: [setRow(o.view.posts, 'Slow').ID] });
    await waitFor('the deleted set', () => !names().includes('Slow'));
    assert.strictEqual(o.events.length, 3, 'three edits on the stack');
    await o.events[2].undo();
    await waitFor('the delete undone', () => names().includes('Slow'));
    await o.events[2].redo();
    await waitFor('the delete redone', () => !names().includes('Slow'));
    await provider.saveCustomDocument(o.doc, token());
    const sets = parseSlx(buffer(new Uint8Array(readFileSync(o.path))), 'saved.slx').configSets.map((c: any) => c.name);
    assert.deepStrictEqual(sets, ['Configuration', 'Fast', 'Newest']);
    assert.strictEqual(o.doc.edits.dirty, false);
  });
});
