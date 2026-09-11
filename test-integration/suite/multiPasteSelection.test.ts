// Copyright 2026 The MathWorks, Inc.
// What a paste of SEVERAL entries leaves selected.
//
// The reported defect: copy three entries, paste, and only one of the three is selected —
// so the very next gesture (Delete, drag, another Copy) acts on one entry when the user is
// looking at three they just created. Every layer under the message already carried all of
// them: the fold that performs the paste returns a `selectId` per entry
// (structuralEdit.foldPasteEntries, pinned in test/dropComplete.test.ts and
// test/multiPasteAtomicity.test.ts), and the host had them in hand. The loss was one
// expression at the post site — `selectIds[selectIds.length - 1]` — because the message
// itself could only carry a single `rowId`.
//
// So the test has to be at THIS level. A unit test of the fold passes either way, and the
// webview's half (rowUpdates.pendingSelectionToApply) is pinned in test/rowUpdates.test.ts.
// What only a real host can say is that the count survives the whole trip: the `copy` and
// `paste` the table posts, through the provider that receives them, into the message the
// table would act on next.
//
// Both .sldd formats, for the reason this repo keeps relearning: the JSON provider and the
// binary one are separate editors with separate paste paths, and a rule enforced in one is
// not enforced in the other. The singular field was wrong in FOUR places for exactly that
// reason — a paste and a drop, twice over.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import {
  chunkOf,
  ctx,
  entryNames,
  fakePanel,
  isEntryRow,
  nameOf,
  settle,
  token,
  waitFor,
  ws,
  wsUri,
} from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The ids a `selectRows` message asked for, from the last one the host sent. */
function selectionAsked(posts: any[]): string[] {
  const asked = posts.filter((m) => m.type === 'selectRows').pop();
  assert.ok(asked, 'the host named a selection for the paste to land on');
  assert.ok(Array.isArray(asked.rowIds), '`selectRows` carries an ARRAY of ids');
  return asked.rowIds as string[];
}

/** Every row id the host painted into the table after the gesture (paste rows arrive here). */
function paintedRowIds(posts: any[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of posts) {
    if (msg.type === 'insertEntryRows' || msg.type === 'updateEntryRows' || msg.type === 'setRows') {
      for (const row of (msg.rows ?? []) as any[]) ids.add(row.ID);
    }
  }
  return ids;
}

/**
 * Copy `names` and paste them back into the section they came from, through the real JSON
 * provider. Pasting into the SOURCE section is deliberate: it is the gesture that
 * duplicates, so the new entries have to be uniquified (`Bus` → `Bus1`) and their ids
 * cannot be confused with the originals'.
 *
 * The working copy is uniquely named because the URI is both the model cache key and the
 * data-source id, and it is deleted in a `finally` because it lands in the workspace folder
 * that sectionsTree.test.ts enumerates by name.
 */
async function pasteIntoJson(
  copyName: string,
  names: string[],
): Promise<{ before: string; after: string; versions: number; posts: any[]; rows: any[] }> {
  const uri = wsUri(copyName);
  await vscode.workspace.fs.copy(wsUri('params.sldd'), uri, { overwrite: true });
  const view = fakePanel();
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
    const rows = view.posts.filter((m) => m.type === 'setRows').pop().rows as any[];

    const sources = names.map((name) => {
      const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
      assert.ok(row, `params.sldd has an entry named "${name}"`);
      return row;
    });
    const before = doc.getText();
    const versionBefore = doc.version;

    view.send({ type: 'copy', rowIds: sources.map((r) => r.ID) });
    view.posts.length = 0;
    // The anchor is a row in the target section — what the table sends is the row the user
    // right-clicked, and the host resolves the section from it.
    view.send({ type: 'paste', rowId: sources[0].ID });

    await waitFor(
      'the paste to be applied or refused',
      () =>
        view.posts.some((m) => m.type === 'error') ||
        (doc.version > versionBefore && view.posts.some((m) => m.type === 'selectRows')),
    );
    await settle(150);

    assert.ok(
      !view.posts.some((m) => m.type === 'error'),
      `no error was reported (${JSON.stringify(view.posts.filter((m) => m.type === 'error'))})`,
    );
    return { before, after: doc.getText(), versions: doc.version - versionBefore, posts: view.posts, rows };
  } finally {
    view.close();
    await vscode.workspace.fs.delete(uri);
  }
}

