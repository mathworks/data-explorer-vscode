// Copyright 2026 The MathWorks, Inc.
// What a JSON .sldd's table must NOT do when nothing changed.
//
// VS Code fires onDidChangeTextDocument TWICE for one edit to a document that becomes
// dirty: once carrying the content change, and once with an EMPTY contentChanges array for
// the dirty-state flip itself. The entry-scoped repaint refuses anything that is not exactly
// one change (a batch's offsets are stated against the text before the batch, so they locate
// nothing in the text after it), so that second event fell through to the wide repaint —
// re-parse the whole document, rebuild every row, postMessage the lot — for a change that
// did not happen.
//
// Measured on a 47.8 MB customer dictionary (128,115 rows): the real change beside it cost
// ~180 ms and this phantom one ~1.6 s, after EVERY edit, undo, redo and save. It showed up as
// "undo is very slow": the edit painted in a millisecond and then the host vanished for a
// second and a half, so the next thing the user did queued behind it and paid it again.
//
// This needs the real host: nothing in the pure suites can produce a change event that
// carries no changes, because only VS Code fires one.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}

function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return vscode.Uri.joinPath(ws.uri, name);
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A stand-in panel, because a real webview cannot be asked what it was told.
 *
 * The provider talks to its view through postMessage alone, so collecting those messages is
 * how a test sees a repaint at all — and the difference between the two repaints is which
 * message they send: `setRows` rebuilds the whole table, `updateEntryRows` splices one entry.
 */
function fakePanel(): {
  panel: vscode.WebviewPanel;
  posts: any[];
  send: (msg: any) => void;
} {
  const posts: any[] = [];
  let onMessage: ((msg: any) => void) | null = null;
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
    onDidDispose: () => ({ dispose() {} }),
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
  };
}

/** The `{...}` span of the entries[] element whose "name" is `name`. */
function spanOf(text: string, name: string): { offset: number; length: number } {
  const idx = text.indexOf(`"name": ${JSON.stringify(name)}`);
  assert.ok(idx >= 0, `the fixture spells the entry "${name}"`);
  const start = text.lastIndexOf('{', idx);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { offset: start, length: i + 1 - start };
  }
  throw new Error(`no element span for "${name}"`);
}

suite('A JSON .sldd table repaints only for changes that happened', () => {
  test('the dirty-state event carries no changes, and costs no repaint', async () => {
    const uri = wsUri('json_dirty_event_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const doc = await vscode.workspace.openTextDocument(uri);
    const view = fakePanel();
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(
      doc,
      view.panel,
      new vscode.CancellationTokenSource().token,
    );
    // The webview asks for its rows when it loads; the provider paints nothing before that,
    // and the narrow repaint is withdrawn until a full one has succeeded.
    view.send({ type: 'ready' });
    await settle(800);
    assert.ok(
      view.posts.some((m) => m.type === 'setRows'),
      'the first paint sent the whole table',
    );
    view.posts.length = 0;

    // Watch the event stream directly, so a pass cannot come from this host simply not
    // firing the empty event.
    let empties = 0;
    let withChanges = 0;
    const watching = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== uri.toString()) return;
      if (e.contentChanges.length === 0) empties++;
      else withChanges++;
    });

    try {
      const span = spanOf(doc.getText(), 'Array');
      const record = JSON.parse(doc.getText().slice(span.offset, span.offset + span.length));
      assert.ok(Array.isArray(record.value), 'the fixture entry holds the array this edit changes');
      record.value = [...record.value.slice(0, -1), 4242];
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(doc.positionAt(span.offset), doc.positionAt(span.offset + span.length)),
        JSON.stringify(record, null, 2),
      );
      assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
      // Long enough for both events, and for a wide repaint to have finished if one ran.
      await settle(1200);
    } finally {
      watching.dispose();
    }

    assert.strictEqual(withChanges, 1, 'the edit arrived as one content change');
    assert.ok(empties >= 1, `this host fires the empty dirty-state event (saw ${empties})`);
    const kinds = view.posts.map((m) => m.type);
    assert.deepStrictEqual(
      kinds.filter((k) => k === 'updateEntryRows' || k === 'setRows'),
      ['updateEntryRows'],
      `one entry repainted, and the table never rebuilt (saw ${JSON.stringify(kinds)})`,
    );

    await vscode.workspace.fs.delete(uri);
  }).timeout(60000);
});
