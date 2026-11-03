// Copyright 2026 The MathWorks, Inc.
// The commands a user runs by name or by key, run in a real window.
//
// test/manifest.test.ts reads the manifest's commands, menus and keys out of package.json; what only
// the running extension can say is whether each names a command that activate() registered, and what
// the commands with no test of their own do: Show Properties brings up the Properties view, and Add
// an Entry opens the Add gallery of the table in front (editorHub.ts, unit-tested over its map) and of
// no other. The tables are real tabs of the registered editors, read through tools/webviewTap.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { quiet, waitFor, wsUri } from './tools/hostHarness';
import { matFixture } from './tools/tables';
import { closeAllEditors, isPropertiesShell, openTab, postsOf, tapWebviews, type TappedView, type WebviewTap } from './tools/webviewTap';

/* eslint-disable @typescript-eslint/no-explicit-any */

const EXTENSION = 'mathworks.simulink-data-explorer';

suite('every command the manifest offers is registered', () => {
  test('each declared command, each keybinding and each menu entry names a command the extension registered', async () => {
    await vscode.extensions.getExtension(EXTENSION)?.activate();
    const contributes = vscode.extensions.getExtension(EXTENSION)!.packageJSON.contributes;
    const registered = new Set(await vscode.commands.getCommands(true));
    const declared: string[] = contributes.commands.map((c: { command: string }) => c.command);
    assert.ok(declared.length > 0, 'the manifest declares commands');
    assert.deepStrictEqual(declared.filter((c) => !registered.has(c)), [], 'declared but never registered');

    const keyed: string[] = contributes.keybindings.map((k: { command: string }) => k.command);
    assert.ok(keyed.length > 0, 'the manifest binds keys');
    assert.deepStrictEqual(keyed.filter((c) => !registered.has(c)), [], 'a key bound to no command');

    const menus = Object.values(contributes.menus as Record<string, { command: string }[]>).flat();
    assert.deepStrictEqual(menus.map((m) => m.command).filter((c) => !declared.includes(c)), [], 'a menu entry for an undeclared command');
  });
});

suite('Show Properties, and Add an Entry', () => {
  let tap: WebviewTap;
  let dir: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION)?.activate();
    tap = tapWebviews();
    dir = mkdtempSync(join(tmpdir(), 'dex-commands-'));
  });

  suiteTeardown(async () => {
    tap?.restore();
    await closeAllEditors();
    rmSync(dir, { recursive: true, force: true });
  });

  setup(closeAllEditors);

  const galleries = (v: TappedView): number => postsOf(v, 'openAddGallery').length;

  /** Wait until `view`'s panel is the one in front, which is the question the command asks. */
  async function inFront(view: TappedView, name: string): Promise<void> {
    await waitFor(`${name}'s panel to be the active one`, () => tap.panelOf(view)?.active === true);
  }

  test('Show Properties brings up the Properties view', async () => {
    // Nothing else in the suite shows the view, so its provider is asked for its page here first.
    const mark = tap.mark();
    await vscode.commands.executeCommand('dataExplorer.showProperties');
    const view = await tap.next(mark, 'the Properties view to be resolved', isPropertiesShell);
    assert.match(view.html, /<dex-property-inspector/, 'the Property Inspector page');
  });

  test('Add an Entry opens the Add gallery of the table in front, and of no other', async () => {
    const json = await openTab(tap, wsUri('data.sldd'), 'dataExplorer.tableView');
    const binary = await openTab(tap, wsUri('binary.sldd'), 'dataExplorer.binarySlddView');
    await inFront(binary, 'binary.sldd');
    await vscode.commands.executeCommand('dataExplorer.addEntry');
    await waitFor("binary.sldd's Add gallery", () => galleries(binary) > 0);
    assert.deepStrictEqual([galleries(json), galleries(binary)], [0, 1]);

    const matPath = join(dir, 'add_entry.mat');
    writeFileSync(matPath, matFixture('cases.mat'));
    const mat = await openTab(tap, vscode.Uri.file(matPath), 'dataExplorer.matView');
    await inFront(mat, 'add_entry.mat');
    await vscode.commands.executeCommand('dataExplorer.addEntry');
    await waitFor("the MAT-file's Add gallery", () => galleries(mat) > 0);

    await vscode.commands.executeCommand('vscode.openWith', wsUri('data.sldd'), 'dataExplorer.tableView');
    await inFront(json, 'data.sldd');
    await vscode.commands.executeCommand('dataExplorer.addEntry');
    await waitFor("data.sldd's Add gallery", () => galleries(json) > 0);
    assert.deepStrictEqual([galleries(json), galleries(binary), galleries(mat)], [1, 1, 1], 'each time, the one in front');
  });

  test('Add an Entry over the read-only model view opens nothing', async () => {
    const json = await openTab(tap, wsUri('data.sldd'), 'dataExplorer.tableView');
    // A `.mdl`, beside the workspace folder (test-integration/fixtures/legacy): the read-only view
    // shows a `.mdl`, and a `.slx` opens in the model editor.
    const mdl = vscode.Uri.joinPath(wsUri('.'), '..', 'legacy', 'legacyClassic.mdl');
    const model = await openTab(tap, mdl, 'dataExplorer.binaryView');
    await inFront(model, 'legacyClassic.mdl');
    await vscode.commands.executeCommand('dataExplorer.addEntry');
    await quiet(500, 'an Add gallery opening where nothing can be added');
    assert.deepStrictEqual([galleries(json), galleries(model)], [0, 0]);
  });
});
