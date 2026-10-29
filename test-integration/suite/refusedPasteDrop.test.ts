// Copyright 2026 The MathWorks, Inc.
// A paste, drop or drag the host refuses leaves nothing behind: not in the model, not in the
// drag register, and not unexplained.
//
// Three refusals, each of which used to leave a trace:
//
//   1. A paste or drop into a JSON .sldd refused before it painted. prepareEntryForPaste attaches
//      each new entry to its section before serializing it, and a same-document cut has already
//      taken its sources out, so the refusal left the provider holding a tree the text never
//      said. The next paste named its copy past an entry the file never got, and an edit of the
//      cut entry could not find it.
//   2. A drag whose snapshot failed was silent, and the drop that ended it said only "Nothing to
//      drop."
//   3. A refused drop left the drag register set, so every table went on predicting a drop that
//      had already been tried.
//
// What refuses here is either a rule the host already enforces (a derived section's Constant
// rule, which a matrix cannot pass) or the throw data-explorer-core makes when it will not write
// a value, a MatWriteError. The second needs a value no fixture holds, so it is stubbed: the
// serializer is made to throw on the prototype that owns it. That reaches the providers because
// esbuild bundles core into this file together with the providers it constructs, so there is
// one copy of each class.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DataModel } from 'data-explorer-core';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { peekModel } from 'data-explorer-view/model';
import { clearClipboard } from '../../src/host/clipboard';
import { clearDrag, getDrag } from '../../src/host/dragState';
import { chunkOf, ctx, entryNames, fakePanel, isEntryRow, nameOf, quiet, token, waitFor, ws, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ENTRY = 'mat2x2';
// Its pasted copies: the uniquifier appends a number.
const COPY = /^mat2x2\d+$/;
const REFUSAL = 'Value of "mat2x2" would write 134217728 bytes no data backs';
// What a drag start says of an entry that will not serialize: before the snapshot, core is asked
// whether the entry can travel at all (copyRefusal), and answers in its own words. The stub's
// error is an Error named MatWriteError rather than core's class, so core words it as a writing
// that failed, quoting it.
const DRAG_REFUSAL = `Cannot copy "${ENTRY}": it could not be written (${REFUSAL}). Nothing was copied.`;

/**
 * Make `method` throw a MatWriteError for every node `when` picks, on the prototype in `node`'s
 * chain that owns it. Returns the undo, which every caller runs in a `finally`: the prototype is
 * shared by every test in the run.
 */
function refuse(node: any, method: string, when: (self: any) => boolean): () => void {
  let owner = node;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, method)) owner = Object.getPrototypeOf(owner);
  assert.ok(owner, `a prototype of ${node?.name} owns ${method}`);
  const original = owner[method];
  owner[method] = function (this: any, ...args: unknown[]) {
    if (when(this)) {
      const err = new Error(REFUSAL);
      err.name = 'MatWriteError';
      throw err;
    }
    return original.apply(this, args);
  };
  return () => {
    owner[method] = original;
  };
}

const errorsIn = (posts: any[]): string[] => posts.filter((m) => m.type === 'error').map((m) => String(m.message));
const entriesOf = (model: any): any[] => ((model?.children ?? []) as any[]).flatMap((s: any) => s.children ?? []);

// --- a JSON .sldd --------------------------------------------------------------------------

interface TextTab {
  doc: vscode.TextDocument;
  view: ReturnType<typeof fakePanel>;
  rows: any[];
  /** The live entry node the provider holds. */
  entry: () => any;
  /** Entry names the document's text holds. */
  names: () => string[];
}

async function withTextTab(copyName: string, run: (tab: TextTab) => Promise<void>): Promise<void> {
  const uri = wsUri(copyName);
  await vscode.workspace.fs.copy(wsUri('params.sldd'), uri, { overwrite: true });
  const view = fakePanel();
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
    const rows = view.posts.filter((m) => m.type === 'setRows').pop().rows as any[];
    await run({
      doc,
      view,
      rows,
      entry: () => entriesOf(peekModel(uri.toString())).find((e) => e.name === ENTRY),
      names: () => entryNames(doc.getText()),
    });
  } finally {
    view.close();
    clearClipboard();
    clearDrag();
    await vscode.workspace.fs.delete(uri);
  }
}

const rowOf = (rows: any[], name: string): any => {
  const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
  assert.ok(row, `params.sldd has an entry named ${name}`);
  return row;
};

