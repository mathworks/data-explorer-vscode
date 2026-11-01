// Copyright 2026 The MathWorks, Inc.
// A file opened from the Data Explorer tree, or by `dataExplorer.openFile`, lands in the editor its
// format belongs in.
//
// The tree's row hands its file to `dataExplorer.openFile` (SectionsTreeProvider.getTreeItem), which
// asks extension.ts's bestViewType for the editor: the MAT-file editor for a `.mat`, the read-only
// view for a model and for a `.prj` (whose page that view draws, deciding by the name), and the
// project view for a `matlab.toml`, the one marker VS Code's own Explorer must keep opening as text
// (tomlProject.test.ts). toggle.test.ts covers the editable JSON `.sldd` and misroutedTab the zip
// `.sldd` through the repair; this covers every other format, from a row and from the command, and
// the two `.sldd` that are neither: one the host cannot read, and bytes that are neither zip nor
// JSON. Both open in the read-only view, which says it could not read the file; pinned as they are.
//
// The tree lists workspace files only, so the fixtures are copied into a scratch folder of the
// workspace for this suite and removed after it: every suite that runs later reads the workspace's
// four source fixtures and nothing else. The two unreadable dictionaries sit outside it, where no
// tree or index will read them.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SectionsTreeProvider } from '../../src/host/SectionsTreeProvider';
import { ctx, quiet, waitFor, ws } from './tools/hostHarness';
import { fixturePath } from './tools/tables';
import { closeAllEditors, isProjectShell, isTableShell, postsOf, tabsOn, tapWebviews, typesOf, viewTypeOf, type TappedView, type WebviewTap } from './tools/webviewTap';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCRATCH = 'open-routes-scratch';

interface Route {
  /** The file, relative to the scratch folder. */
  file: string;
  viewType: string;
  /** What the tab draws: a table, or a project's page (named `page`). */
  shell: 'table' | 'project';
  page?: string;
}

const ROUTES: Route[] = [
  { file: 'cases.mat', viewType: 'dataExplorer.matView', shell: 'table' },
  { file: 'selfContained.slx', viewType: 'dataExplorer.binaryView', shell: 'table' },
  { file: 'legacyClassic.mdl', viewType: 'dataExplorer.binaryView', shell: 'table' },
  { file: 'MyProj/MyProj.prj', viewType: 'dataExplorer.binaryView', shell: 'project', page: 'MyProj' },
  { file: 'tomlproject/matlab.toml', viewType: 'dataExplorer.projectView', shell: 'project', page: 'parityProject' },
];

/** The tree row whose open command names `uri`, looked for down to a file's references. */
async function rowFor(tree: SectionsTreeProvider, uri: vscode.Uri, nodes?: any[], depth = 0): Promise<vscode.TreeItem | undefined> {
  const level = nodes ?? (await tree.getChildren());
  for (const node of level) {
    const item = tree.getTreeItem(node);
    const arg = item.command?.arguments?.[0];
    if (arg instanceof vscode.Uri && arg.toString() === uri.toString()) return item;
  }
  if (depth >= 3) return undefined;
  for (const node of level) {
    if (node.collapsible !== 'collapsed') continue;
    const found = await rowFor(tree, uri, await tree.getChildren(node), depth + 1);
    if (found) return found;
  }
  return undefined;
}

