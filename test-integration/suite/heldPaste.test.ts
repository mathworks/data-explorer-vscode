// Copyright 2026 The MathWorks, Inc.
// Two pastes that arrive before the first has written, on a JSON .sldd.
//
// A held-down Cmd+V auto-repeats, and every repeat is its own `paste` message. The JSON view's
// structural edits each read the document, paint, then await a WorkspaceEdit, so a second one
// that started inside the first's await read the text from before the first's write: it
// computed its insertion where the first had already inserted, and spent the first's
// paintedWrite. The adds of the gallery's pinned tiles were queued for exactly that reason; a
// paste, a drop, a delete and an Add Child are now queued with them (queueStructural).
//
// Two messages sent back to back, with no await between them, are that gesture. A COPY pasted
// twice must land twice, as two distinctly named entries in a file that still parses. A CUT
// pasted twice must move once: the second paste finds the clipboard the first one emptied.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { getSectionMetadata } from 'data-explorer-core';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { registers } from '../../src/host/windowRegisters';
import { chunkOf, ctx, entryNames, fakePanel, isEntryRow, nameOf, quiet, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ENTRY = 'gravity';
// A plain MATLAB variable, which Other Data takes, so a cut of it from Design Data is a real move.
const VARIABLE = 'scalarD';
const OTHER_NAMESPACE = getSectionMetadata('other').namespace;

const errorsIn = (posts: any[]): string[] => posts.filter((m) => m.type === 'error').map((m) => String(m.message));

async function withTab(
  copyName: string,
  run: (tab: { doc: vscode.TextDocument; view: ReturnType<typeof fakePanel>; rows: any[] }) => Promise<void>,
): Promise<void> {
  const uri = wsUri(copyName);
  await vscode.workspace.fs.copy(wsUri('params.sldd'), uri, { overwrite: true });
  const view = fakePanel();
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
    await run({ doc, view, rows: view.posts.filter((m) => m.type === 'setRows').pop().rows });
  } finally {
    view.close();
    registers.clearClipboard();
    await vscode.workspace.fs.delete(uri);
  }
}

const rowOf = (rows: any[], name: string): any => {
  const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
  assert.ok(row, `params.sldd has an entry named ${name}`);
  return row;
};

suite('Two pastes sent before the first has written, on a JSON .sldd', () => {
  test('a copy pasted twice lands twice, under two names, in a file that still parses', async () => {
    await withTab('held_paste_copy.sldd', async ({ doc, view, rows }) => {
      const source = rowOf(rows, ENTRY);
      view.send({ type: 'copy', rowIds: [source.ID] });
      const before = entryNames(doc.getText());
      view.posts.length = 0;
      view.send({ type: 'paste', rowId: source.ID });
      view.send({ type: 'paste', rowId: source.ID });
      await waitFor('both pastes to land', () => {
        try {
          return entryNames(doc.getText()).length >= before.length + 2 || errorsIn(view.posts).length > 0;
        } catch {
          return false; // mid-write text that does not parse yet
        }
      });
      await quiet(150, 'a late error or a third write');
      assert.deepStrictEqual(errorsIn(view.posts), [], 'neither paste failed');
      chunkOf(doc.getText()); // still a dictionary
      const added = entryNames(doc.getText()).filter((n) => !before.includes(n));
      assert.deepStrictEqual(added.sort(), [`${ENTRY}1`, `${ENTRY}2`], 'two copies, each its own name');
    });
  }).timeout(60000);

  test('a cut pasted twice moves once, and the second paste says the clipboard is empty', async () => {
    await withTab('held_paste_cut.sldd', async ({ doc, view, rows }) => {
      const source = rowOf(rows, VARIABLE);
      const before = entryNames(doc.getText());
      // Into Other Data, so the move is real rather than the same-section no-op.
      view.send({ type: 'cut', rowIds: [source.ID] });
      view.posts.length = 0;
      const version = doc.version;
      view.send({ type: 'paste', rowId: 'section:other' });
      view.send({ type: 'paste', rowId: 'section:other' });
      await waitFor('the move and the second answer', () => doc.version > version && errorsIn(view.posts).length > 0);
      await quiet(150, 'a second write');
      assert.deepStrictEqual(errorsIn(view.posts), ['Nothing to paste — the clipboard is empty.']);
      assert.deepStrictEqual(entryNames(doc.getText()).sort(), [...before].sort(), 'the same entries, none duplicated');
      const moved = (chunkOf(doc.getText()).entries as any[]).filter((e) => e.name === VARIABLE);
      assert.strictEqual(moved.length, 1, `one ${VARIABLE}`);
      assert.strictEqual(moved[0].metadata?.namespace, OTHER_NAMESPACE, 'and it is in Other Data');
    });
  }).timeout(60000);
});