/** Send `msg` and wait for the host to refuse it, or to write the document. */
async function answered(tab: TextTab, msg: any): Promise<void> {
  const version = tab.doc.version;
  tab.view.posts.length = 0;
  tab.view.send(msg);
  await waitFor(`an answer to ${msg.type}`, () => errorsIn(tab.view.posts).length > 0 || tab.doc.version > version);
  await quiet(100, `a second answer to ${msg.type}: an error after the write, or a write after the refusal`);
}

suite('A refused paste or drop into a JSON .sldd', () => {
  test('leaves no entry behind in the model: the next paste gets the name it was owed', async () => {
    await withTextTab('refused_paste_name.sldd', async (tab) => {
      const source = rowOf(tab.rows, ENTRY);
      tab.view.send({ type: 'copy', rowIds: [source.ID] });
      const before = tab.doc.getText();

      const restore = refuse(tab.entry(), 'serialize', (self) => COPY.test(String(self.name)));
      try {
        await answered(tab, { type: 'paste', rowId: source.ID });
      } finally {
        restore();
      }
      assert.deepStrictEqual(errorsIn(tab.view.posts), [`Failed to apply edit: ${REFUSAL}`], 'the refusal is reported');
      assert.strictEqual(tab.doc.getText(), before, 'and the document is untouched');
      assert.strictEqual(tab.doc.isDirty, false, 'and still clean');

      // The same paste, now allowed. The name is the one a paste with no failure before it gets:
      // the refused copy must not be standing in the namespace it was uniquified against.
      await answered(tab, { type: 'paste', rowId: source.ID });
      assert.deepStrictEqual(errorsIn(tab.view.posts), [], 'the second paste lands');
      const added = tab.names().filter((n) => !entryNames(before).includes(n));
      assert.deepStrictEqual(added, [`${ENTRY}1`], 'and its copy is the first one, not the second');
    });
  }).timeout(60000);

  test('after a refused same-document cut, the cut entry is still there to edit', async () => {
    await withTextTab('refused_cut_edit.sldd', async (tab) => {
      const source = rowOf(tab.rows, ENTRY);
      const element = tab.rows.find((r) => r.parent === source.ID);
      assert.ok(element, `${ENTRY} has element rows`);
      const before = tab.doc.getText();

      // A real refusal, no stub: a matrix cannot become a Constant, and Architectural Data makes a
      // pasted variable one. The cut takes the source out of the model before that rule runs.
      tab.view.send({ type: 'cut', rowIds: [source.ID] });
      await answered(tab, { type: 'paste', rowId: 'section:arch' });
      const refusals = errorsIn(tab.view.posts);
      assert.strictEqual(refusals.length, 1, 'the paste is refused');
      assert.match(refusals[0], /must be scalar and numeric/);
      assert.strictEqual(tab.doc.getText(), before, 'and the document is untouched');

      // The cut entry is still in the file and on screen; the edit must find it in the model too.
      await answered(tab, { type: 'edit', rowId: element.ID, columnId: 'Value', oldValue: '1', newValue: '9' });
      assert.deepStrictEqual(errorsIn(tab.view.posts), [], 'the edit is applied, not "Could not locate"');
      const value = (chunkOf(tab.doc.getText()).entries as any[]).find((e) => e.name === ENTRY)?.value;
      assert.match(JSON.stringify(value), /9/, 'and the file holds the new element');
    });
  }).timeout(60000);

  test('a drag that cannot start says why, and holds nothing', async () => {
    await withTextTab('refused_drag_start.sldd', async (tab) => {
      const source = rowOf(tab.rows, ENTRY);
      const restore = refuse(tab.entry(), 'serialize', (self) => self.name === ENTRY);
      try {
        tab.view.posts.length = 0;
        tab.view.send({ type: 'dragStart', rowIds: [source.ID] });
        await waitFor('the drag start to be refused', () => errorsIn(tab.view.posts).length > 0);
      } finally {
        restore();
      }
      assert.deepStrictEqual(errorsIn(tab.view.posts), [DRAG_REFUSAL], 'the refusal is reported, in core\'s words');
      assert.strictEqual(getDrag(), null, 'and the drag register is empty');
    });
  }).timeout(60000);

  test('a refused drop ends the drag, and leaves no entry behind either', async () => {
    await withTextTab('refused_drop.sldd', async (tab) => {
      const source = rowOf(tab.rows, ENTRY);
      const before = tab.doc.getText();
      // Copied FIRST, for the paste at the end: that paste asks what the drop left in the model,
      // so nothing between the two may touch it. (A copy reads the tree as it stands rather than
      // re-reading the document, but one made after the drop would still be a step the question
      // does not need.)
      tab.view.send({ type: 'copy', rowIds: [source.ID] });
      tab.view.send({ type: 'dragStart', rowIds: [source.ID] });
      await waitFor('the drag to start', () => getDrag() !== null);
      assert.ok(getDrag(), 'the drag started');

      const restore = refuse(tab.entry(), 'serialize', (self) => COPY.test(String(self.name)));
      try {
        await answered(tab, { type: 'drop', rowId: source.ID, mode: 'copy' });
      } finally {
        restore();
      }
      assert.deepStrictEqual(errorsIn(tab.view.posts), [`Failed to apply edit: ${REFUSAL}`], 'the refusal is reported');
      assert.strictEqual(tab.doc.getText(), before, 'and the document is untouched');
      assert.strictEqual(getDrag(), null, 'and the drag is over');

      // The drop's half of the model repair, asked the same way as the paste's above.
      await answered(tab, { type: 'paste', rowId: source.ID });
      const added = tab.names().filter((n) => !entryNames(before).includes(n));
      assert.deepStrictEqual(added, [`${ENTRY}1`], 'the next copy gets the first name');
    });
  }).timeout(60000);
});

