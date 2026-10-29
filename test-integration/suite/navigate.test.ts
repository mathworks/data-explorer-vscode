// Copyright 2026 The MathWorks, Inc.
// Integration tests for handleNavigate — the host-side link-click handler shared
// by the binary and text editors (wired in extension.ts). Run inside a real VS
// Code so vscode.workspace.findFiles resolves against the fixture workspace,
// which the vitest suite cannot do (navigate.ts imports `vscode`). This covers
// the Model Reference / External Data links, whose target is a BARE filename
// (e.g. "data.sldd") with no "@source" suffix: the handler must look the file up
// by basename and open it. The pure target grammar is unit-tested in
// view's test/navTarget.test.ts; here we prove the end-to-end resolve-and-open.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { handleNavigate } from '../../src/host/navigate';
import { SectionsTreeProvider } from '../../src/host/SectionsTreeProvider';
import { waitFor } from './tools/hostHarness';

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

suite('handleNavigate — Model Reference / External Data links', () => {
  test('a bare filename target resolves in the workspace and opens that file', async () => {
    const opened: vscode.Uri[] = [];
    // "data.sldd" is a fixture file; the link target for External Data / Model
    // Reference rows is exactly this bare basename (no "@source").
    await handleNavigate('data.sldd', async (uri) => {
      opened.push(uri);
    });
    assert.strictEqual(opened.length, 1, 'the target file is opened exactly once');
    assert.strictEqual(
      opened[0].toString(),
      wsUri('data.sldd').toString(),
      'the resolved Uri points at the workspace file',
    );
  });

  test('a bare .slx model-reference target opens the referenced model', async () => {
    const opened: vscode.Uri[] = [];
    await handleNavigate('model.slx', async (uri) => {
      opened.push(uri);
    });
    assert.strictEqual(opened.length, 1, 'the referenced model is opened');
    assert.strictEqual(opened[0].toString(), wsUri('model.slx').toString());
  });

  test('a bare filename with no matching workspace file opens nothing', async () => {
    let called = false;
    await handleNavigate('does-not-exist.slx', async () => {
      called = true;
    });
    assert.strictEqual(called, false, 'no file is opened when nothing resolves');
  });

  test('a Usage-link target (name@source) is not treated as a bare file', async () => {
    // "Kp@data.sldd" carries an '@', so the file-target fast path must decline it
    // and the Usage-link path handles it: it resolves the SOURCE (data.sldd) and
    // opens that, not a file literally named "Kp@data.sldd".
    const opened: vscode.Uri[] = [];
    await handleNavigate('Kp@data.sldd', async (uri) => {
      opened.push(uri);
    });
    assert.strictEqual(opened.length, 1, 'the source file is opened');
    assert.strictEqual(
      opened[0].toString(),
      wsUri('data.sldd').toString(),
      'the Usage-link resolves its @source, not the whole target string',
    );
  });
});

// The same bare name in two folders. Simulink records a Model Reference or an External Data
// file by name only, so "params.sldd" from a model in navscope/b means the params.sldd beside
// it — the one the tree shows under that model — and not whichever of the workspace's copies
// the file search happens to list first. The lookup handed in is the real tree provider's,
// the one extension.ts wires, so the answer is the tree's own group-first rule.
//
// The two folders arrive for this suite only and leave again: the fixture workspace is read
// as one flat folder group by every other suite.
suite('handleNavigate — a bare name resolves in the referrer\'s own folder', () => {
  const root = () => wsUri('navscope');
  const at = (rel: string) => vscode.Uri.joinPath(root(), rel);
  const made = ['a/params.sldd', 'a/alpha.slx', 'b/params.sldd', 'b/beta.slx'];
  let tree: SectionsTreeProvider;
  const scoped = (ref: string, referrer: string) => tree.resolveReference(ref, referrer);

  suiteSetup(async () => {
    for (const rel of made) {
      const from = rel.endsWith('.slx') ? 'model.slx' : 'params.sldd';
      await vscode.workspace.fs.copy(wsUri(from), at(rel), { overwrite: true });
    }
    // findFiles runs a fresh search, but these files are milliseconds old: wait until the
    // search lists all four, so a slow search service reads as slow rather than as a wrong
    // answer. Only then build the tree whose graph is under test.
    await waitFor(
      'the search to list the navscope files',
      async () => (await vscode.workspace.findFiles('navscope/**/*')).length >= made.length,
    );
    tree = new SectionsTreeProvider(vscode.extensions.getExtension('mathworks.simulink-data-explorer')!.extensionUri);
  });

  suiteTeardown(async () => {
    await vscode.workspace.fs.delete(root(), { recursive: true, useTrash: false });
  });

  async function navigateFrom(target: string, referrer: vscode.Uri): Promise<string[]> {
    const opened: string[] = [];
    await handleNavigate(target, async (uri) => {
      opened.push(uri.toString());
    }, referrer.toString(), scoped);
    return opened;
  }

  test('a model in b opens b/params.sldd, and a model in a opens a/params.sldd', async () => {
    // Both directions, so no referrer-blind answer can pass: whichever copy a plain search
    // lists first, it is the wrong one for one of these two models.
    assert.deepStrictEqual(await navigateFrom('params.sldd', at('b/beta.slx')), [at('b/params.sldd').toString()]);
    assert.deepStrictEqual(await navigateFrom('params.sldd', at('a/alpha.slx')), [at('a/params.sldd').toString()]);
  });

  test('a Usage link\'s bare @source resolves the same way', async () => {
    assert.deepStrictEqual(await navigateFrom('Kp@params.sldd', at('b/beta.slx')), [at('b/params.sldd').toString()]);
    assert.deepStrictEqual(await navigateFrom('Kp@params.sldd', at('a/alpha.slx')), [at('a/params.sldd').toString()]);
  });

  test('a name the referrer\'s folder lacks still opens the one workspace copy', async () => {
    // model.slx exists only at the workspace root: scoping prefers, it never forbids.
    assert.deepStrictEqual(await navigateFrom('model.slx', at('b/beta.slx')), [wsUri('model.slx').toString()]);
  });
});
