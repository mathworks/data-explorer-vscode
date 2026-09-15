// Copyright 2026 The MathWorks, Inc.
// What a Usage answer is allowed to have READ — the scoping rule, over a real folder.
//
// One graph used to be built for the whole window over every supported file in the
// workspace, and `summarizeFiles` runs a full `parseModel` on every model it is given,
// reachable or not. Opening a 27 KB dictionary beside one 13.8 MB model therefore cost
// 654 ms, and nothing survived the next invalidation, so every further tab cost it again.
//
// There is now one graph per file being VIEWED, built over only the files that can change
// that file's answers: the models whose reference chain reaches it, plus those models'
// chains. The arithmetic is unit-tested (test/usageScope.test.ts) and the claim that makes
// it safe — a scoped answer equals the whole-folder answer, for every file in a corpus of
// real fixture bytes — is pinned in test/usageScopeEquality.test.ts.
//
// What neither can reach is this: whether the scope survives the trip through the real
// `findFiles` + open-tab candidate set. So this asserts it against two graphs built in the
// SAME window from the SAME files, and it reads them directly rather than through the query
// wrappers, because the question is not what a file resolves to — it is which files went
// into the graph at all.
//
// This is the end-to-end statement, not the read count: what a build READS is pinned where
// it can be counted, by injecting the reader (test/usageScopeEquality.test.ts, "what a
// scoped build actually reads"). Here the observable is that a model which cannot reach the
// opened file is absent from that file's graph — which is what the whole-window graph could
// never say, because it held every model in the folder.
//
// Fixtures: test-integration/fixtures/usageorder (see usageOrder.test.ts). ctrlA.slx links
// sharedParams.sldd and has blocks; the workspace's own data.sldd is linked by nothing.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ensureUsageGraph, invalidateUsageGraph } from '../../src/host/usageGraph';
import type { UsageGraph } from '../../src/host/usageCells';

const BINARY_VIEW = 'dataExplorer.binaryView';
const TABLE_VIEW = 'dataExplorer.tableView';

// GainA's key is its SID; the fixture numbers ctrlA's blocks from 1 (GainA, LimitA).
const GAIN_A = '1';

function ws(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'a workspace folder must be open');
  return folder.uri;
}

// The models live OUTSIDE the workspace folder, so `findFiles` never returns them and open
// tabs are what feeds them in — the same arrangement usageOrder.test.ts relies on.
const fixture = (name: string): string => vscode.Uri.joinPath(ws(), '..', 'usageorder', name).toString();
const workspaceFile = (name: string): string => vscode.Uri.joinPath(ws(), name).toString();

async function openAllFixtures(): Promise<void> {
  // The dictionary goes straight to the table view: the default binaryView would REDIRECT
  // an editable JSON .sldd (dispose, reopen), a window during which its tab is absent from
  // tabGroups and a rebuild could observe a half-populated set.
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(fixture('sharedParams.sldd')), TABLE_VIEW);
  for (const name of ['ctrlA.slx', 'plantB.slx']) {
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(fixture(name)), BINARY_VIEW);
  }
}

suite('a Usage graph reads only what can change its own file’s answers', () => {
  const dict = () => fixture('sharedParams.sldd');
  const ctrl = () => fixture('ctrlA.slx');
  const unrelated = () => workspaceFile('data.sldd');

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    invalidateUsageGraph();
  });

  test('the graph for an unrelated dictionary leaves the model out; the dictionary it links keeps it', async () => {
    await openAllFixtures();

    // Both graphs from one tab state, retried until the tabs have settled — this file
    // links its OWN copy of usageGraph (esbuild bundles each suite file separately), so
    // the extension's onDidChangeTabs wiring never clears THIS cache and invalidating
    // here is what re-runs the build against the live tab set.
    let built: { forUnrelated: UsageGraph; forDict: UsageGraph } | null = null;
    const start = Date.now();
    while (Date.now() - start < 10000) {
      invalidateUsageGraph();
      const forUnrelated = await ensureUsageGraph(unrelated());
      const forDict = await ensureUsageGraph(dict());
      if (forDict.blocksUsing(dict(), 'SharedGain').length === 3) {
        built = { forUnrelated, forDict };
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(built, 'the dictionary’s own graph resolves all three usages from the open tabs');

    // The control first, so the emptiness below cannot be a missing tab or a stale fixture:
    // when the model IS in scope, this graph answers for it.
    assert.ok(
      built!.forDict.paramLinks(ctrl(), GAIN_A).length > 0,
      'the dictionary’s graph holds ctrlA — it is a model that reaches it',
    );

    // The saving. data.sldd is linked by nothing in this window, so nothing about ctrlA can
    // change its answers and ctrlA is not in its graph. Before scoping this same query
    // answered, because there was one graph for the window and every model in it was parsed.
    assert.deepStrictEqual(
      built!.forUnrelated.paramLinks(ctrl(), GAIN_A),
      [],
      'the unrelated file’s graph was not built over ctrlA',
    );
    assert.deepStrictEqual(
      built!.forUnrelated.blocksUsing(dict(), 'SharedGain'),
      [],
      'nor the dictionary those models reach',
    );
  }).timeout(60000);
});