suite('Pasting several entries, on a JSON .sldd', () => {
  test('selects EVERY entry it added, not just the last', async () => {
    const run = await pasteIntoJson('json_paste_many.sldd', ['MyBus', 'MyAlias', 'MyEnum']);

    // What the file gained: three copies, uniquified against the namespace they joined
    // (`MyBus` → `MyBus1`), appended, so file order is paste order.
    const added = entryNames(run.after).filter((n) => !entryNames(run.before).includes(n));
    assert.strictEqual(added.length, 3, `three entries were added to the file (got ${JSON.stringify(added)})`);
    assert.strictEqual(run.versions, 1, 'one WorkspaceEdit, so one undo step');

    // The invariant, and the whole point of the file: the selection names exactly what the
    // paste added. Derived from the file rather than spelled out, so it holds whatever the
    // uniquifier decides to call the copies.
    const asked = selectionAsked(run.posts);
    assert.deepStrictEqual(
      asked.map((id) => id.slice(id.lastIndexOf('/') + 1)),
      added,
      `all three pasted entries are selected, in the order they were appended (got ${JSON.stringify(asked)})`,
    );
  }).timeout(60000);

  test('every id it names is a row the table was actually given', async () => {
    // A selection the table cannot resolve is silently no selection at all
    // (pendingSelectionToApply holds, waiting for rows that never come), which would look
    // exactly like the bug being fixed. So the ids are checked against the rows the host
    // painted, not just counted.
    const run = await pasteIntoJson('json_paste_ids.sldd', ['MyBus', 'MyAlias']);
    const painted = paintedRowIds(run.posts);
    for (const id of selectionAsked(run.posts)) {
      assert.ok(painted.has(id), `the table holds a row for the selected id ${id}`);
    }
    // And they are new rows, not the originals — a paste that selected its own source would
    // pass a count check while leaving the user's next Delete pointed at the wrong entries.
    const sourceIds = new Set(run.rows.map((r: any) => r.ID));
    for (const id of selectionAsked(run.posts)) {
      assert.ok(!sourceIds.has(id), `${id} is a row the paste created, not the one it copied`);
    }
  }).timeout(60000);

  test('a single-entry paste still names exactly that one', async () => {
    // The plural message must not turn the ordinary case into a multi-selection: one entry
    // pasted is one row selected, which is what makes the Property Inspector show it.
    const run = await pasteIntoJson('json_paste_one.sldd', ['MyBus']);
    const added = entryNames(run.after).filter((n) => !entryNames(run.before).includes(n));
    const asked = selectionAsked(run.posts);
    assert.strictEqual(asked.length, 1, `one entry pasted, one row selected (got ${JSON.stringify(asked)})`);
    assert.deepStrictEqual([asked[0].slice(asked[0].lastIndexOf('/') + 1)], added, 'and it is the copy');
    assert.ok(chunkOf(run.after).entries.some((e: any) => e.name === added[0]), 'which the file spells too');
  }).timeout(60000);
});

// The other format, same rule. Its provider is a different editor with its own paste path
// (pasteEntriesXml into the chunk XML, an in-memory edit rather than a WorkspaceEdit), and
// it answers synchronously — no waiting, which is why nothing here sleeps.
//
// The same three entry names as the JSON runs above, because this is the real MATLAB-written
// binary of the same dictionary. Reaching for it rather than the smaller hand-written
// test/fixtures/arch_binary.sldd is not incidental: a paste inserts its fragment before the
// chunk's trailing `DD.Dictionary` object, and only genuine MATLAB output carries one — the
// synthetic fixtures stop after their entries, so every paste into them is refused with
// "Could not locate the insertion point." A test about what a paste SELECTS has to be run
// against a file a paste can actually land in.
const BINARY_ENTRIES = ['MyBus', 'MyAlias', 'MyEnum'];

