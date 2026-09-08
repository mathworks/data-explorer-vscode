// Copyright 2026 The MathWorks, Inc.
// Integration test for CASE-INSENSITIVE reference matching in the usage graph.
//
// A model records a data-source link as the user typed it, not as the filesystem
// spells it, so `caseparams.sldd` in a model routinely points at `CaseParams.sldd`
// on disk. The graph therefore keys its by-basename maps — and every lookup into
// them — through refBasename (basename lower-cased), and classifies the .sldd/.mat
// external sources case-insensitively. The sections tree already resolved refs this
// way (RelGraph.byBasename), so matching case-sensitively here made the SAME
// reference resolve in the tree and silently not in the Usage column: parameters
// that are plainly used rendered as unused, with no error.
//
// That keying is core's now (`buildUsageIndex`, reached through usageCells.ts) and
// core tests it directly, so this file is no longer where the rule is pinned. What
// it still covers is everything on THIS side of the call, none of which core can
// vouch for: whether a differently-cased file reaches the graph at all (the findFiles
// glob and `isGraphPath` over open tabs), whether the path handed over is one
// core can classify, and whether the answer reaches the editors — all of which
// import `vscode` and are excluded from the vitest suite. Only the real build over
// real files exercises them.
//
// The four blocks in the fixture cover four DIFFERENT lines of buildGraph — the
// dataDictionary link, a chained dictionary reference, an external .sldd, and an
// external .mat — see test-integration/fixtures/make-caserefs.mjs for the table.
// Regenerate with `node test-integration/fixtures/make-caserefs.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  ensureUsageGraph,
  invalidateUsageGraph,
  paramLinksForBlock,
  blocksUsingVariable,
} from '../../src/host/usageGraph';

const BINARY_VIEW = 'dataExplorer.binaryView';
const TABLE_VIEW = 'dataExplorer.tableView';

// The fixtures live in test-integration/fixtures/caserefs, one level up from the
// workspace folder, so findFiles never returns them and they cannot perturb the
// tree/index assertions in sectionsTree.test.ts and nameIndex.test.ts. Open tabs
// are what feeds them into the graph.
function caseRefUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'caserefs', name);
}

// Same rebuild-and-retry shape as singleFileUsage.test.ts, and for the same
// reason: this bundled test file links its OWN copy of usageGraph (esbuild inlines
// the src module), a SEPARATE instance from the one inside the running extension,
// so the extension's onDidChangeTabs→invalidate wiring does not clear THIS
// instance's cache. Invalidating here is exactly what re-runs buildGraph against
// the live open-tab set — the code path under test. The retry also absorbs the lag
// between `openWith` resolving and the tab appearing in vscode.window.tabGroups.
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

// Open every fixture in a tab. The .sldd files go straight to the editable table
// view rather than the default binaryView, which would REDIRECT editable JSON
// .sldd (dispose this tab, reopen in tableView) — a window during which the tab is
// briefly absent from tabGroups. Opening the destination directly keeps all five
// tabs continuously present, so a rebuild can't observe a half-populated set.
async function openAllFixtures(): Promise<void> {
  for (const name of ['CaseParams.sldd', 'chained.sldd', 'ExtraDict.sldd']) {
    await vscode.commands.executeCommand('vscode.openWith', caseRefUri(name), TABLE_VIEW);
  }
  for (const name of ['CaseBp.mat', 'caseRefs.slx']) {
    await vscode.commands.executeCommand('vscode.openWith', caseRefUri(name), BINARY_VIEW);
  }
}