suite('a file opened from the tree or by Open in Data Explorer lands in its own editor', () => {
  let tap: WebviewTap;
  let scratch: string;
  let outside: string;

  const at = (file: string): vscode.Uri => vscode.Uri.file(join(scratch, file));

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    scratch = join(ws().fsPath, SCRATCH);
    rmSync(scratch, { recursive: true, force: true }); // a previous crashed run
    mkdirSync(scratch);
    cpSync(fixturePath('mat', 'cases.mat'), join(scratch, 'cases.mat'));
    cpSync(fixturePath('standalone', 'selfContained.slx'), join(scratch, 'selfContained.slx'));
    cpSync(fixturePath('legacy', 'legacyClassic.mdl'), join(scratch, 'legacyClassic.mdl'));
    cpSync(join(ctx().extensionUri.fsPath, 'test', 'parity', 'artifacts', 'project', 'MyProj'), join(scratch, 'MyProj'), { recursive: true });
    cpSync(fixturePath('tomlproject'), join(scratch, 'tomlproject'), { recursive: true });
    outside = mkdtempSync(join(tmpdir(), 'dex-open-routes-'));
    tap = tapWebviews();
  });

  suiteTeardown(async () => {
    tap?.restore();
    await closeAllEditors();
    rmSync(scratch, { recursive: true, force: true });
    try {
      chmodSync(join(outside, 'unreadable.sldd'), 0o600);
    } catch {
      /* never made */
    }
    rmSync(outside, { recursive: true, force: true });
  });

  setup(closeAllEditors);

  /** Run `open`, and say what tab and view it made for `uri`. */
  async function opened(uri: vscode.Uri, open: () => Thenable<unknown>): Promise<{ tab: vscode.Tab; view: TappedView }> {
    const mark = tap.mark();
    await open();
    const name = uri.path.split('/').pop();
    await waitFor(`a tab on ${name}`, () => tabsOn(uri).length > 0);
    const view = await tap.next(mark, `${name}'s view`, (v) => isTableShell(v) || isProjectShell(v));
    return { tab: tabsOn(uri)[0], view };
  }

  /** What `route`'s tab shows, once its page has said `ready`. */
  async function check(route: Route, tab: vscode.Tab, view: TappedView): Promise<void> {
    assert.strictEqual(viewTypeOf(tab), route.viewType, `${route.file} opens in ${route.viewType}`);
    assert.strictEqual(tabsOn(at(route.file)).length, 1, 'in one tab');
    assert.strictEqual(tab.isPreview, true, 'a preview tab, as the Explorer opens one');
    assert.strictEqual(route.shell === 'project' ? isProjectShell(view) : isTableShell(view), true, `it draws a ${route.shell}`);
    tap.send(view, { type: 'ready' });
    if (route.shell === 'project') {
      await waitFor(`${route.file}'s page`, () => postsOf(view, 'setProject').length > 0, 20000, () => typesOf(view));
      assert.strictEqual(postsOf(view, 'setProject')[0].page.name, route.page);
    } else {
      await waitFor(`${route.file}'s rows`, () => postsOf(view, 'setRows').length > 0, 20000, () => typesOf(view));
    }
    assert.deepStrictEqual(postsOf(view, 'error'), [], 'and reads it');
  }

  for (const route of ROUTES) {
    test(`Open in Data Explorer: ${route.file} opens in ${route.viewType}`, async () => {
      const uri = at(route.file);
      const { tab, view } = await opened(uri, () => vscode.commands.executeCommand('dataExplorer.openFile', uri));
      await check(route, tab, view);
    });

    test(`the tree row of ${route.file} opens it in ${route.viewType}`, async () => {
      const uri = at(route.file);
      // A fresh tree per look: the files are seconds old, and a search that has not seen them yet
      // should read as slow, not as a row that is missing.
      let item: vscode.TreeItem | undefined;
      await waitFor(`${route.file}'s row in the tree`, async () => !!(item = await rowFor(new SectionsTreeProvider(ctx().extensionUri), uri)));
      assert.strictEqual(item!.command?.command, 'dataExplorer.openFile', 'the row opens through the command');
      const { tab, view } = await opened(uri, () => vscode.commands.executeCommand(item!.command!.command, ...(item!.command!.arguments ?? [])));
      await check(route, tab, view);
    });
  }

  test('Open in Data Explorer with no file opens nothing', async () => {
    const mark = tap.mark();
    await vscode.commands.executeCommand('dataExplorer.openFile');
    await quiet(500, 'a tab opening for no file');
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, 0, 'no tab');
    assert.deepStrictEqual(tap.views.slice(mark), [], 'no view');
  });

  test('a .sldd the host cannot read opens in the read-only view, which says it could not read it', async () => {
    const path = join(outside, 'unreadable.sldd');
    writeFileSync(path, readFileSync(join(ws().fsPath, 'data.sldd')));
    chmodSync(path, 0o000);
    assert.throws(() => readFileSync(path), 'the file is unreadable to this process (it does not run as root)');
    const uri = vscode.Uri.file(path);
    const { tab, view } = await opened(uri, () => vscode.commands.executeCommand('dataExplorer.openFile', uri));
    assert.strictEqual(viewTypeOf(tab), 'dataExplorer.binaryView');
    assert.ok(isTableShell(view));
    tap.send(view, { type: 'ready' });
    await waitFor("the view's error", () => postsOf(view, 'error').length > 0, 20000, () => typesOf(view));
    for (const m of postsOf(view, 'error')) assert.match(m.message, /^Failed to parse unreadable\.sldd: /);
    assert.deepStrictEqual(postsOf(view, 'setRows'), [], 'and no rows');
  });

  test('a .sldd that is neither zip nor JSON opens in the read-only view, which says it is no archive', async () => {
    const path = join(outside, 'junk.sldd');
    writeFileSync(path, 'not a dictionary, in any format\n');
    const uri = vscode.Uri.file(path);
    const { tab, view } = await opened(uri, () => vscode.commands.executeCommand('dataExplorer.openFile', uri));
    assert.strictEqual(viewTypeOf(tab), 'dataExplorer.binaryView');
    assert.ok(isTableShell(view));
    tap.send(view, { type: 'ready' });
    await waitFor("the view's error", () => postsOf(view, 'error').length > 0, 20000, () => typesOf(view));
    // Once per `ready`: the page's own, where the window draws it, comes on top of this one.
    for (const m of postsOf(view, 'error')) assert.strictEqual(m.message, 'Failed to parse junk.sldd: invalid zip data');
    assert.deepStrictEqual(postsOf(view, 'setRows'), [], 'and no rows');
  });
});