function binaryFixture(): vscode.Uri {
  return vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd');
}

async function pasteIntoBinary(
  copyName: string,
  names: string[],
): Promise<{ posts: any[]; rows: any[]; xml: string; edits: number }> {
  // Beside the workspace folder, not in it: sectionsTree.test.ts asserts that folder's exact
  // file list.
  const uri = vscode.Uri.joinPath(ws(), '..', copyName);
  await vscode.workspace.fs.copy(binaryFixture(), uri, { overwrite: true });
  const provider = new BinarySlddEditorProvider(ctx());
  let edits = 0;
  const sub = provider.onDidChangeCustomDocument(() => {
    edits += 1;
  });
  const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  try {
    await provider.resolveCustomEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    const rows = view.posts.filter((m) => m.type === 'setRows').pop().rows as any[];
    const sources = names.map((name) => {
      const row = rows.find((r) => isEntryRow(r) && nameOf(r) === name);
      assert.ok(row, `the binary params.sldd has an entry named "${name}"`);
      return row;
    });

    view.send({ type: 'copy', rowIds: sources.map((r) => r.ID) });
    view.posts.length = 0;
    view.send({ type: 'paste', rowId: sources[0].ID });
    // The cross-document half of a cut is the only awaited step in this path, and a copy has
    // none — but the handler is async, so give its microtasks a turn before reading.
    await settle(0);

    assert.ok(
      !view.posts.some((m) => m.type === 'error'),
      `no error was reported (${JSON.stringify(view.posts.filter((m) => m.type === 'error'))})`,
    );
    return { posts: view.posts, rows, xml: (doc as any).chunkXml as string, edits };
  } finally {
    view.close();
    sub.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  }
}

suite('Pasting several entries, on a compressed-binary .sldd', () => {
  test('selects EVERY entry it added, as one edit', async () => {
    const run = await pasteIntoBinary('binary_paste_many.sldd', BINARY_ENTRIES);

    const asked = selectionAsked(run.posts);
    assert.strictEqual(asked.length, 3, `all three pasted entries are selected (got ${JSON.stringify(asked)})`);
    assert.deepStrictEqual(
      asked.map((id) => id.slice(id.lastIndexOf('/') + 1)),
      BINARY_ENTRIES.map((n) => `${n}1`),
      'and they are the copies, in paste order',
    );
    assert.strictEqual(run.edits, 1, 'the whole paste is one undoable edit');
    // The 40 entries the file already had, plus three copies.
    assert.strictEqual((run.xml.match(/Class="DD\.ENTRY"/g) ?? []).length, 43, 'and the file gained three entries');
    for (const name of BINARY_ENTRIES) {
      assert.ok(run.xml.includes(`>${name}1</P>`), `the copy "${name}1" was written out`);
    }
  }).timeout(60000);

  test('the two formats agree on how many rows a paste selects', async () => {
    // The pairing, stated as one assertion rather than left implicit in two suites: the
    // count is a property of the GESTURE, so a provider that loses ids again fails here even
    // if its own suite's expectations were updated to match the loss.
    const json = await pasteIntoJson('json_paste_pair.sldd', ['MyBus', 'MyAlias']);
    const binary = await pasteIntoBinary('binary_paste_pair.sldd', ['MyBus', 'MyAlias']);
    assert.strictEqual(
      selectionAsked(json.posts).length,
      selectionAsked(binary.posts).length,
      'two entries pasted, two rows selected, whichever format is open',
    );
    assert.strictEqual(selectionAsked(json.posts).length, 2, 'and that count is two');
  }).timeout(60000);
});