suite('case-insensitive reference matching (usage graph)', () => {
  const modelUri = () => caseRefUri('caseRefs.slx').toString();

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    invalidateUsageGraph();
  });

  test('the fixtures are outside the workspace, so findFiles never returns them', async () => {
    // The premise of the whole suite: the graph sees these files ONLY because they
    // are open in tabs, which is what makes the set under test exact.
    const found = await vscode.workspace.findFiles('**/*.{slx,sldd,mat}');
    for (const name of ['caseRefs.slx', 'CaseParams.sldd', 'chained.sldd', 'ExtraDict.sldd', 'CaseBp.mat']) {
      const uri = caseRefUri(name);
      await vscode.workspace.fs.stat(uri); // the fixture must exist
      assert.ok(
        !found.some((u) => u.toString() === uri.toString()),
        `${name} must not be discoverable via findFiles`,
      );
    }
  });

  test('a differently-cased dataDictionary link resolves to the dictionary on disk', async () => {
    // The model records `caseparams.sldd`; the file is `CaseParams.sldd`. Before
    // the fix, slddByBase was keyed by the on-disk basename and looked up by the
    // recorded ref, so this missed and Gain1 rendered with no source and no link —
    // indistinguishable from a genuinely unresolved parameter.
    await openAllFixtures();
    const links = await pollRebuilt(async () => {
      const l = await paramLinksForBlock(modelUri(), 'Gain1');
      return l.length > 0 ? l : null;
    });
    assert.ok(links, 'Gain1 has a resolved param link');
    assert.strictEqual(links!.length, 1);
    assert.strictEqual(links![0].property, 'Gain');
    assert.strictEqual(links![0].paramName, 'CaseVar');
    // The source label and link target come from the FILE's uri, so they carry the
    // on-disk casing even though the reference did not.
    assert.strictEqual(links![0].source, 'CaseParams.sldd');
    assert.strictEqual(links![0].linkTarget, `CaseVar@${caseRefUri('CaseParams.sldd').toString()}`);
  });

  test('a differently-cased CHAINED dictionary reference is chased', async () => {
    // CaseParams.sldd's own "Dictionary References" footer names `Chained.SLDD`
    // (both stem and extension upper-cased); the file is `chained.sldd`. This leg
    // is normalised in slddSummary, a different line from the map keys above.
    await openAllFixtures();
    const links = await pollRebuilt(async () => {
      const l = await paramLinksForBlock(modelUri(), 'Gain2');
      return l.length > 0 && l[0].linkTarget ? l : null;
    });
    assert.ok(links, 'Gain2 has a resolved param link');
    assert.strictEqual(links![0].paramName, 'ChainedVar');
    assert.strictEqual(links![0].source, 'chained.sldd');
    assert.strictEqual(links![0].linkTarget, `ChainedVar@${caseRefUri('chained.sldd').toString()}`);
  });

  test('an external .sldd link with an UPPER-CASE extension is still a dictionary', async () => {
    // The model lists `EXTRADICT.SLDD` as an external data source. The extension
    // filter used to be `e.endsWith('.sldd')`, which classified this as neither a
    // dictionary nor a MAT file, so the link was dropped entirely — a stronger
    // failure than a case-mismatched name, since the ref never reached the map.
    await openAllFixtures();
    const links = await pollRebuilt(async () => {
      const l = await paramLinksForBlock(modelUri(), 'Gain3');
      return l.length > 0 && l[0].linkTarget ? l : null;
    });
    assert.ok(links, 'Gain3 has a resolved param link');
    assert.strictEqual(links![0].paramName, 'ExtraVar');
    assert.strictEqual(links![0].source, 'ExtraDict.sldd');
    assert.strictEqual(links![0].linkTarget, `ExtraVar@${caseRefUri('ExtraDict.sldd').toString()}`);
  });

  test('an external .mat link with an UPPER-CASE extension resolves', async () => {
    // `CaseBp.MAT` -> CaseBp.mat. Covers matByBase's key plus the /\.mat$/i filter;
    // the model owns no workspace variables, so nothing can shadow the MAT hit.
    await openAllFixtures();
    const links = await pollRebuilt(async () => {
      const l = await paramLinksForBlock(modelUri(), 'Const1');
      return l.length > 0 && l[0].linkTarget ? l : null;
    });
    assert.ok(links, 'Const1 has a resolved param link');
    assert.strictEqual(links![0].paramName, 'Bp');
    assert.strictEqual(links![0].source, 'CaseBp.mat');
    assert.strictEqual(links![0].linkTarget, `Bp@${caseRefUri('CaseBp.mat').toString()}`);
  });

  test('the reverse edges are keyed on the resolved file, so the data view shows the block', async () => {
    // The other direction: opening CaseParams.sldd must show CaseVar as used by
    // Gain1. The reverse map is keyed by the WINNING source's uri, so a ref that
    // failed to resolve produced no reverse edge either — the variable looked
    // unused in the dictionary's own Usage column.
    await openAllFixtures();
    const usedBy = await pollRebuilt(async () => {
      const u = await blocksUsingVariable(caseRefUri('CaseParams.sldd').toString(), 'CaseVar');
      return u.length > 0 ? u : null;
    });
    assert.ok(usedBy, 'CaseVar has a reverse edge');
    assert.strictEqual(usedBy!.length, 1);
    assert.strictEqual(usedBy![0].blockName, 'Gain1');
    assert.strictEqual(usedBy![0].modelName, 'caseRefs');
    assert.strictEqual(usedBy![0].modelUri, modelUri());

    // And through the chain, whose reverse edge is keyed on the chained file.
    const chained = await blocksUsingVariable(caseRefUri('chained.sldd').toString(), 'ChainedVar');
    assert.strictEqual(chained.length, 1, 'ChainedVar is used by exactly one block');
    assert.strictEqual(chained[0].blockName, 'Gain2');
  });

  test('with no tabs open, none of it resolves', async () => {
    // The control: the edges above exist because of the open-tab union, not because
    // something else in the workspace happens to define these names.
    invalidateUsageGraph();
    await ensureUsageGraph();
    for (const block of ['Gain1', 'Gain2', 'Gain3', 'Const1']) {
      assert.strictEqual(
        (await paramLinksForBlock(modelUri(), block)).length,
        0,
        `${block} has no links with nothing open`,
      );
    }
  });
});
