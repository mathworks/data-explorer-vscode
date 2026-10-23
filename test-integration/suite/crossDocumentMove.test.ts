// Copyright 2026 The MathWorks, Inc.
// A cut in one dictionary, pasted into another, through the real providers.
//
// A cut is LAZY: it makes no edit, and the source loses its entry only when the paste lands,
// through the source document's own deleter (editorHub). So the source tab can be closed between
// the two — and with it goes the deleter, which is registered per open document. The paste used
// to land, empty the clipboard, and say nothing, leaving the entry in both files with no hint
// that the move had only half happened. Now the paste says so, in the view it landed in, and
// the entry is still where it was: two copies the user knows about, rather than a lost one or
// a silent one.
//
// Both source formats, because each provider registers its own deleter and tears it down on its
// own close. The positive control — the same move with the source still open — is what shows the
// test can tell the two apart: the original goes, and nothing is reported.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { clearClipboard, getClipboard } from '../../src/host/clipboard';
import { ctx, entryNames, fakePanel, isEntryRow, nameOf, quiet, token, waitFor, ws, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MOVED = 'gravity';

const errorsIn = (posts: any[]): string[] => posts.filter((m) => m.type === 'error').map((m) => String(m.message));

const rowOf = (rows: any[], name: string): any => {
  const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
  assert.ok(row, `the table has an entry row for "${name}"`);
  return row;
};

/** A source tab: its rows, whether it still holds the moved entry, and how to close it. */
interface Source {
  uri: vscode.Uri;
  rows: any[];
  send: (msg: any) => void;
  /** Close the tab, once: its document-scoped teardown is what takes the deleter away. */
  close: () => void;
  holds: () => boolean;
  dispose: () => Promise<void>;
}

/** `view`'s close, made safe to call twice (the test closes early; the cleanup closes anyway). */
function closer(view: ReturnType<typeof fakePanel>): () => void {
  let closed = false;
  return () => {
    if (!closed) view.close();
    closed = true;
  };
}

async function jsonSource(copyName: string): Promise<Source> {
  const uri = wsUri(copyName);
  await vscode.workspace.fs.copy(wsUri('params.sldd'), uri, { overwrite: true });
  const doc = await vscode.workspace.openTextDocument(uri);
  const view = fakePanel();
  await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  await waitFor('the source paint', () => view.posts.some((m) => m.type === 'setRows'));
  const close = closer(view);
  return {
    uri,
    rows: view.posts.filter((m) => m.type === 'setRows').pop().rows,
    send: view.send,
    close,
    holds: () => entryNames(doc.getText()).includes(MOVED),
    dispose: async () => {
      close();
      await vscode.workspace.fs.delete(uri);
    },
  };
}

async function binarySource(copyName: string): Promise<Source> {
  const fixture = vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd');
  const uri = vscode.Uri.joinPath(ws(), '..', copyName);
  await vscode.workspace.fs.copy(fixture, uri, { overwrite: true });
  const provider = new BinarySlddEditorProvider(ctx());
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  await provider.resolveCustomEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  const close = closer(view);
  return {
    uri,
    rows: view.posts.filter((m) => m.type === 'setRows').pop().rows,
    send: view.send,
    close,
    holds: () => (doc.chunkXml as string).includes(`>${MOVED}</P>`),
    dispose: async () => {
      close();
      doc.dispose();
      await vscode.workspace.fs.delete(uri);
    },
  };
}

/**
 * Cut the entry in `source`, optionally close the source tab, then paste into a JSON copy of
 * data.sldd. Answers what the target's view was told and what the two files hold afterwards.
 */
async function cutAndPaste(
  source: Source,
  closeSourceFirst: boolean,
  targetName: string,
): Promise<{ errors: string[]; targetHas: boolean; sourceHolds: boolean }> {
  const uri = wsUri(targetName);
  await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
  const view = fakePanel();
  try {
    source.send({ type: 'cut', rowIds: [rowOf(source.rows, MOVED).ID] });
    assert.strictEqual(getClipboard()?.mode, 'cut', 'the cut is on the clipboard');
    if (closeSourceFirst) source.close();

    const doc = await vscode.workspace.openTextDocument(uri);
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the target paint', () => view.posts.some((m) => m.type === 'setRows'));
    const version = doc.version;
    view.posts.length = 0;
    view.send({ type: 'paste', rowId: 'section:design' });
    await waitFor('the paste to land or be refused', () => doc.version > version || errorsIn(view.posts).length > 0);
    // The source delete runs after the paste's write, and its report after that.
    await waitFor('the move to finish', () => getClipboard() === null);
    await quiet(150, 'a report after the move finished');
    return {
      errors: errorsIn(view.posts),
      targetHas: entryNames(doc.getText()).includes(MOVED),
      sourceHolds: source.holds(),
    };
  } finally {
    view.close();
    clearClipboard();
    await vscode.workspace.fs.delete(uri);
  }
}

for (const [format, open] of [
  ['JSON', jsonSource],
  ['compressed-binary', binarySource],
] as const) {
  suite(`A cut from a ${format} .sldd, pasted into another dictionary`, () => {
    const tag = format === 'JSON' ? 'json' : 'bin';

    test('removes the original when its tab is still open, and says nothing', async () => {
      const source = await open(`xdoc_src_open_${tag}.sldd`);
      try {
        const run = await cutAndPaste(source, false, `xdoc_dst_open_${tag}.sldd`);
        assert.deepStrictEqual(run.errors, [], 'nothing to report');
        assert.ok(run.targetHas, `${MOVED} landed in the target`);
        assert.ok(!run.sourceHolds, `and left the source`);
      } finally {
        await source.dispose();
      }
    }).timeout(60000);

    test('says the original could not be removed when its tab was closed after the cut, and loses nothing', async () => {
      const source = await open(`xdoc_src_closed_${tag}.sldd`);
      try {
        const run = await cutAndPaste(source, true, `xdoc_dst_closed_${tag}.sldd`);
        assert.deepStrictEqual(
          run.errors,
          [`Pasted here, but the original in xdoc_src_closed_${tag}.sldd could not be removed: its table is no longer open. Remove it there by hand.`],
          'the target view says what is left to do',
        );
        assert.ok(run.targetHas, `${MOVED} landed in the target`);
        assert.ok(run.sourceHolds, 'and is still in the source: two copies, neither lost');
      } finally {
        await source.dispose();
      }
    }).timeout(60000);
  });
}
