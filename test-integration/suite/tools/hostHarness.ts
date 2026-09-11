// Copyright 2026 The MathWorks, Inc.
// Reaching a provider's message handler from inside real VS Code, and reading what came
// back — the parts every "drive a gesture end-to-end" test needs before it can say
// anything about its own subject.
//
// This is a `tools/` module rather than a suite file on purpose: the runner's glob is
// `dist-test/suite/**/*.test.js`, so nothing here runs as a test of its own; esbuild
// bundles it into each importer.
import * as assert from 'assert';
import * as vscode from 'vscode';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Enough of an ExtensionContext for a provider to resolve its webview's asset URIs. */
export function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

export function ws(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'a workspace folder must be open');
  return folder!.uri;
}

export function wsUri(name: string): vscode.Uri {
  return vscode.Uri.joinPath(ws(), name);
}

export function token(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

export const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for the thing itself, with a generous cap, instead of sleeping for however long it
 * is expected to take.
 *
 * The JSON path is asynchronous — the host applies a WorkspaceEdit and VS Code decides when
 * that lands — and a structural gesture walks and reserializes far more of a dictionary than
 * the single-cell edits this suite's older fixed sleeps were calibrated against. A sleep is
 * the wrong shape for that twice over: too short and it fails as a confusing assertion about
 * rows rather than as a timeout, too long and every test pays for the worst case.
 */
export async function waitFor(what: string, done: () => boolean, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    assert.ok(Date.now() < deadline, `timed out after ${ms}ms waiting for ${what}`);
    await settle(20);
  }
}

/**
 * The panel a provider talks to, with the messages it sent captured and a way to send it the
 * ones the webview would. There is no route to the REGISTERED provider instance (activate()
 * returns no API), so every test builds its own provider around one of these.
 *
 * `close()` is not cosmetic. Both providers register their teardown INSIDE
 * `webviewPanel.onDidDispose` — and among the subscriptions it disposes are global ones
 * (`workspace.onDidChangeTextDocument`, `onDidSaveTextDocument`, the nav-select relay). A
 * stub that drops the callback leaks all of them for the lifetime of the test process. Each
 * leak is a no-op afterwards (every handler re-checks the document URI, which by then is
 * deleted), so it is a leak rather than a bug — but a file that opens eight views is where
 * "harmless" stops being a good enough answer.
 */
export function fakePanel(): {
  panel: vscode.WebviewPanel;
  posts: any[];
  send: (msg: any) => void;
  close: () => void;
} {
  const posts: any[] = [];
  let onMessage: ((msg: any) => void) | null = null;
  let onDispose: (() => void) | null = null;
  const panel = {
    iconPath: undefined,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (u: vscode.Uri) => u,
      postMessage: async (msg: any) => {
        posts.push(msg);
        return true;
      },
      onDidReceiveMessage: (cb: (msg: any) => void) => {
        onMessage = cb;
        return { dispose() {} };
      },
    },
    onDidDispose: (cb: () => void) => {
      onDispose = cb;
      return { dispose() {} };
    },
    onDidChangeViewState: () => ({ dispose() {} }),
    dispose() {},
  } as unknown as vscode.WebviewPanel;
  return {
    panel,
    posts,
    send: (msg: any) => {
      assert.ok(onMessage, 'the provider subscribed to webview messages');
      onMessage!(msg);
    },
    close: () => onDispose?.(),
  };
}

// --- reading a .sldd the way its own format spells it -----------------------------------

const CHUNK = '__MW_TEXT_PART__/data/chunk0';

/** The parsed `data/chunk0` content of a JSON .sldd: `entries`, `Dictionary References`. */
export function chunkOf(text: string): any {
  const doc = JSON.parse(text);
  const content = doc?.__MW_TEXT_PARTS__?.[CHUNK]?.__MW_TEXT_content;
  assert.ok(content, 'the document still spells a data/chunk0 part');
  return content;
}

export const entryNames = (text: string): string[] =>
  ((chunkOf(text).entries ?? []) as any[]).map((e) => e.name);

// --- the rows a table holds ------------------------------------------------------------

export const isHeader = (row: any): boolean => String(row.ID).startsWith('section:');
export const isEntryRow = (row: any): boolean => String(row.parent ?? '').startsWith('section:');
export const nameOf = (row: any): string => row?.Name?.label ?? String(row?.ID ?? '');
export const childrenOf = (rows: any[], parentId: string): any[] =>
  rows.filter((r) => r.parent === parentId);
export const rowNamed = (rows: any[], name: string): any => {
  const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
  assert.ok(row, `the table has an entry row for "${name}"`);
  return row;
};
