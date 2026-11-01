// Copyright 2026 The MathWorks, Inc.
// The fixtures of the Usage column's independence from TAB HISTORY.
//
// Two engines can fill that cell: core's `_usedByCell`, from the models resolved in this
// window, and the workspace usage graph, from the files on disk plus the open tabs. The
// rule that the graph's answer replaces the session's, whichever models happen to be
// open, is view's: its jsonEngine/usage.test.ts runs annotateDataRows over these fixtures
// ("Usage does not depend on tab history"), and its goldens/usage.test.ts pins ctrlA.slx's
// resolved param links. usageGraph.ts's annotateDataRows and annotateModelRows hand both
// straight to view's UsageGraphs; the open-tab union they read is singleFileUsage.test.ts.
//
// Fixtures: test-integration/fixtures/make-usageorder.mjs. sharedParams.sldd holds
// SharedGain (used by GainA + LimitA in ctrlA.slx and GainB in plantB.slx) and
// UnusedVar (used nowhere). Regenerate with
// `node test-integration/fixtures/make-usageorder.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';

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

suite('Usage does not depend on tab history', () => {
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
});
