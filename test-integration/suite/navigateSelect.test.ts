// Copyright 2026 The MathWorks, Inc.
// The row a Usage link names is selected in the tab the click opens.
//
// A Usage-link click is two things: open the file the link names, then select the row in it.
// navigate.test.ts proves the first. The second is navigate.ts's: `requestSelect` holds the name
// for the file, and the tab showing it posts `selectByName` to its page, either at its first paint
// (`drainNavigateSelect`: the tab did not exist when the link was clicked) or at once
// (`wireNavigateSelect`: it did). The page's half, `selectByName` → the table's selection, is
// unit-tested (nameSelectTarget, blockSidIdentity).
//
// Two suites. The first clicks a link in a REAL tab of the registered editors, so the closure
// activate() wires (navigate → handleNavigate → openInBestEditor) is what answers it; it reads the
// tab's messages through tools/webviewTap. The second holds each of the four table providers to the
// rule on its own, around a fake panel.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { requestSelect } from '../../src/host/navigate';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { ctx, fakePanel, quiet, token, waitFor, wsUri } from './tools/hostHarness';
import { closeAll, fixturePath, matFixture, openBinary, openJson, openMat, type Opened } from './tools/tables';
import { closeAllEditors, openTab, paintedView, tabsOn, tapWebviews, typesOf, viewTypeOf, type TappedView, type WebviewTap } from './tools/webviewTap';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABLE_VIEW = 'dataExplorer.tableView';
const BINARY_VIEW = 'dataExplorer.binaryView';
const BINARY_SLDD_VIEW = 'dataExplorer.binarySlddView';

/** The names a view was asked to select, in order. */
const selected = (posts: any[]): string[] => posts.filter((m) => m?.type === 'selectByName').map((m) => m.name);

/** Where in `posts` the first message of `type` is, or -1. */
const indexOf = (posts: any[], type: string): number => posts.findIndex((m) => m?.type === type);

suite('a Usage link clicked in a real tab selects its row in the tab it opens', () => {
  let tap: WebviewTap;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    tap = tapWebviews();
  });

  suiteTeardown(async () => {
    tap?.restore();
    await closeAllEditors();
  });

  setup(closeAllEditors);

  /** Click `target` in `from`'s page, and answer the view of the tab it opened on `uri`, painted. */
  async function click(from: TappedView, target: string, uri: vscode.Uri): Promise<TappedView> {
    const mark = tap.mark();
    tap.send(from, { type: 'navigate', target });
    return paintedView(tap, mark, uri);
  }

  async function selectedIn(view: TappedView, name: string): Promise<void> {
    await waitFor(`the selection of "${name}" to reach its tab`, () => selected(view.posts).length > 0, 20000, () => typesOf(view));
    assert.deepStrictEqual(selected(view.posts), [name], 'the row the link names is selected, once');
    assert.ok(indexOf(view.posts, 'setRows') < indexOf(view.posts, 'selectByName'), 'after the rows it selects into');
  }

  test("a link in a model's tab opens the JSON dictionary in its table, and selects the entry there", async () => {
    const dict = wsUri('data.sldd');
    const model = await openTab(tap, wsUri('model.slx'), BINARY_VIEW);
    const table = await click(model, `Hybrid@${dict.toString()}`, dict);
    assert.deepStrictEqual(tabsOn(dict).map(viewTypeOf), [TABLE_VIEW], 'the dictionary opened in the editable table');
    await selectedIn(table, 'Hybrid');
  });

  test("a link in a dictionary's tab opens the model in its view, and selects the block there", async () => {
    const model = wsUri('model.slx');
    const table = await openTab(tap, wsUri('data.sldd'), TABLE_VIEW);
    const view = await click(table, `blocks:Gain1@${model.toString()}`, model);
    assert.deepStrictEqual(tabsOn(model).map(viewTypeOf), [BINARY_VIEW], 'the model opened in its read-only view');
    await selectedIn(view, 'Gain1');
  });

  test('a link to a compressed dictionary opens it in its own editor, and selects the entry there', async () => {
    const dict = wsUri('binary.sldd');
    const model = await openTab(tap, wsUri('model.slx'), BINARY_VIEW);
    const table = await click(model, `Kp@${dict.toString()}`, dict);
    assert.deepStrictEqual(tabsOn(dict).map(viewTypeOf), [BINARY_SLDD_VIEW], 'the dictionary opened in its writable editor');
    await selectedIn(table, 'Kp');
  });

  test('with the dictionary already open, the link selects the entry in that tab at once, and opens no other', async () => {
    const dict = wsUri('data.sldd');
    const table = await openTab(tap, dict, TABLE_VIEW);
    const model = await openTab(tap, wsUri('model.slx'), BINARY_VIEW);
    const mark = tap.mark();
    tap.send(model, { type: 'navigate', target: `Number@${dict.toString()}` });
    await waitFor('the selection to reach the open table', () => selected(table.posts).length > 0, 20000, () => typesOf(table));
    assert.deepStrictEqual(selected(table.posts), ['Number']);
    await waitFor('the dictionary tab to be the active one again', () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input instanceof vscode.TabInputCustom && input.uri.toString() === dict.toString();
    });
    assert.deepStrictEqual(tabsOn(dict).map(viewTypeOf), [TABLE_VIEW], 'the tab that was open, and no second one');
    assert.deepStrictEqual(tap.views.slice(mark), [], 'no new view was made for it');
  });
});

