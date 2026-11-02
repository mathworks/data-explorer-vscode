// Copyright 2026 The MathWorks, Inc.
// The project page, as the host builds it and as the host answers its links.
//
// A `.prj` or a `matlab.toml` opens on a page (BinaryEditorProvider), not a table: its `ready` is
// answered with view's `projectPageMessage` over the store this host reads, the marker's folder and,
// for a Managed Simulink Project, the `msp_config.json` beside it. tomlProject.test.ts parses the
// TOML store itself; here the page is the provider's post.
//
// A link on the page sends `openFile` with a project-root-relative path, and only the host knows the
// root, so the host decides what the click does (openProjectPath): a file opens, a folder is revealed
// in the Explorer (or by the OS file manager, for a project outside every workspace folder), a
// target that is not there is said in a warning, and a component project's link opens that project's
// page when its folder holds exactly one project. The links are the page's own: the paths the
// payload lists for its startup files, path folders, locations and references.
//
// What the host asks VS Code to do is read off `vscode.commands.executeCommand` and
// `vscode.window.showWarningMessage`, wrapped for this suite. An extension's `vscode` module is one
// object for every file of the extension, so the provider calls the wrapped functions. The two reveals
// are kept from running (a file manager is not something a test may open); a file opens for real.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { ctx, fakePanel, quiet, token, waitFor, ws } from './tools/hostHarness';
import { fixturePath } from './tools/tables';
import { closeAllEditors, tabsOn, viewTypeOf } from './tools/webviewTap';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCRATCH = 'project-links-scratch';
const ASKED = new Set(['vscode.open', 'vscode.openWith', 'revealInExplorer', 'revealFileInOS']);
const KEPT = new Set(['revealInExplorer', 'revealFileInOS']);

const myProj = () => join(ctx().extensionUri.fsPath, 'test', 'parity', 'artifacts', 'project', 'MyProj');
const libProj = () => join(ctx().extensionUri.fsPath, 'test', 'parity', 'artifacts', 'project', 'LibProj');