// --- a compressed-binary .sldd -------------------------------------------------------------

// The MATLAB-written binary twin of params.sldd, copied beside the workspace folder (see
// multiPasteSelection.test.ts for why this file and not a synthetic one).
function binaryFixture(): vscode.Uri {
  return vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd');
}

async function withBinaryTab(
  copyName: string,
  run: (tab: { doc: any; view: ReturnType<typeof fakePanel>; rows: any[]; entry: () => any }) => Promise<void>,
): Promise<void> {
  const uri = vscode.Uri.joinPath(ws(), '..', copyName);
  await vscode.workspace.fs.copy(binaryFixture(), uri, { overwrite: true });
  const provider = new BinarySlddEditorProvider(ctx());
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  try {
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    const rows = view.posts.filter((m) => m.type === 'setRows').pop().rows as any[];
    await run({ doc, view, rows, entry: () => entriesOf(DataModel.getDataSource(doc.srcId)).find((e) => e.name === ENTRY) });
  } finally {
    view.close();
    doc.dispose();
    clearDrag();
    await vscode.workspace.fs.delete(uri);
  }
}

suite('A refused drag or drop on a compressed-binary .sldd', () => {
  test('a drag that cannot start says why, and holds nothing', async () => {
    await withBinaryTab('refused_drag_start_bin.sldd', async ({ view, rows, entry }) => {
      const source = rowOf(rows, ENTRY);
      const restore = refuse(entry(), 'serialize', (self) => self.name === ENTRY);
      try {
        view.posts.length = 0;
        view.send({ type: 'dragStart', rowIds: [source.ID] });
        await waitFor('the drag start to be refused', () => errorsIn(view.posts).length > 0);
      } finally {
        restore();
      }
      assert.deepStrictEqual(errorsIn(view.posts), [DRAG_REFUSAL], 'the refusal is reported, in core\'s words');
      assert.strictEqual(getDrag(), null, 'and the drag register is empty');
    });
  }).timeout(60000);

  test('a refused drop ends the drag', async () => {
    await withBinaryTab('refused_drop_bin.sldd', async ({ doc, view, rows }) => {
      const source = rowOf(rows, ENTRY);
      const before = doc.chunkXml as string;
      view.send({ type: 'dragStart', rowIds: [source.ID] });
      await waitFor('the drag to start', () => getDrag() !== null);
      assert.ok(getDrag(), 'the drag started');

      // The same real refusal as the JSON cut above: a matrix dropped into Architectural Data.
      view.posts.length = 0;
      view.send({ type: 'drop', rowId: 'section:arch', mode: 'copy' });
      await waitFor('the refusal', () => errorsIn(view.posts).length > 0);
      await waitFor('the refused drop to end the drag', () => getDrag() === null);
      assert.match(errorsIn(view.posts)[0], /must be scalar and numeric/);
      assert.strictEqual(doc.chunkXml, before, 'the document is untouched');
      assert.strictEqual(getDrag(), null, 'and the drag is over');
    });
  }).timeout(60000);
});