// The providers the test builds itself, around fake panels: the same navigate.ts module as theirs
// (esbuild bundles one copy per test file), so `requestSelect` here is the one they listen to.
interface Kind {
  name: string;
  ext: string;
  /** The row a request names: one the file has, though the host does not check. */
  row: string;
  /**
   * Whether a second `ready` is answered with a whole paint. The JSON and MAT-file tables answer it
   * with the paint they already sent (engineTable's `answered`), so nothing new is posted.
   */
  repaints: boolean;
  /** A copy of the kind's fixture as `as` in `dir`, opened and painted. */
  open(opened: Opened, dir: string, as: string): Promise<{ uri: vscode.Uri; view: ReturnType<typeof fakePanel> }>;
}

const types = (posts: any[]): string => JSON.stringify(posts.map((m) => m?.type));
const paints = (posts: any[]): number => posts.filter((m) => m?.type === 'setRows').length;

const KINDS: Kind[] = [
  {
    name: 'the JSON dictionary table (SlddTextEditorProvider)',
    repaints: false,
    ext: 'sldd',
    row: 'gravity',
    open: (opened, dir, as) => openJson(opened, dir, as),
  },
  {
    name: 'the compressed dictionary editor (BinarySlddEditorProvider)',
    repaints: true,
    ext: 'sldd',
    row: 'gravity',
    open: (opened, dir, as) => openBinary(opened, dir, as),
  },
  {
    name: 'the MAT-file editor (MatEditorProvider)',
    repaints: false,
    ext: 'mat',
    row: 'scalarD',
    open: (opened, dir, as) => openMat(opened, dir, as, matFixture('cases.mat')),
  },
  {
    // No opener in tools/tables: the read-only view has no edits to drive.
    name: 'the read-only model view (BinaryEditorProvider)',
    repaints: true,
    ext: 'slx',
    row: 'Gain',
    async open(opened, dir, as) {
      const path = join(dir, as);
      copyFileSync(fixturePath('standalone', 'selfContained.slx'), path);
      const uri = vscode.Uri.file(path);
      const provider = new BinaryEditorProvider(ctx());
      const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
      const view = fakePanel();
      opened.push(() => doc.dispose(), () => view.close());
      await provider.resolveCustomEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor(`${as}'s first rows`, () => paints(view.posts) > 0, 20000, () => types(view.posts));
      return { uri, view };
    },
  },
];

suite('each table provider selects the row a link asked for', () => {
  let dir: string;
  const opened: Opened = [];

  suiteSetup(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-navigate-select-'));
  });

  teardown(() => closeAll(opened));

  suiteTeardown(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  KINDS.forEach((kind, i) => {
    test(`${kind.name}: a row asked for before the tab existed is selected after its first paint, and only then`, async () => {
      const as = `pending_${i}.${kind.ext}`;
      // The click comes first: the tab it opens does not exist yet to hear it.
      requestSelect(vscode.Uri.file(join(dir, as)).toString(), kind.row);
      const { view } = await kind.open(opened, dir, as);
      await waitFor('the held selection to be posted', () => selected(view.posts).length > 0, 20000, () => types(view.posts));
      assert.deepStrictEqual(selected(view.posts), [kind.row]);
      assert.ok(indexOf(view.posts, 'setRows') < indexOf(view.posts, 'selectByName'), 'after the rows it selects into');

      // Held once: a page that says `ready` again is not a second click.
      const before = paints(view.posts);
      view.send({ type: 'ready' });
      if (kind.repaints) await waitFor('the repaint', () => paints(view.posts) > before, 20000, () => types(view.posts));
      else await quiet(300, 'a second paint, which this table does not make for a second ready');
      assert.deepStrictEqual(selected(view.posts), [kind.row], 'a second ready selects nothing again');
    });

    test(`${kind.name}: an open tab selects a row asked for at once, ignores one for another file, and a closed one is not asked`, async () => {
      const { uri, view } = await kind.open(opened, dir, `live_${i}.${kind.ext}`);
      assert.deepStrictEqual(selected(view.posts), [], 'nothing was asked for yet');

      requestSelect(vscode.Uri.file(join(dir, `other_${i}.${kind.ext}`)).toString(), kind.row);
      requestSelect(uri.toString(), kind.row);
      await waitFor('the selection to reach the open tab', () => selected(view.posts).length > 0, 20000, () => types(view.posts));
      assert.deepStrictEqual(selected(view.posts), [kind.row], "only this file's request, once");

      // Closed as the teardown would close it, so nothing is closed twice.
      closeAll(opened);
      requestSelect(uri.toString(), kind.row);
      await quiet(300, 'a closed view being posted the selection');
      assert.deepStrictEqual(selected(view.posts), [kind.row], 'a closed view is not posted to');
    });
  });
});
