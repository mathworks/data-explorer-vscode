// Copyright 2026 The MathWorks, Inc.
// A repaint must not wait for the workspace usage graph.
//
// An undo, a redo, and a keystroke in the text view all reach the table the same way: a
// foreign single-range change event, whose entry the host locates in the text and rebuilds
// from the model. The ROWS are ready in ~180 ms on a 47.8 MB dictionary. What used to happen
// next is that they sat in the host waiting for the Usage column, which awaits a
// workspace-wide graph — and rebuilding that graph over a folder of real dictionaries costs
// 5.8 s (measured; 4 files, 98 MB). So an undo took ~7 s to appear while the rows it needed
// had been sitting in memory the whole time.
//
// The rule this pins: the rows go out in the run that built them, and the Usage column
// catches up. Which is observable as the POST COUNT — a cold graph paints twice (rows now,
// annotated rows when the graph lands) and a warm one paints once — and that is a fact about
// what the host does, not about how fast the machine it runs on is.
//
// Needs the real host: `annotateDataRowsNow` answers from a graph built out of the workspace
// and the open tabs, which only VS Code has.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { invalidateUsageGraph } from '../../src/host/usageGraph';

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

/** Replace entry "Array"'s last array element with `value`, as a foreign single-range edit. */
async function editArrayEntry(uri: vscode.Uri, value: number): Promise<void> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  assert.ok(doc, 'the document is open');
  const span = spanOf(doc!.getText(), 'Array');
  const record = JSON.parse(doc!.getText().slice(span.offset, span.offset + span.length));
  assert.ok(Array.isArray(record.value), 'the fixture entry holds the array this edit changes');
  record.value = [...record.value.slice(0, -1), value];
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc!.positionAt(span.offset), doc!.positionAt(span.offset + span.length)),
    JSON.stringify(record, null, 2),
  );
  assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
}

suite('A JSON .sldd table paints an undo from the model', () => {
  let uri: vscode.Uri;
  let view: ReturnType<typeof fakePanel>;

  setup(async () => {
    uri = wsUri('json_undo_paint_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const doc = await vscode.workspace.openTextDocument(uri);
    view = fakePanel();
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(
      doc,
      view.panel,
      new vscode.CancellationTokenSource().token,
    );
    view.send({ type: 'ready' });
    await settle(800);
    assert.ok(
      view.posts.some((m) => m.type === 'setRows'),
      'the first paint sent the whole table',
    );
  });

  teardown(async () => {
    await vscode.workspace.fs.delete(uri);
  });

  test('sends the rows without waiting for a cold usage graph', async () => {
    // The state after any workspace change: the graph is gone and the next query rebuilds it,
    // which over real dictionaries is seconds of reading and parsing.
    invalidateUsageGraph();
    view.posts.length = 0;

    await editArrayEntry(uri, 4242);
    await settle(1500);

    const painted = view.posts.filter((m) => m.type === 'updateEntryRows');
    assert.strictEqual(
      painted.length,
      2,
      'the rows went out at once and again with Usage filled in ' +
        `(saw ${JSON.stringify(view.posts.map((m) => m.type))})`,
    );
    assert.ok(
      !view.posts.some((m) => m.type === 'setRows'),
      'and the table was never rebuilt',
    );
  }).timeout(60000);

  test('sends them once when the graph is already built', async () => {
    // Warm the graph, then edit: nothing is waited for, so there is nothing to catch up on.
    await editArrayEntry(uri, 101);
    await settle(1500);
    view.posts.length = 0;

    await editArrayEntry(uri, 202);
    await settle(1500);

    assert.deepStrictEqual(
      view.posts.filter((m) => m.type === 'updateEntryRows' || m.type === 'setRows').map((m) => m.type),
      ['updateEntryRows'],
      `one paint for one change (saw ${JSON.stringify(view.posts.map((m) => m.type))})`,
    );
  }).timeout(60000);
});
