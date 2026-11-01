// Copyright 2026 The MathWorks, Inc.
// Search Data Source Entries (`dataExplorer.searchDataSources`, Cmd/Ctrl+Alt+E): a QuickPick over the
// names the workspace's data sources hold, which opens the picked entry's file and selects its row.
//
// searchSources.ts builds the QuickPick: empty until something is typed, then the matches view's
// `searchEntries` finds in the window's name index; a pick hides it and hands the record to
// extension.ts, which asks for the row (`requestSelect`) and opens the file (openInBestEditor). What
// a record carries is the name index's (nameIndex.test.ts); here the real command runs on the real
// index, and the tab it opens is read through tools/webviewTap.
//
// The QuickPick is the extension's own, kept by wrapping `vscode.window.createQuickPick` for this
// suite (an extension's `vscode` module is one object for every file of the extension). Typing is
// setting its `value`, which VS Code echoes back as the change event the search listens to, and the
// pick is VS Code's own accept command over the item VS Code made active.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { quiet, waitFor, wsUri } from './tools/hostHarness';
import { closeAllEditors, paintedView, tabsOn, tapWebviews, typesOf, viewTypeOf, type WebviewTap } from './tools/webviewTap';

/* eslint-disable @typescript-eslint/no-explicit-any */

suite('Search Data Source Entries', () => {
  let tap: WebviewTap;
  const picks: vscode.QuickPick<any>[] = [];
  let restore: (() => void) | undefined;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    tap = tapWebviews();
    const window = vscode.window as any;
    const create = window.createQuickPick;
    window.createQuickPick = function (...args: unknown[]) {
      const qp = create.apply(this, args);
      picks.push(qp);
      return qp;
    };
    restore = () => {
      window.createQuickPick = create;
    };
  });

  suiteTeardown(async () => {
    restore?.();
    tap?.restore();
    await closeAllEditors();
  });

  setup(closeAllEditors);

  teardown(() => {
    for (const qp of picks.splice(0)) qp.hide();
  });

  /** Run the command, and answer the QuickPick it showed, with the index loaded into it. */
  async function search(): Promise<{ qp: vscode.QuickPick<any>; hidden: () => boolean; active: () => readonly any[] }> {
    const before = picks.length;
    // Resolves once the index is in the QuickPick.
    await vscode.commands.executeCommand('dataExplorer.searchDataSources');
    assert.strictEqual(picks.length, before + 1, 'the command made one QuickPick');
    const qp = picks[before];
    let hid = false;
    let active: readonly any[] = qp.activeItems;
    qp.onDidHide(() => (hid = true));
    qp.onDidChangeActive((items) => (active = items));
    return { qp, hidden: () => hid, active: () => active };
  }

  /** Type `query`, and pick the one match `match` accepts, as VS Code's accept would. */
  async function pick(s: Awaited<ReturnType<typeof search>>, query: string, what: string, match: (item: any) => boolean): Promise<any> {
    s.qp.value = query;
    await waitFor(`the search for "${query}" to list ${what}`, () => s.qp.items.some(match), 20000, () => JSON.stringify(s.qp.items.map((i) => i.label)));
    const item = s.qp.items.find(match);
    if (s.active()[0] !== item) s.qp.activeItems = [item];
    // VS Code's own answer, so the accept below is the main thread's to take on this item.
    await waitFor(`VS Code to make ${what} the active item`, () => s.active()[0] === item);
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    await waitFor('the search to close on the pick', s.hidden);
    return item;
  }

  test('it opens empty, lists the entries whose name matches what is typed, and a pick opens the dictionary and selects the entry', async () => {
    const dict = wsUri('data.sldd');
    const s = await search();
    assert.strictEqual(s.qp.title, 'Search Data Source Entries');
    assert.deepStrictEqual(s.qp.items, [], 'nothing is listed before anything is typed');

    const mark = tap.mark();
    const item = await pick(s, 'Hybrid', 'Hybrid in data.sldd', (i) => i.label === 'Hybrid' && i.entry.sourceUri === dict.toString());
    assert.strictEqual(item.description, 'data.sldd', 'a match says which file it is in');

    const table = await paintedView(tap, mark, dict);
    const tabs = tabsOn(dict);
    assert.deepStrictEqual(tabs.map(viewTypeOf), ['dataExplorer.tableView'], 'the dictionary opened in the editable table');
    assert.strictEqual(tabs[0].isPreview, true, 'as a preview, as a tree row opens it');
    await waitFor('the selection to reach the table', () => table.posts.some((m) => m?.type === 'selectByName'), 20000, () => typesOf(table));
    assert.deepStrictEqual(table.posts.filter((m) => m?.type === 'selectByName').map((m) => m.name), ['Hybrid']);
  });

  test('a pick from a compressed dictionary opens it in its own editor and selects the entry', async () => {
    const dict = wsUri('binary.sldd');
    const s = await search();
    const mark = tap.mark();
    // A file's name finds what is in it: the search matches the source label as well as the name.
    await pick(s, 'binary.sldd', 'Kp in binary.sldd', (i) => i.label === 'Kp' && i.entry.sourceUri === dict.toString());

    const table = await paintedView(tap, mark, dict);
    assert.deepStrictEqual(tabsOn(dict).map(viewTypeOf), ['dataExplorer.binarySlddView']);
    await waitFor('the selection to reach the table', () => table.posts.some((m) => m?.type === 'selectByName'), 20000, () => typesOf(table));
    assert.deepStrictEqual(table.posts.filter((m) => m?.type === 'selectByName').map((m) => m.name), ['Kp']);
  });

  test('a query nothing matches lists nothing, and closing the search opens nothing', async () => {
    const s = await search();
    const mark = tap.mark();
    s.qp.value = 'Hybrid';
    await waitFor('the search for "Hybrid" to list it', () => s.qp.items.length > 0);
    s.qp.value = 'noSuchEntryAnywhere';
    await waitFor('the search to list nothing', () => s.qp.items.length === 0, 20000, () => JSON.stringify(s.qp.items.map((i) => i.label)));
    s.qp.hide();
    await waitFor('the search to close', s.hidden);
    await quiet(1000, 'a tab opening for a pick that was never made');
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, 0, 'no tab');
    assert.deepStrictEqual(tap.views.slice(mark), [], 'no view');
  });
});
