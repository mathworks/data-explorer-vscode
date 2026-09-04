// Copyright 2026 The MathWorks, Inc.
// Integration tests for `.mdl`, the other container a Simulink model lives in.
//
// A model reaches this extension in three on-disk forms — a ZIP `.slx`, a modern
// `.mdl` (the same OPC parts written as TEXT with __MWOPC_PART_BEGIN__ delimiters),
// and a classic pre-R2012 `.mdl` (nested braces) — and core's parseModel decides
// which from the BYTES, never from the extension. The host's job is only to route
// both extensions to it. These tests prove the routing over real files in a real
// VS Code, at the two places the vitest suite structurally cannot reach:
//
//   1. the custom-editor selector in package.json plus BinaryEditorProvider — a
//      `.mdl` missing from the selector opens in VS Code's own text/hex editor, so
//      the extension simply looks like it does not support the format;
//   2. usageGraph.ts, which imports `vscode` and is excluded from the vitest
//      coverage/run — a model type it does not recognise contributes no edges, so
//      every parameter in the file renders as unused with no error anywhere.
//
// Both `.mdl` flavours link the SAME dictionary and use the SAME variable `Kp`, so
// the assertions below are about one rule holding across two framings rather than
// two independent features. Fixtures: `node test-integration/fixtures/make-legacy.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  ensureUsageGraph,
  invalidateUsageGraph,
  paramLinksForBlock,
  blocksUsingVariable,
} from '../../src/host/usageGraph';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';

const BINARY_VIEW = 'dataExplorer.binaryView';
const TABLE_VIEW = 'dataExplorer.tableView';

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

// Same rebuild-and-retry shape as caseRefUsage/singleFileUsage, and for the same
// reason: this bundled test file links its OWN copy of usageGraph (esbuild inlines
// the src module), a SEPARATE instance from the one in the running extension, so
// the extension's onDidChangeTabs→invalidate wiring never clears THIS instance's
// cache. Invalidating here is what re-runs buildGraph against the live open-tab
// set — the code path under test. The retry also absorbs the lag between `openWith`
// resolving and the tab appearing in vscode.window.tabGroups.
async function pollRebuilt<T>(fn: () => Promise<T>, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  const attempt = async (): Promise<T> => {
    invalidateUsageGraph();
    await ensureUsageGraph();
    return fn();
  };
  let last: T = await attempt();
  while (Date.now() - start < timeoutMs) {
    if (last) return last;
    await new Promise((r) => setTimeout(r, 50));
    last = await attempt();
  }
  return last;
}