suite("the project page: what the host sends it, and how it answers the page's links", () => {
  let inside: string; // <workspace>/project-links-scratch
  let outside: string; // a temp folder, in no workspace folder
  let asked: [string, string, ...unknown[]][];
  let warned: string[];
  let restore: (() => void) | undefined;
  const closers: (() => void)[] = [];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    inside = join(ws().fsPath, SCRATCH);
    rmSync(inside, { recursive: true, force: true }); // a previous crashed run
    // MyProj names ../LibProj as its component; the TOML project names ../parityLib.
    cpSync(myProj(), join(inside, 'MyProj'), { recursive: true });
    cpSync(libProj(), join(inside, 'LibProj'), { recursive: true });
    cpSync(fixturePath('tomlproject'), join(inside, 'tomlproject'), { recursive: true });
    mkdirSync(join(inside, 'parityLib'));
    cpSync(fixturePath('tomlproject', 'matlab.toml'), join(inside, 'parityLib', 'matlab.toml'));
    // Two folders a component link may name that do not hold exactly one project.
    mkdirSync(join(inside, 'NoProj'));
    writeFileSync(join(inside, 'NoProj', 'readme.txt'), 'no project here\n');
    mkdirSync(join(inside, 'TwoProj'));
    writeFileSync(join(inside, 'TwoProj', 'One.prj'), 'PK');
    writeFileSync(join(inside, 'TwoProj', 'Two.prj'), 'PK');

    // MyProj alone, outside the workspace; its component is not beside it there.
    outside = mkdtempSync(join(tmpdir(), 'dex-project-links-'));
    cpSync(myProj(), join(outside, 'MyProj'), { recursive: true });

    const commands = vscode.commands as any;
    const window = vscode.window as any;
    const run = commands.executeCommand;
    const warn = window.showWarningMessage;
    commands.executeCommand = function (id: string, ...args: unknown[]) {
      if (ASKED.has(id)) asked.push([id, String(args[0]), ...args.slice(1)]);
      return KEPT.has(id) ? Promise.resolve(undefined) : run.call(this, id, ...args);
    };
    window.showWarningMessage = (message: string) => {
      warned.push(message);
      return Promise.resolve(undefined);
    };
    restore = () => {
      commands.executeCommand = run;
      window.showWarningMessage = warn;
    };
  });

  suiteTeardown(async () => {
    restore?.();
    for (const close of closers.splice(0)) close();
    await closeAllEditors();
    rmSync(inside, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  setup(() => {
    asked = [];
    warned = [];
  });

  teardown(async () => {
    for (const close of closers.splice(0)) close();
    await closeAllEditors();
  });

  /** The marker at `path`, opened on its page by a provider of the test's own: its page and its links. */
  async function page(path: string): Promise<{ message: any; click(link: unknown): void; root: vscode.Uri }> {
    const uri = vscode.Uri.file(path);
    const provider = new BinaryEditorProvider(ctx());
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    closers.push(() => view.close(), () => doc.dispose());
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor(`${path.split('/').pop()}'s page`, () => view.posts.some((m) => m.type === 'setProject' || m.type === 'error'));
    const message = view.posts.find((m) => m.type === 'setProject');
    assert.ok(message, `the page was sent, not ${JSON.stringify(view.posts.map((m) => m.type))}`);
    return { message, click: (link) => view.send({ type: 'openFile', ...(link as object) }), root: vscode.Uri.joinPath(uri, '..') };
  }

  const uriOf = (root: vscode.Uri, rel: string): string => vscode.Uri.joinPath(root, ...rel.split('/')).toString();

  test("a .prj's page: its name, its folder, and nothing it is not", async () => {
    const { message } = await page(join(inside, 'MyProj', 'MyProj.prj'));
    assert.strictEqual(message.page.name, 'MyProj');
    assert.strictEqual(message.root, join(inside, 'MyProj'), 'the folder the page names is the marker folder');
    assert.deepStrictEqual(message.page.references, [{ name: 'LibProj', path: '../LibProj' }]);
    assert.strictEqual(message.msp, undefined, 'not a Managed Simulink Project');
    assert.strictEqual(message.warnings, undefined, 'a MATLAB-written store reads cleanly');
  });

  test("a matlab.toml's page: its declared name and its folder", async () => {
    const { message } = await page(join(inside, 'tomlproject', 'matlab.toml'));
    assert.strictEqual(message.page.name, 'parityProject');
    assert.strictEqual(message.page.format, 'toml');
    assert.strictEqual(message.root, join(inside, 'tomlproject'));
  });

  test('a Managed Simulink Project: the page carries what its msp_config.json says', async () => {
    const root = join(outside, 'MspProj');
    cpSync(myProj(), root, { recursive: true });
    writeFileSync(join(root, 'msp_config.json'), JSON.stringify({ type: 'common', interfaceDictionary: 'data/iface.sldd', sharedConfigSetName: 'cfg' }));
    const { message } = await page(join(root, 'MyProj.prj'));
    assert.deepStrictEqual(message.msp, {
      role: 'common',
      dictionaries: [{ kind: 'interface', path: 'data/iface.sldd' }],
      sharedConfigSetName: 'cfg',
      evidence: ['msp_config.json'],
    });
  });

  test('a file link opens the file', async () => {
    const { message, click, root } = await page(join(inside, 'MyProj', 'MyProj.prj'));
    const file = message.page.startup[0].file;
    assert.strictEqual(file, 'startup.m', "the page's startup file");
    click({ path: file });
    await waitFor('the file to open', () => tabsOn(vscode.Uri.parse(uriOf(root, file))).length > 0);
    assert.deepStrictEqual(asked, [['vscode.open', uriOf(root, file)]]);
    assert.deepStrictEqual(warned, []);
  });

  test('a folder link reveals the folder in the Explorer', async () => {
    const { message, click, root } = await page(join(inside, 'MyProj', 'MyProj.prj'));
    const folder = message.page.pathFolders[0];
    assert.strictEqual(folder, 'utils', "the page's path folder");
    click({ path: folder });
    await waitFor('the folder to be revealed', () => asked.length > 0);
    assert.deepStrictEqual(asked, [['revealInExplorer', uriOf(root, folder)]]);
  });

  test('outside every workspace folder, a folder link goes to the OS file manager', async () => {
    const { message, click, root } = await page(join(outside, 'MyProj', 'MyProj.prj'));
    click({ path: message.page.pathFolders[0] });
    await waitFor('the folder to be revealed', () => asked.length > 0);
    assert.deepStrictEqual(asked, [['revealFileInOS', uriOf(root, 'utils')]]);
  });

  test('a link to what is not there says so, and opens nothing', async () => {
    const { message, click } = await page(join(inside, 'tomlproject', 'matlab.toml'));
    const cache = message.page.locations.find((l: any) => l.key === 'SimulinkCacheFolder');
    assert.strictEqual(cache?.ref, 'cache', 'the cache folder the project names before a build makes it');
    click({ path: cache.ref });
    await waitFor('the warning', () => warned.length > 0);
    assert.deepStrictEqual(warned, ['This project refers to cache, which is not there.']);
    assert.deepStrictEqual(asked, []);
  });

  test("a component's link opens the component's page", async () => {
    const { message, click, root } = await page(join(inside, 'MyProj', 'MyProj.prj'));
    click({ path: message.page.references[0].path, preferProject: true });
    const marker = vscode.Uri.joinPath(root, '..', 'LibProj', 'LibProj.prj');
    await waitFor("LibProj's page to open", () => tabsOn(marker).length > 0);
    assert.deepStrictEqual(asked, [['vscode.open', marker.toString()]]);
    assert.deepStrictEqual(tabsOn(marker).map(viewTypeOf), ['dataExplorer.binaryView'], 'the .prj opens in its own editor, on its page');
  });

  test("a TOML component's link opens its page in the project view, which an Explorer click does not reach", async () => {
    const { message, click, root } = await page(join(inside, 'tomlproject', 'matlab.toml'));
    click({ path: message.page.references[0].path, preferProject: true });
    const marker = vscode.Uri.joinPath(root, '..', 'parityLib', 'matlab.toml');
    await waitFor("parityLib's page to open", () => tabsOn(marker).length > 0);
    assert.deepStrictEqual(asked, [['vscode.openWith', marker.toString(), 'dataExplorer.projectView']]);
    assert.deepStrictEqual(tabsOn(marker).map(viewTypeOf), ['dataExplorer.projectView']);
  });

  test('a component folder that holds no project, or two, is revealed instead', async () => {
    const { click, root } = await page(join(inside, 'MyProj', 'MyProj.prj'));
    click({ path: '../NoProj', preferProject: true });
    await waitFor('the first reveal', () => asked.length > 0);
    click({ path: '../TwoProj', preferProject: true });
    await waitFor('the second reveal', () => asked.length > 1);
    assert.deepStrictEqual(asked, [
      ['revealInExplorer', uriOf(root, '../NoProj')],
      ['revealInExplorer', uriOf(root, '../TwoProj')],
    ]);
  });

  test("a component's folder link without the page's preference is a folder like any other", async () => {
    const { click, root } = await page(join(inside, 'MyProj', 'MyProj.prj'));
    click({ path: '../LibProj' });
    await waitFor('the reveal', () => asked.length > 0);
    assert.deepStrictEqual(asked, [['revealInExplorer', uriOf(root, '../LibProj')]]);
  });

  test("a component that is not beside the project says so", async () => {
    const { message, click } = await page(join(outside, 'MyProj', 'MyProj.prj'));
    click({ path: message.page.references[0].path, preferProject: true });
    await waitFor('the warning', () => warned.length > 0);
    assert.deepStrictEqual(warned, ['This project refers to ../LibProj, which is not there.']);
    assert.deepStrictEqual(asked, []);
  });

  test('a link with no path, or a path that is not a string, is dropped', async () => {
    const { click } = await page(join(inside, 'MyProj', 'MyProj.prj'));
    click({ path: '' });
    click({});
    click({ path: 7 });
    await quiet(500, 'a dropped link being answered');
    assert.deepStrictEqual(asked, []);
    assert.deepStrictEqual(warned, []);
  });
});
