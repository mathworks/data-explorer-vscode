// Copyright 2026 The MathWorks, Inc.
// Integration test for the Usage column's independence from TAB HISTORY.
//
// Two engines can fill this cell. Core's `_usedByCell` answers from the DataModel
// session — the models whose editor was resolved in this window, which are never
// evicted — and names the block WITHOUT its model. The workspace usage graph answers
// from the files on disk plus the open tabs, whether or not any model is open, and
// names `block(model)`. While a cell the node layer had already filled was honoured,
// what a dictionary said about its own entries depended on which models the user
// happened to have opened: an entry used by three blocks in two models read
// `GainA, LimitA` — no model, one of the two models missing entirely — when only one
// model had been resolved, and merely CLICKING a Usage link registered the model it
// pointed at, degrading the cell it was clicked from for the rest of the session.
//
// This has to be an integration test. The overwrite rule itself is pinned in vitest
// (test/usageCells.test.ts, test/usageEndToEnd.test.ts), but the two functions that
// WIRE it to the editors — annotateDataRows and annotateModelRows in usageGraph.ts —
// import `vscode` and are excluded from that suite, so nothing measured them.
// Everything below goes through them.
//
// Both halves of the state under test are real here:
//   - the SESSION is populated by `getModelFromBytes`, the same call
//     BinaryEditorProvider makes when a model editor resolves. This bundled test file
//     links its OWN copy of the src modules (esbuild bundles each suite file
//     separately), so its DataModel is a separate instance from the running
//     extension's — which is what makes "plantB was never registered" a fact rather
//     than a hope, and any mention of GainB provably the graph's answer.
//   - the ROWS are built the way SlddTextEditorProvider builds them (parse the
//     TextDocument, buildRows, annotate) and the way BinaryEditorProvider builds a
//     model's (parse the bytes, buildRows, annotate).
//
// Fixtures: test-integration/fixtures/make-usageorder.mjs. sharedParams.sldd holds
// SharedGain (used by GainA + LimitA in ctrlA.slx and GainB in plantB.slx) and
// UnusedVar (used nowhere). Regenerate with
// `node test-integration/fixtures/make-usageorder.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  annotateDataRows,
  annotateModelRows,
  blocksUsingVariable,
  ensureUsageGraph,
  invalidateUsageGraph,
} from '../../src/host/usageGraph';
import { getModel, getModelFromBytes, invalidate } from '../../src/host/SlddModel';
import { buildRows } from '../../src/host/rowBuilder';
import { toArrayBuffer } from '../../src/common/bytes';

const BINARY_VIEW = 'dataExplorer.binaryView';
const TABLE_VIEW = 'dataExplorer.tableView';

const DICT = 'sharedParams.sldd';

// The fixtures live in test-integration/fixtures/usageorder, one level up from the
// workspace folder, so findFiles never returns them and they cannot perturb the
// tree/index assertions in sectionsTree.test.ts and nameIndex.test.ts. Open tabs are
// what feeds them into the graph.
function fixtureUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'usageorder', name);
}

async function bytesOf(name: string): Promise<ArrayBuffer> {
  return toArrayBuffer(await vscode.workspace.fs.readFile(fixtureUri(name)));
}

// Same rebuild-and-retry shape as caseRefUsage.test.ts, and for the same reason:
// this file's usageGraph instance is not the one the extension's
// onDidChangeTabs→invalidate wiring clears, so we invalidate ourselves, which is
// exactly what re-runs buildGraph against the live open-tab set. The retry absorbs
// the lag between `openWith` resolving and the tab appearing in tabGroups.
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

// Open the dictionary straight into the editable table view rather than the default
// binaryView, which would REDIRECT an editable JSON .sldd (dispose this tab, reopen
// in tableView) — a window during which the tab is briefly absent from tabGroups, so
// a rebuild could observe a half-populated set.
async function openAllFixtures(): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', fixtureUri(DICT), TABLE_VIEW);
  for (const name of ['ctrlA.slx', 'plantB.slx']) {
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri(name), BINARY_VIEW);
  }
}

// Populate the session with ONE of the two models — the state the bug needed. This is
// the call BinaryEditorProvider makes when a model editor resolves; plantB is never
// passed to it, in this file or anywhere in this bundle.
async function registerCtrlAInSession(): Promise<void> {
  const uri = fixtureUri('ctrlA.slx');
  getModelFromBytes(uri.toString(), 'ctrlA.slx', await bytesOf('ctrlA.slx'));
}

// The dictionary's rows exactly as SlddTextEditorProvider builds them, before the
// Usage column is filled: re-parse the document, then build.
async function dictionaryRows(): Promise<any[]> {
  const uri = fixtureUri(DICT);
  const doc = await vscode.workspace.openTextDocument(uri);
  invalidate(uri.toString());
  return buildRows(getModel(uri.toString(), DICT, doc.getText()));
}

const rowNamed = (rows: any[], name: string): any => rows.find((r) => r.Name?.label === name);