// The dictionary goes straight to the editable table view rather than the default
// binaryView, which would REDIRECT editable JSON .sldd (dispose that tab, reopen in
// tableView) — a window during which the tab is briefly absent from tabGroups.
// Opening the destination directly keeps all three tabs continuously present.
async function openAllFixtures(): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', legacyUri(DICT), TABLE_VIEW);
  for (const name of [CLASSIC, MODERN]) {
    await vscode.commands.executeCommand('vscode.openWith', legacyUri(name), BINARY_VIEW);
  }
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

  test('a CLASSIC .mdl’s block parameters resolve to its linked dictionary', async () => {
    // The brace format's blocks are `Block { BlockType Gain  Name "x"  Gain "Kp" }`
    // — nothing like the XML a .slx carries. Before `.mdl` was routed to parseModel,
    // this model contributed no ModelSummary at all and ClassicGain rendered with
    // no source and no link, indistinguishable from a genuinely unresolved param.
    await openAllFixtures();
    const links = await pollRebuilt(async () => {
      const l = await paramLinksForBlock(legacyUri(CLASSIC).toString(), 'ClassicGain');
      return l.length > 0 && l[0].linkTarget ? l : null;
    });
    assert.ok(links, 'ClassicGain has a resolved param link');
    assert.strictEqual(links!.length, 1);
    assert.strictEqual(links![0].property, 'Gain');
    assert.strictEqual(links![0].paramName, 'Kp');
    assert.strictEqual(links![0].source, DICT);
    assert.strictEqual(links![0].linkTarget, `Kp@${legacyUri(DICT).toString()}`);

    // The classic model's second block, through a different parameter property.
    const constLinks = await paramLinksForBlock(legacyUri(CLASSIC).toString(), 'ClassicConst');
    assert.strictEqual(constLinks.length, 1, 'ClassicConst has one resolved param link');
    assert.strictEqual(constLinks[0].property, 'Value');
    assert.strictEqual(constLinks[0].paramName, 'Uo');
    assert.strictEqual(constLinks[0].source, DICT);
  });

  test('a MODERN .mdl resolves identically — the framing changes, the result does not', async () => {
    // Same dictionary, same variable, same link: the text-OPC package and the ZIP
    // it mirrors must be indistinguishable downstream. A framing bug here (a lost
    // part, or the delimiter's newline kept as part content) leaves the JSON parts
    // unparseable and this model, too, contributing nothing.
    await openAllFixtures();
    const links = await pollRebuilt(async () => {
      const l = await paramLinksForBlock(legacyUri(MODERN).toString(), 'ModernGain');
      return l.length > 0 && l[0].linkTarget ? l : null;
    });
    assert.ok(links, 'ModernGain has a resolved param link');
    assert.strictEqual(links!.length, 1);
    assert.strictEqual(links![0].property, 'Gain');
    assert.strictEqual(links![0].paramName, 'Kp');
    assert.strictEqual(links![0].source, DICT);
    assert.strictEqual(links![0].linkTarget, `Kp@${legacyUri(DICT).toString()}`);
  });

  test('the dictionary’s own Usage column lists blocks from BOTH .mdl flavours', async () => {
    // The reverse direction, and the sharpest single assertion in the suite: one
    // variable, two models, two different on-disk framings, one edge list. If either
    // flavour were dropped, Kp would look as though only one model used it.
    await openAllFixtures();
    const usedBy = await pollRebuilt(async () => {
      const u = await blocksUsingVariable(legacyUri(DICT).toString(), 'Kp');
      return u.length >= 2 ? u : null;
    });
    assert.ok(usedBy, 'Kp has reverse edges');
    const blocks = usedBy!.map((b) => b.blockName).sort();
    assert.deepStrictEqual(blocks, ['ClassicGain', 'ModernGain']);

    // The model LABEL drops the extension, the same way it does for a .slx: the
    // label is the model name MATLAB uses internally, and a row reading
    // `legacyClassic.mdl` would not match the block paths recorded inside the file.
    const labels = usedBy!.map((b) => b.modelName).sort();
    assert.deepStrictEqual(labels, ['legacyClassic', 'legacyModern']);

    // Uo is used by the classic model only, so a passing test above cannot be a
    // both-models-collapsed-into-one artefact.
    const uoUsers = await blocksUsingVariable(legacyUri(DICT).toString(), 'Uo');
    assert.strictEqual(uoUsers.length, 1);
    assert.strictEqual(uoUsers[0].blockName, 'ClassicConst');
    assert.strictEqual(uoUsers[0].modelUri, legacyUri(CLASSIC).toString());
  });

  test('with no tabs open, none of it resolves', async () => {
    // The control: the edges above exist because these files were opened, not
    // because something in the workspace happens to define `Kp`.
    invalidateUsageGraph();
    await ensureUsageGraph();
    for (const [model, block] of [
      [CLASSIC, 'ClassicGain'],
      [CLASSIC, 'ClassicConst'],
      [MODERN, 'ModernGain'],
    ] as const) {
      const links = await paramLinksForBlock(legacyUri(model).toString(), block);
      assert.strictEqual(links.length, 0, `${block} has no links before ${model} is opened`);
    }
    const usedBy = await blocksUsingVariable(legacyUri(DICT).toString(), 'Kp');
    assert.strictEqual(usedBy.length, 0, 'Kp has no reverse edges with nothing open');
  });
});
