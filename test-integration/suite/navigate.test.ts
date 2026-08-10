// Copyright 2026 The MathWorks, Inc.
// Integration tests for handleNavigate — the host-side link-click handler shared
// by the binary and text editors (wired in extension.ts). Run inside a real VS
// Code so vscode.workspace.findFiles resolves against the fixture workspace,
// which the vitest suite cannot do (navigate.ts imports `vscode`). This covers
// the Model Reference / External Data links, whose target is a BARE filename
// (e.g. "data.sldd") with no "@source" suffix: the handler must look the file up
// by basename and open it. The pure target grammar is unit-tested in
// test/navTarget.test.ts; here we prove the end-to-end resolve-and-open.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { handleNavigate } from '../../src/host/navigate';

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