suite('Usage does not depend on tab history', () => {
  const dictUri = () => fixtureUri(DICT).toString();
  const ctrlUri = () => fixtureUri('ctrlA.slx').toString();
  const plantUri = () => fixtureUri('plantB.slx').toString();

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    invalidateUsageGraph();
  });

  test('the fixtures are outside the workspace, so findFiles never returns them', async () => {
    // The premise: the graph sees these files ONLY because they are open in tabs,
    // which is what makes the set under test exact.
    const found = await vscode.workspace.findFiles('**/*.{slx,sldd}');
    for (const name of [DICT, 'ctrlA.slx', 'plantB.slx']) {
      const uri = fixtureUri(name);
      await vscode.workspace.fs.stat(uri); // the fixture must exist
      assert.ok(!found.some((u) => u.toString() === uri.toString()), `${name} must not be discoverable via findFiles`);
    }
  });

  test('the session alone answers with fewer blocks and no model at all', async () => {
    // What the node layer hands over, and why it cannot be the answer: the session
    // holds ctrlA, so it can speak for GainA/LimitA and knows nothing of GainB, and
    // its shape names no model — the qualifier that makes a block reference
    // identifiable when models share a dictionary.
    await registerCtrlAInSession();
    const before = rowNamed(await dictionaryRows(), 'SharedGain').UsedBy;
    assert.ok(before && !('blockLinks' in before), 'the cell is the node layer’s shape, not the graph’s');
    const named: string[] = Array.isArray(before.links) ? before.links.map((l: any) => l.text) : [];
    assert.ok(!named.includes('GainB'), 'the session cannot know a model it never registered');
    assert.ok(named.length < 3, `the session accounts for ${named.length} of 3 usages`);
    for (const name of named) {
      assert.ok(!name.includes('('), `${name} carries no model qualifier`);
    }
  });

  test('annotateDataRows replaces it with every usage, each named with its model', async () => {
    // The regression. `annotateDataRows` used to skip a row that already had a
    // `UsedBy`, so this cell stayed the session's for the life of the window.
    await openAllFixtures();
    await registerCtrlAInSession();
    // Warm the graph against the now-open tabs first, so the assertions below cannot
    // fail merely because the tab set was still settling.
    const edges = await pollRebuilt(async () => {
      const u = await blocksUsingVariable(dictUri(), 'SharedGain');
      return u.length === 3 ? u : null;
    });
    assert.ok(edges, 'the graph resolves all three usages from the open tabs');

    const rows = await dictionaryRows();
    assert.strictEqual(await annotateDataRows(dictUri(), rows), true, 'the row changed');
    const cell = rowNamed(rows, 'SharedGain').UsedBy;
    assert.ok(!('links' in cell), 'the session’s shape is gone, not merged into');
    assert.deepStrictEqual(
      cell.blockLinks,
      [
        {
          blockName: 'GainA',
          modelName: 'ctrlA',
          modelUri: ctrlUri(),
          linkTarget: `blocks:GainA@${ctrlUri()}`,
        },
        {
          blockName: 'LimitA',
          modelName: 'ctrlA',
          modelUri: ctrlUri(),
          linkTarget: `blocks:LimitA@${ctrlUri()}`,
        },
        // The load-bearing one: plantB is not in this bundle's session, so no engine
        // but the workspace graph could have produced it.
        {
          blockName: 'GainB',
          modelName: 'plantB',
          modelUri: plantUri(),
          linkTarget: `blocks:GainB@${plantUri()}`,
        },
      ],
      'every usage, each qualified by the model it lives in',
    );
  });

  test('an entry nothing uses keeps whatever the node layer left, rather than being emptied', async () => {
    // UnusedVar gets no answer from either engine. Overwriting it with an empty cell
    // would turn "nothing here says so" into the emphatic "unused" that neither
    // engine is entitled to claim.
    await openAllFixtures();
    await registerCtrlAInSession();
    await pollRebuilt(async () => {
      const u = await blocksUsingVariable(dictUri(), 'SharedGain');
      return u.length === 3 ? u : null;
    });
    const rows = await dictionaryRows();
    const before = rowNamed(rows, 'UnusedVar').UsedBy;
    await annotateDataRows(dictUri(), rows);
    assert.deepStrictEqual(rowNamed(rows, 'UnusedVar').UsedBy, before, 'left exactly as it was');
  });

  test('annotateModelRows upgrades a block row’s link from a ref NAME to the resolved file', async () => {
    // The other direction through the same wiring, and a link that is not merely
    // less informative but unusable: the node layer targets `SharedGain@<the ref
    // string the model recorded>`, which resolves to no file. Only the graph knows
    // which dictionary on disk that ref reached.
    await openAllFixtures();
    const modelRows = buildRows(getModelFromBytes(ctrlUri(), 'ctrlA.slx', await bytesOf('ctrlA.slx')));
    const before = rowNamed(modelRows, 'GainA').UsedBy;
    assert.ok(before.linkTarget && !before.linkTarget.includes('file:'), 'the node layer targets a bare ref name');

    await pollRebuilt(async () => {
      const u = await blocksUsingVariable(dictUri(), 'SharedGain');
      return u.length === 3 ? u : null;
    });
    assert.strictEqual(await annotateModelRows(ctrlUri(), modelRows), true, 'the block rows changed');
    assert.deepStrictEqual(rowNamed(modelRows, 'GainA').UsedBy.paramLinks, [
      {
        property: 'Gain',
        paramName: 'SharedGain',
        source: DICT,
        linkTarget: `SharedGain@${dictUri()}`,
      },
    ]);
  });

  test('with nothing open the graph has no answer, and no row is touched', async () => {
    // The control for all of the above: the edges came from the open-tab union, not
    // from something else in the workspace defining these names. And with no answer,
    // the annotation must be a no-op — the rule that keeps a dictionary opened alone
    // showing whatever the session does know.
    await registerCtrlAInSession();
    invalidateUsageGraph();
    await ensureUsageGraph();
    assert.strictEqual((await blocksUsingVariable(dictUri(), 'SharedGain')).length, 0);
    const rows = await dictionaryRows();
    const before = rowNamed(rows, 'SharedGain').UsedBy;
    assert.strictEqual(await annotateDataRows(dictUri(), rows), false, 'nothing to change, so nothing repaints');
    assert.strictEqual(rowNamed(rows, 'SharedGain').UsedBy, before);
  });
});
