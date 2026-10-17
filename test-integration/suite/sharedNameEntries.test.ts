// Copyright 2026 The MathWorks, Inc.
// Two entries with one name in one section, through the real text editor (F1-50).
//
// The ruling (2026-10-16, group E): core refuses to edit or delete by id while an id names two
// nodes, and warns at open. A node id is a path, so two same-named entries in one section are one
// id, and the table cannot tell which of the two rows was clicked. Only a malformed file holds
// such a pair. The file still opens, and both entries are on screen.
//
// What the host owes the ruling, and what this suite reads off a real SlddTextEditorProvider:
//   - the banner says the names are shared. It does not count the twins as parts that could not
//     be read, since nothing was lost;
//   - a cell edit on a twin is refused and the file is untouched. SlddModel.findNode used to fall
//     back to its cached tree when the session answered null, and for this editor that tree IS
//     the session's, so it handed the edit to the FIRST twin whichever row was clicked;
//   - an entry with a name of its own still edits as before.
//
// The fixture is the workspace's params.sldd with a second `gravity` (a Simulink.Parameter, with
// its own uuid) right after the first. Each test edits its own copy in a temporary directory.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { strFromU8, strToU8 } from 'fflate';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { chunkOf, ctx, fakePanel, isEntryRow, nameOf, rowNamed, settle, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TWIN = 'gravity';
const SHARED = 'Some items in this file share a name, so they cannot be edited or deleted here.';
const CORE_SAYS =
  "Two entries in Design Data are named 'gravity'. " +
  'Neither can be edited or deleted until the file gives one of them another name.';

/** params.sldd with a second `gravity` right after the first, under a uuid of its own. */
function withTwin(original: string): string {
  const doc = JSON.parse(original);
  const entries: any[] = doc.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  const at = entries.findIndex((e) => e.name === TWIN);
  assert.ok(at >= 0, `the fixture holds ${TWIN}`);
  const twin = JSON.parse(JSON.stringify(entries[at]));
  twin.metadata.uuid = 'f1-50-second-gravity';
  entries.splice(at + 1, 0, twin);
  return JSON.stringify(doc, null, '\t');
}

/** `uuid Value` for each entry the text holds under `name`, in file order. */
const valuesOf = (text: string, name: string): string[] =>
  ((chunkOf(text).entries ?? []) as any[])
    .filter((e) => e.name === name)
    .map((e) => `${e.metadata?.uuid} ${JSON.stringify(e.value?._elements?.[0]?._properties?.Value ?? e.value)}`);

const errorsIn = (posts: any[]): string[] => posts.filter((m) => m.type === 'error').map((m) => String(m.message));

interface Opened {
  doc: vscode.TextDocument;
  view: ReturnType<typeof fakePanel>;
  paint: any;
}

suite('two entries with one name in one section, in the text editor', () => {
  let dir: string | undefined;
  let view: ReturnType<typeof fakePanel> | undefined;
  let copies = 0;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(() => {
    view?.close();
    view = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function open(): Promise<Opened> {
    const original = strFromU8(await vscode.workspace.fs.readFile(wsUri('params.sldd')));
    dir = mkdtempSync(join(tmpdir(), 'dex-shared-name-'));
    // A name of its own per test, so VS Code cannot hand back an earlier test's document.
    const uri = vscode.Uri.file(join(dir, `shared_name_${++copies}.sldd`));
    await vscode.workspace.fs.writeFile(uri, strToU8(withTwin(original)));
    const doc = await vscode.workspace.openTextDocument(uri);
    view = fakePanel();
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the table paint', () => view!.posts.some((p) => p.type === 'setRows' || p.type === 'error'));
    assert.deepStrictEqual(errorsIn(view.posts), [], 'the file opens');
    return { doc, view, paint: view.posts.find((p) => p.type === 'setRows') };
  }

  /** Send `msg`, and wait for the host to refuse it or to change the document. */
  async function answered(opened: Opened, msg: any): Promise<{ before: string; errors: string[] }> {
    const before = opened.doc.getText();
    opened.view.posts.length = 0;
    opened.view.send(msg);
    const deadline = Date.now() + 8000;
    while (opened.doc.getText() === before && errorsIn(opened.view.posts).length === 0 && Date.now() < deadline) {
      await settle(20);
    }
    await settle(300);
    return { before, errors: errorsIn(opened.view.posts) };
  }

  test('the banner says the names are shared, and counts nothing as unread', async () => {
    const { paint } = await open();
    const twins = (paint.rows as any[]).filter((r) => isEntryRow(r) && nameOf(r) === TWIN);
    assert.strictEqual(twins.length, 2, 'both entries are on screen');
    assert.ok(paint.warnings, 'the paint carries a banner');
    assert.strictEqual(paint.warnings.headline, SHARED);
    assert.deepStrictEqual(paint.warnings.details, [CORE_SAYS], "core's message is below it");
  }).timeout(60000);

  test('a cell edit on a twin is refused, and the file is untouched', async () => {
    const opened = await open();
    const row = rowNamed(opened.paint.rows, TWIN);
    const { before, errors } = await answered(opened, {
      type: 'edit',
      rowId: row.ID,
      columnId: 'Value',
      oldValue: '9.81',
      newValue: '1',
    });
    assert.deepStrictEqual(
      valuesOf(opened.doc.getText(), TWIN),
      valuesOf(before, TWIN),
      'neither gravity was edited',
    );
    assert.strictEqual(opened.doc.getText(), before, 'the document is untouched');
    assert.strictEqual(errors.length, 1, `one refusal: ${errors.join(' | ')}`);
  }).timeout(60000);

  test('an entry with a name of its own still edits as before', async () => {
    const opened = await open();
    const row = rowNamed(opened.paint.rows, 'scalarD');
    const { errors } = await answered(opened, {
      type: 'edit',
      rowId: row.ID,
      columnId: 'Value',
      oldValue: '3.14',
      newValue: '42',
    });
    assert.deepStrictEqual(errors, [], 'the edit is applied');
    const scalarD = ((chunkOf(opened.doc.getText()).entries ?? []) as any[]).find((e) => e.name === 'scalarD');
    assert.strictEqual(scalarD?.value, 42, 'and lands in the text');
  }).timeout(60000);
});
