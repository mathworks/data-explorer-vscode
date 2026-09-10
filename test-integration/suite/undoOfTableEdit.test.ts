// Copyright 2026 The MathWorks, Inc.
// Undoing an edit the TABLE made: the last leg of the round trip.
//
// A cell edit is painted from the model before a byte is written (applyEdit), and the change
// event it fires is recognised as its own echo (planOwnEdit). Cmd+Z on that same edit was the
// case still arriving as a stranger: VS Code reports it as "these bytes replaced those", so the
// host pulled the whole document out as a string (35 ms on a 47.8 MB dictionary) and walked it
// structurally (138 ms) to find an element it had written itself minutes earlier.
//
// So the host now keeps the pair it wrote — the replacement and what it replaced — and matches
// either direction of it byte for byte (planKnownChange). What this suite pins is the BEHAVIOUR
// at the end of that: the undo repaints that one entry, with the value the file had before the
// edit, and never rebuilds the table. That it needs no scan to do it is pinned where it can be:
// planKnownChange is handed no document text at all, in test/jsonEntryScopedSync.test.ts.
//
// The undo itself is applied as an inverse WorkspaceEdit, computed against the CURRENT text,
// because the `undo` command does not take effect in this test host (see cutPasteUndo.test.ts).
// The event it produces is the event a real undo produces: same offset, a range as long as what
// the host wrote, and the replaced bytes coming back.
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

function fakePanel(): { panel: vscode.WebviewPanel; posts: any[]; send: (msg: any) => void } {
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
  assert.ok(idx >= 0, `the document spells the entry "${name}"`);
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

suite('A JSON .sldd table paints the undo of its own edit', () => {
  test('one entry repainted, back to the value the file had, table never rebuilt', async () => {
    const uri = wsUri('json_undo_own_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const view = fakePanel();
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(
        doc,
        view.panel,
        new vscode.CancellationTokenSource().token,
      );
      view.send({ type: 'ready' });
      await settle(800);
      const opened = view.posts.filter((m) => m.type === 'setRows').pop();
      assert.ok(opened, 'the first paint sent the whole table');

      // The entry "Number" holds a scalar 1 — one editable cell, and one element in the text.
      const row = opened.rows.find((r: any) => String(r.ID).endsWith('/Number'));
      assert.ok(row, `the table has a row for the entry Number (${opened.rows.length} rows)`);
      assert.strictEqual(row.Value, '1', 'and it opens on the value the file spells');

      const before = doc.getText();
      const span = spanOf(before, 'Number');
      const original = before.slice(span.offset, span.offset + span.length);

      // A cell edit, exactly as the table sends it.
      view.send({ type: 'edit', rowId: row.ID, columnId: 'Value', oldValue: '1', newValue: '77' });
      await settle(1500);
      const after = doc.getText();
      assert.notStrictEqual(after, before, 'the edit reached the document');
      const written = spanOf(after, 'Number');
      assert.strictEqual(written.offset, span.offset, 'only that entry’s own span changed');

      // Now the undo: the bytes the host wrote over, written back over what it wrote.
      view.posts.length = 0;
      const undo = new vscode.WorkspaceEdit();
      undo.replace(
        uri,
        new vscode.Range(
          doc.positionAt(written.offset),
          doc.positionAt(written.offset + written.length),
        ),
        original,
      );
      assert.ok(await vscode.workspace.applyEdit(undo), 'the undo applied');
      await settle(1500);

      assert.strictEqual(doc.getText(), before, 'the document is back to what it was');
      assert.ok(
        !view.posts.some((m) => m.type === 'setRows'),
        `the table was never rebuilt (saw ${JSON.stringify(view.posts.map((m) => m.type))})`,
      );
      const painted = view.posts.filter((m) => m.type === 'updateEntryRows');
      assert.ok(painted.length >= 1, 'the entry was repainted');
      const undone = painted[painted.length - 1];
      assert.strictEqual(undone.entryRowId, row.ID, 'over the run the table holds it under');
      const back = undone.rows.find((r: any) => r.ID === row.ID);
      assert.ok(back, 'the repaint carries the entry’s own row');
      assert.strictEqual(back.Value, '1', 'showing the value the undo brought back');
      assert.notStrictEqual(back.Status, 'Modified', 'and unmodified again, as the file is');
    } finally {
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
