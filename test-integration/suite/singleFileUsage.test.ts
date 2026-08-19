// Copyright 2026 The MathWorks, Inc.
// Integration test for single-file (Cmd+O, no workspace folder) Usage resolution.
//
// The usage graph normally sources its files from vscode.workspace.findFiles,
// which returns nothing outside an open workspace folder — so a lone model opened
// via Cmd+O used to show an empty Usage column even though its blocks reference
// its OWN model-workspace variables (an intra-model, fully self-contained
// relationship). The fix unions the open editor tabs into the graph.
//
// We prove that here with selfContained.slx, a fixture deliberately placed OUTSIDE
// the integration workspace folder (in ../standalone) so findFiles never returns
// it. Only opening it in a tab can feed it into the graph. Its blocks Gain1/Const1
// reference the model-workspace vars Bp/Numeric. Regenerate the fixture with
// `node test-integration/fixtures/make-standalone.mjs`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  ensureUsageGraph,
  invalidateUsageGraph,
  paramLinksForBlock,
  blocksUsingVariable,
} from '../../src/host/usageGraph';

const BINARY_VIEW = 'dataExplorer.binaryView';

// selfContained.slx sits one level up from the workspace folder, in
// test-integration/fixtures/standalone — outside the workspace so findFiles skips it.
function standaloneUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, '..', 'standalone', 'selfContained.slx');
}

// Rebuild the graph, then evaluate `fn`; retry until truthy or timeout. This
// bundled test file links its OWN copy of usageGraph (esbuild inlines the src
// module), a SEPARATE instance from the one inside the running extension — so the
// extension's onDidChangeTabs→invalidate wiring does not clear THIS instance's
// cache. We therefore invalidate before each rebuild ourselves, which is exactly
// what re-runs buildGraph against the live open-tab set (the code path under test).
// The retry also absorbs any lag between `openWith` resolving and the tab
// appearing in vscode.window.tabGroups.
async function pollRebuilt<T>(fn: () => Promise<T>, timeoutMs = 5000): Promise<T> {
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

suite('single-file Usage (open-tab union)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('the fixture is outside the workspace, so findFiles never returns it', async () => {
    const uri = standaloneUri();
    await vscode.workspace.fs.stat(uri); // the fixture must exist
    const found = await vscode.workspace.findFiles('**/*.slx');
    assert.ok(
      !found.some((u) => u.toString() === uri.toString()),
      'selfContained.slx must not be discoverable via findFiles (it lives outside the workspace folder)',
    );
  });

  test('with no tab open, the standalone model contributes no usage edges', async () => {
    const uri = standaloneUri();
    // Rebuild the graph with nothing open: it should know nothing about a file
    // that is neither in the workspace nor open in a tab. This is the control for
    // the next test — it isolates the open-tab union as the cause of the edges.
    invalidateUsageGraph();
    await ensureUsageGraph();
    const links = await paramLinksForBlock(uri.toString(), 'Gain1');
    assert.strictEqual(links.length, 0, 'no param links before the file is opened');
    const blocks = await blocksUsingVariable(uri.toString(), 'Bp');
    assert.strictEqual(blocks.length, 0, 'no reverse edges before the file is opened');
  });

  test('opening the model in a tab resolves its intra-model Usage', async () => {
    const uri = standaloneUri();
    await vscode.commands.executeCommand('vscode.openWith', uri, BINARY_VIEW);

    // Forward edge (block-view Usage cell): Gain1's `Gain` param resolves to the
    // model-workspace variable Bp. Rebuild the graph so it unions in the now-open
    // tab, then read the edge.
    const links = await pollRebuilt(async () => {
      const l = await paramLinksForBlock(uri.toString(), 'Gain1');
      return l.length > 0 ? l : null;
    });
    assert.ok(links && links.length === 1, 'Gain1 has exactly one resolved param link');
    assert.strictEqual(links![0].property, 'Gain');
    assert.strictEqual(links![0].paramName, 'Bp');
    assert.strictEqual(
      links![0].source,
      'Model Workspace',
      'Bp resolves to the model workspace, not an external source',
    );
    assert.strictEqual(links![0].linkTarget, `workspace:Bp@${uri.toString()}`);

    // Reverse edge (workspace-variable-view Usage cell): Bp is used by Gain1.
    const usedBy = await blocksUsingVariable(uri.toString(), 'Bp');
    assert.strictEqual(usedBy.length, 1, 'Bp is used by exactly one block');
    assert.strictEqual(usedBy[0].blockName, 'Gain1');
    assert.strictEqual(usedBy[0].modelUri, uri.toString());

    // The second block/var pair resolves too (Const1 Value = Numeric).
    const constLinks = await paramLinksForBlock(uri.toString(), 'Const1');
    assert.strictEqual(constLinks.length, 1, 'Const1 has one resolved param link');
    assert.strictEqual(constLinks[0].paramName, 'Numeric');
    assert.strictEqual(constLinks[0].source, 'Model Workspace');
  });
});
