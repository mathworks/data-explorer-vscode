// Copyright 2026 The MathWorks, Inc.
// Integration tests for `.mdl`, the other container a Simulink model lives in.
//
// A model reaches this extension in three on-disk forms — a ZIP `.slx`, a modern
// `.mdl` (the same OPC parts written as TEXT with __MWOPC_PART_BEGIN__ delimiters),
// and a classic pre-R2012 `.mdl` (nested braces) — and core's parseModel decides
// which from the BYTES, never from the extension. The host's job is only to route
// both extensions to it. These tests prove the routing over real files in a real
// VS Code, where the vitest suite cannot reach: the custom-editor selector in
// package.json plus BinaryEditorProvider. A `.mdl` missing from the selector opens in
// VS Code's own text/hex editor, so the extension simply looks like it does not
// support the format.
//
// What both flavours resolve to in the Usage column (their blocks' param links into
// the dictionary, and its reverse edges) is core's parseModel and summaries, pinned for
// these fixtures by view's goldens/usage.test.ts. Here the graph is only asked with no
// tab open, which is what the open-tab union gives files outside the workspace.
// Fixtures: `node test-integration/fixtures/make-legacy.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  invalidateUsageGraph,
  paramLinksForBlock,
  blocksUsingVariable,
} from '../../src/host/usageGraph';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';

const BINARY_VIEW = 'dataExplorer.binaryView';

const CLASSIC = 'legacyClassic.mdl';
const MODERN = 'legacyModern.mdl';
const DICT = 'legacyParams.sldd';

// The fixtures live in test-integration/fixtures/legacy, one level up from the
// workspace folder, so findFiles never returns them and they cannot perturb the
// exact-file-set assertions in sectionsTree.test.ts and nameIndex.test.ts. Open
// tabs are what feeds them into the graph.
function legacyUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'legacy', name);
}

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  // The provider only reads context.extensionUri; a minimal stand-in suffices.
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

suite('.mdl models (both flavours)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    invalidateUsageGraph();
  });

  test('the fixtures are outside the workspace, so findFiles never returns them', async () => {
    // The premise of the suite: the graph sees these files ONLY because they are
    // open in tabs, which is what makes the set under test exact.
    const found = await vscode.workspace.findFiles('**/*.{slx,mdl,sldd,mat}');
    for (const name of [CLASSIC, MODERN, DICT]) {
      const uri = legacyUri(name);
      await vscode.workspace.fs.stat(uri); // the fixture must exist
      assert.ok(
        !found.some((u) => u.toString() === uri.toString()),
        `${name} must not be discoverable via findFiles`,
      );
    }
  });

  test('the extension owns *.mdl: opening one lands in the binary custom editor', async () => {
    // The manifest's customEditors selector is the one consumer of the supported-
    // format list that no import can reach: the host can be fully wired for `.mdl`
    // and typecheck clean while the selector omits it, and then the file opens in
    // VS Code's built-in editor and the format looks unsupported. Only a real
    // openWith proves the declaration is there.
    for (const name of [CLASSIC, MODERN]) {
      const uri = legacyUri(name);
      await vscode.commands.executeCommand('vscode.openWith', uri, BINARY_VIEW);
      const tab = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .find((t) => (t.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString());
      assert.ok(tab, `${name} opens in a tab`);
      assert.strictEqual(
        (tab!.input as { viewType?: string }).viewType,
        BINARY_VIEW,
        `${name} must open in the binary custom editor, not VS Code's default`,
      );
    }
  });

  test('a classic .mdl renders the read-only table shell, not an error', async () => {
    // Both `.mdl` flavours are TEXT, unlike every other format this byte-backed
    // editor handles. It reads bytes and hands them to core, which sniffs the real
    // format — so nothing here needs to know that, and this asserts the render
    // completes rather than falling into the parse-failure banner.
    const provider = new BinaryEditorProvider(ctx());
    const token = new vscode.CancellationTokenSource().token;
    const doc = await provider.openCustomDocument(
      legacyUri(CLASSIC),
      {} as vscode.CustomDocumentOpenContext,
      token,
    );
    const panel = vscode.window.createWebviewPanel('test.mdlHost', 'test', vscode.ViewColumn.One, {
      enableScripts: true,
    });
    try {
      await provider.resolveCustomEditor(doc, panel, token);
      assert.ok(panel.webview.html.includes('<dex-tree-table'), 'renders the tree-table element');
      assert.ok(panel.webview.html.includes('Content-Security-Policy'), 'sets a CSP');
    } finally {
      panel.dispose();
    }
  });

  test('with no tabs open, none of it resolves', async () => {
    // The fixtures are outside the workspace, so with no tab open the graph never sees
    // them: nothing in the workspace defines `Kp`.
    invalidateUsageGraph();
    // `key` is each block's own: a name in the classic file, which records no SID, and
    // the SID in the modern one.
    for (const [model, block, key] of [
      [CLASSIC, 'ClassicGain', 'ClassicGain'],
      [CLASSIC, 'ClassicConst', 'ClassicConst'],
      [MODERN, 'ModernGain', '1'],
    ] as const) {
      const links = await paramLinksForBlock(legacyUri(model).toString(), key);
      assert.strictEqual(links.length, 0, `${block} has no links before ${model} is opened`);
    }
    const usedBy = await blocksUsingVariable(legacyUri(DICT).toString(), 'Kp');
    assert.strictEqual(usedBy.length, 0, 'Kp has no reverse edges with nothing open');
  });
});
