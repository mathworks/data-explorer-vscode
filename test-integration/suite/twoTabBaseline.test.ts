// Copyright 2026 The MathWorks, Inc.
// What a JSON .sldd open in TWO tabs must not lose when one of them closes.
//
// A document's "Modified" baseline and its cross-document-move deleter are both keyed by
// URI — i.e. they belong to the DOCUMENT — but SlddTextEditorProvider tore both down from
// `webviewPanel.onDidDispose`, which fires per PANEL. Open one dictionary in two tabs (or
// split it), close one, and the surviving tab lost every Modified mark while the document
// stayed open and edited: with no baseline, computeModified answers "nothing is modified"
// by design. The same dispose also dropped the source deleter, so a move dragged out of
// the surviving tab could no longer delete its originals.
//
// The second panel was the other half of it: `initialized` was a local of
// resolveCustomTextEditor, so each panel believed it owed the on-open capture, and
// captureBaseline OVERWRITES by URI — so opening a second tab on an already-edited
// dictionary re-baselined to the edited text and cleared the marks in BOTH tabs.
//
// BinarySlddEditorProvider already fixed exactly this, document-scoped
// (`document.baselineCaptured`, and a teardown guarded by `document.views.size === 0`);
// this is the same rule on the text path, which never got it.
//
// This needs the real host: the bug lives in the provider's dispose closure, and the pure
// suites cannot import a module that depends on `vscode`.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { deleteFromSource } from '../../src/host/editorHub';

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
 * A stand-in panel, because a real webview cannot be asked what it was told — and,
 * unlike jsonDirtyEventRepaint's, one whose dispose can be FIRED, which is the whole
 * subject here: closing this tab is what used to wipe the other one's marks.
 */
function fakePanel(): {
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
    close: () => {
      assert.ok(onDispose, 'the provider subscribed to panel dispose');
      onDispose!();
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

/**
 * The rows of the most recent whole-table paint this view received.
 *
 * Polled, not slept on: the first paint of a session awaits the workspace usage graph,
 * which builds lazily and costs seconds over a folder of dictionaries. A fixed wait makes
 * this suite pass or fail on whether some earlier test happened to warm that graph.
 */
async function lastRows(posts: any[]): Promise<any[]> {
  for (let waited = 0; waited < 30000; waited += 100) {
    const setRows = posts.filter((m) => m?.type === 'setRows');
    if (setRows.length > 0) return setRows[setRows.length - 1].rows;
    await settle(100);
  }
  assert.fail(`no whole-table paint arrived (saw ${JSON.stringify(posts.map((m) => m?.type))})`);
}

/** The Status cell of the top-level entry row named `name`, or undefined. */
function statusOf(rows: any[], name: string): unknown {
  const row = rows.find((r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'));
  assert.ok(row, `the table has a row for "${name}"`);
  return row.Status;
}

/** A full repaint of this view, and the rows it painted. */
async function repaint(view: { posts: any[]; send: (m: any) => void }): Promise<any[]> {
  view.posts.length = 0;
  view.send({ type: 'ready' });
  return lastRows(view.posts);
}

/** Change entry `name`'s value in the open document, leaving it dirty. */
async function editEntry(doc: vscode.TextDocument, name: string): Promise<void> {
  const span = spanOf(doc.getText(), name);
  const record = JSON.parse(doc.getText().slice(span.offset, span.offset + span.length));
  assert.ok(Array.isArray(record.value), 'the fixture entry holds the array this edit changes');
  record.value = [...record.value.slice(0, -1), 4242];
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    doc.uri,
    new vscode.Range(doc.positionAt(span.offset), doc.positionAt(span.offset + span.length)),
    JSON.stringify(record, null, 2),
  );
  assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
  await settle(1200);
}

suite('A JSON .sldd open in two tabs is one document', () => {
  test('the surviving tab keeps its Modified marks when the other tab closes', async () => {
    const uri = wsUri('two_tab_baseline_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const doc = await vscode.workspace.openTextDocument(uri);
    // ONE provider instance for both panels, as the extension registers exactly one.
    const provider = new SlddTextEditorProvider(ctx());
    const token = new vscode.CancellationTokenSource().token;

    const first = fakePanel();
    await provider.resolveCustomTextEditor(doc, first.panel, token);
    assert.notStrictEqual(
      statusOf(await repaint(first), 'Array'),
      'Modified',
      'nothing is Modified against the on-open baseline',
    );

    await editEntry(doc, 'Array');
    assert.strictEqual(
      statusOf(await repaint(first), 'Array'),
      'Modified',
      'the edited entry is Modified in the tab that edited it',
    );

    // A second tab on the SAME document must not re-baseline to the edited text.
    const second = fakePanel();
    await provider.resolveCustomTextEditor(doc, second.panel, token);
    assert.strictEqual(
      statusOf(await repaint(second), 'Array'),
      'Modified',
      'the second tab shows the edit as Modified too — one document, one baseline',
    );
    assert.strictEqual(
      statusOf(await repaint(first), 'Array'),
      'Modified',
      'and opening it did not clear the first tab’s marks',
    );

    // Close the first tab. The document is still open and still edited.
    first.close();
    assert.strictEqual(
      statusOf(await repaint(second), 'Array'),
      'Modified',
      'the surviving tab still shows the edit as Modified',
    );

    second.close();
    await vscode.workspace.fs.delete(uri);
  }).timeout(60000);

  test('a move out of the surviving tab can still delete from the source', async () => {
    const uri = wsUri('two_tab_deleter_copy.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const doc = await vscode.workspace.openTextDocument(uri);
    const provider = new SlddTextEditorProvider(ctx());
    const token = new vscode.CancellationTokenSource().token;

    const first = fakePanel();
    await provider.resolveCustomTextEditor(doc, first.panel, token);
    const second = fakePanel();
    await provider.resolveCustomTextEditor(doc, second.panel, token);
    await repaint(first);
    await repaint(second);

    // Closing one tab must not unregister the DOCUMENT's deleter: the deleter is what
    // completes the source half of a cross-document move dragged out of the other tab.
    first.close();
    assert.ok(doc.getText().includes('"name": "Array1"'), 'the entry to move is there to begin with');
    await deleteFromSource(uri.toString(), ['Array1']);
    await settle(1200);
    assert.ok(
      !doc.getText().includes('"name": "Array1"'),
      'the surviving tab completed the source-delete half of the move',
    );

    second.close();
    await vscode.workspace.fs.delete(uri);
  }).timeout(60000);
});
