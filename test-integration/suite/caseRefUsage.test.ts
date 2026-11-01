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
// That keying is core's (`buildUsageIndex`, reached through view's usageCells.ts), and so is
// every answer over these fixtures: core's usageIndex and usageScope tests prove the
// case-insensitive keys and classification, and view's goldens/usage.test.ts pins this
// fixture set's param links and reverse edges, block by block. What stays here is this side
// of the call: the fixtures reach the graph only through open tabs (the open-tab union, whose
// positive case is singleFileUsage.test.ts), so with no tab open nothing resolves.
// Regenerate the fixtures with `node test-integration/fixtures/make-caserefs.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { invalidateUsageGraph, paramLinksForBlock } from '../../src/host/usageGraph';

// The graph is asked for a block by its KEY, which is its SID — the fixture numbers its
// four blocks 1..4 in the order below. A name identifies a block only within one system,
// so it is not the key (see test/blockSidIdentity.test.ts).
const SID = { Gain1: '1', Gain2: '2', Gain3: '3', Const1: '4' } as const;

// The fixtures live in test-integration/fixtures/caserefs, one level up from the
// workspace folder, so findFiles never returns them and they cannot perturb the
// tree/index assertions in sectionsTree.test.ts and nameIndex.test.ts. Open tabs
// are what feeds them into the graph.
function caseRefUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'caserefs', name);
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

  test('with no tabs open, none of it resolves', async () => {
    // The fixtures are outside the workspace, so with no tab open the graph never sees them:
    // no other file in the workspace defines these names.
    invalidateUsageGraph();
    for (const [block, sid] of Object.entries(SID)) {
      assert.strictEqual(
        (await paramLinksForBlock(modelUri(), sid)).length,
        0,
        `${block} has no links with nothing open`,
      );
    }
  });
});
