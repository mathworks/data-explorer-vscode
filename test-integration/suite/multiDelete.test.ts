// Copyright 2026 The MathWorks, Inc.
// Deleting MANY rows at once, driven the way the table drives it: one `delete` message
// carrying the whole selection.
//
// Nothing under test-integration reached a provider's delete path before this file. The
// unit suites cover the pieces — planDeletion's subsumption over real rows
// (test/multiSelectInvariants.test.ts), and "narrow === wide" for the text and the model
// (test/jsonStructuralNarrow.test.ts, test/binaryEntryScopedEdit.test.ts) — but each of
// those reconstructs the pipeline from exported functions. What only a real host can say
// is that the assembled thing works: the message the webview posts, through the provider
// that receives it, to the bytes on disk.
//
// Three gestures, and they were verified by hand until now:
//
//  1. SELECT-ALL, then Delete. The gesture that hands the host every row it has, headers
//     and children included, and asks it to sort out what that means.
//  2. A SCATTERED selection — non-contiguous entries, children of a container, a child
//     whose own entry is also selected, a section header, and a stale id — which is
//     where subsumption either holds or quietly deletes a neighbour.
//  3. Both of those on a COMPRESSED-BINARY .sldd, whose provider is a different editor
//     with a different write path. Same rule, two paths: the pairing this repo keeps
//     getting wrong is exactly the one no single-path test can see.
//
// Ctrl+A is not simulated as a keystroke — it is what `_selectAll` produces, which is the
// VISIBLE rows (dex-tree-table.ts). Collapsed that is headers plus top-level entries;
// expanded it is every row in the table. Both are sent here, because the two must agree:
// subsumption (deletionPlan.hasSelectedAncestor) is what makes the child ids redundant, and
// the expanded gesture is the one that breaks when it stops holding.
//
// HOW it breaks was measured rather than assumed, by deleting that check and running this
// file: the redundant child ids are then planned as work of their own against an entry that
// is about to leave the tree, and the model op refuses — "This item cannot be deleted" on
// the JSON path, "\"StructType\" is not in a section" on the binary one. So the gesture is
// rejected outright rather than half-applied, and what catches it is the no-error guard
// every run in this file passes through. The file comparison is kept as the assertion
// anyway: it is the invariant that has to hold, and a future provider that swallowed that
// error instead of reporting it would still have to produce the same file to get past it.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { SC_PART_XML } from 'data-explorer-core';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import {
  chunkOf,
  childrenOf,
  ctx,
  entryNames,
  fakePanel,
  isEntryRow,
  isHeader,
  nameOf,
  rowNamed,
  settle,
  token,
  waitFor,
  ws,
  wsUri,
} from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

// An ARRAY's child rows, which core labels `name(3)` / `name{1,2}` (its subscriptLabel).
// They are the one kind of child this file's container assertions cannot use: the label is
// a position rather than a name, so the file never spells it, and shrinking the array to
// one element leaves a scalar with no child rows at all rather than a container holding
// one. Both are correct behaviour and neither is this test's subject.
const isElementRow = (row: any): boolean => /[({][\d,\s]+[)}]$/.test(nameOf(row));

/**
 * Open a working copy of a JSON fixture through the real provider, let the caller choose a
 * selection out of the rows the host actually sent, post the delete, and hand back what
 * came of it. The working copy is uniquely named because the URI is both the model cache
 * key and the data-source id, and it is deleted in a `finally` because it lands in the
 * workspace folder that sectionsTree.test.ts enumerates by name.
 */
async function deleteFromJson(
  fixture: string,
  copyName: string,
  pick: (rows: any[]) => string[],
): Promise<{ before: string; after: string; versions: number; posts: any[]; rows: any[] }> {
  const uri = wsUri(copyName);
  await vscode.workspace.fs.copy(wsUri(fixture), uri, { overwrite: true });
  const view = fakePanel();
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
    view.send({ type: 'ready' });
    await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
    const opened = view.posts.filter((m) => m.type === 'setRows').pop();
    assert.ok(opened, 'the first paint sent the whole table');
    const rows = opened.rows as any[];

    const before = doc.getText();
    const rowIds = pick(rows);
    assert.ok(rowIds.length > 1, 'this file is about MULTI-row deletes');
    const versionBefore = doc.version;
    view.posts.length = 0;
    view.send({ type: 'delete', rowIds });

    // Done means one of two things, and a refusal is one of them: the no-operands case
    // writes nothing at all and reports instead, so waiting only for a new version would
    // sit there for the whole cap and then blame the rows.
    await waitFor(
      'the delete to be applied or refused',
      () =>
        view.posts.some((m) => m.type === 'error') ||
        (doc.version > versionBefore &&
          view.posts.some((m) => m.type === 'updateEntryRows' || m.type === 'setRows')),
    );
    // The repaint is what the wait above catches; `selectRows` follows it. Small and fixed
    // because it is a tail, not the work.
    await settle(150);

    const after = doc.getText();
    assert.ok(
      !view.posts.some((m) => m.type === 'error'),
      `no error was reported (${JSON.stringify(view.posts.filter((m) => m.type === 'error'))})`,
    );
    return { before, after, versions: doc.version - versionBefore, posts: view.posts, rows };
  } finally {
    view.close();
    await vscode.workspace.fs.delete(uri);
  }
}

suite('Select-all then Delete, on a JSON .sldd', () => {
  test('empties every section, in ONE write, and says where the selection went', async () => {
    // Collapsed: the visible rows are the headers and the top-level entries. 20 entries in
    // data.sldd, so this is the gesture at its widest — and the whole of it is one write,
    // not one per entry, which is the difference between an instant Ctrl+A and twenty
    // WorkspaceEdits the user can undo one at a time.
    const run = await deleteFromJson('data.sldd', 'json_delete_all_collapsed.sldd', (rows) =>
      rows.filter((r) => isHeader(r) || isEntryRow(r)).map((r) => r.ID),
    );
    assert.deepStrictEqual(entryNames(run.after), [], 'every entry is gone');
    assert.strictEqual(run.versions, 1, 'one WorkspaceEdit, so one undo step');

    // The sections themselves survive — a section is not a thing the user deleted, and a
    // dictionary with no `entries` array at all does not reopen.
    const chunk = chunkOf(run.after);
    assert.ok(Array.isArray(chunk.entries), 'the entries array is still there, just empty');
    assert.ok(Array.isArray(chunk['Dictionary References']), 'and so is the other section');
    assert.strictEqual(chunk.AllowAccessBWS, false, 'and the sibling properties are untouched');

    // Nothing is left selected that no longer exists. The table asks for a landing row.
    const landed = run.posts.filter((m) => m.type === 'selectRows').pop();
    assert.ok(landed, 'the host named a row for the selection to land on');
    assert.deepStrictEqual(
      (landed.rowIds as string[]).filter((id) => !id.startsWith('section:')),
      [],
      `with every entry gone the only place left is a header (got ${JSON.stringify(landed.rowIds)})`,
    );
    assert.ok(landed.rowIds.length, 'and it named one');
  }).timeout(60000);

  test('collapsed and expanded select-all produce the SAME file', async () => {
    // Expanded, Ctrl+A also hands over every nested child — a bus element whose entry is in
    // the same list. Subsumption is what makes those ids redundant, and this is the pairing
    // that holds it: a child deleted on its own account as well as with its entry fails the
    // run outright (see the header comment for the two messages it fails with). The
    // collapsed run is the reference because it is the selection with nothing redundant in
    // it, so any difference is the redundancy's doing.
    const collapsed = await deleteFromJson('data.sldd', 'json_delete_all_ref.sldd', (rows) =>
      rows.filter((r) => isHeader(r) || isEntryRow(r)).map((r) => r.ID),
    );
    const expanded = await deleteFromJson('data.sldd', 'json_delete_all_expanded.sldd', (rows) => {
      const ids = rows.map((r) => r.ID);
      assert.ok(
        ids.length > rows.filter((r) => isHeader(r) || isEntryRow(r)).length,
        'data.sldd has nested children, so expanded really is a wider selection',
      );
      return ids;
    });

    assert.strictEqual(expanded.before, collapsed.before, 'both started from the same fixture');
    assert.strictEqual(
      expanded.after,
      collapsed.after,
      'the child ids changed nothing: one file, two selections',
    );
    assert.strictEqual(expanded.versions, 1, 'still one write');
  }).timeout(60000);
});

suite('A scattered multi-row delete, on a JSON .sldd', () => {
  test('takes exactly what was named, subsumes the rest, and leaves the file otherwise alone', async () => {
    // params.sldd is the biggest dictionary in the tree (40 entries), and the selection is
    // deliberately awkward: entries that are not adjacent, all but one child of a container
    // that SURVIVES, a child whose own entry is also selected (so the child id must be
    // subsumed rather than acted on twice), a section header, and an id for a row that is
    // not there. Everything the host can be handed at once, in one message.
    // Three whole entries, chosen from opposite ends of a 40-entry array so nothing about
    // this passes by being contiguous.
    const expectedGone = ['MyAlias', 'myStruct', 'u8Scalar'];
    let hostName = '';
    let hostId = '';
    let hostKeeps = '';

    const run = await deleteFromJson('params.sldd', 'json_delete_scattered.sldd', (rows) => {
      // The container is read off the table rather than named, because how many children a
      // fixture entry has is not this test's subject. What it needs is one whose children
      // are NAMED fields (a bus's elements, an enum's enumerals — see isElementRow), whose
      // children may be removed at all (a struct ARRAY's may not), and which is not itself
      // in the selection. Then: the widest such container, minus every child but its last.
      const containers = rows
        .filter(isEntryRow)
        .filter((row) => !expectedGone.includes(nameOf(row)))
        .map((row) => ({ row, kids: childrenOf(rows, row.ID) }))
        .filter(
          (c) =>
            c.kids.length >= 2 &&
            c.kids.every((k) => k._canDelete !== false && !isElementRow(k)),
        )
        .sort((a, b) => b.kids.length - a.kids.length);
      assert.ok(containers.length, 'params.sldd has a container of named, removable fields');
      const { row: host, kids } = containers[0];
      hostName = nameOf(host);
      hostId = host.ID;
      hostKeeps = nameOf(kids[kids.length - 1]);

      // And a child whose OWN entry is in the same selection, which is what expanding a
      // container before Ctrl+A produces. `_canDelete` is not consulted for it: the menu
      // subsumes it into its entry, so the entry's own permission is the one that counts.
      const struct = rowNamed(rows, 'myStruct');
      const structKids = childrenOf(rows, struct.ID);
      assert.ok(structKids.length >= 1, 'myStruct has a child to be subsumed');

      return [
        rowNamed(rows, 'MyAlias').ID,
        rowNamed(rows, 'u8Scalar').ID,
        struct.ID,
        structKids[0].ID, // subsumed: its entry is going anyway
        ...kids.slice(0, -1).map((k) => k.ID),
        rows.find(isHeader)!.ID, // a header is not an operand
        `${rows[1].ID}/NoSuchChildAnywhere`, // and neither is a row that does not exist
      ];
    });

    const namesAfter = entryNames(run.after);
    for (const gone of expectedGone) {
      assert.ok(!namesAfter.includes(gone), `"${gone}" was deleted`);
    }
    assert.strictEqual(
      namesAfter.length,
      entryNames(run.before).length - expectedGone.length,
      'and nothing else was: exactly three entries left',
    );
    assert.ok(namesAfter.includes(hostName), 'the container whose children went survives');
    assert.strictEqual(run.versions, 1, 'one write for the whole scattered gesture');

    // The OTHER section is a section the selection never named. params.sldd is the fixture
    // with something in it (a reference to a common.sldd that does not exist), so a splice
    // that reached past the entries array would show up right here.
    assert.deepStrictEqual(
      chunkOf(run.after)['Dictionary References'],
      chunkOf(run.before)['Dictionary References'],
      'the Dictionary References section is byte-for-byte what it was',
    );

    // The container's children went too — and the surviving one survived. Asserted on the
    // REPAINT rather than on the text, because a container's children are not all named in
    // the file the way they are in the table: an array's child rows are index labels
    // (`rowVec(4)`) the serializer never writes, so a name search in the JSON would depend
    // on which kind of container the fixture happened to give us. The repaint is the
    // table's own answer to "what is left", for every kind.
    const paint = run.posts
      .filter((m) => m.type === 'updateEntryRows' && m.entryRowId === hostId)
      .pop();
    assert.ok(paint, `the surviving container "${hostName}" was repainted`);
    assert.deepStrictEqual(
      childrenOf(paint.rows as any[], hostId).map(nameOf),
      [hostKeeps],
      `"${hostName}" kept exactly the one child that was left out of the selection`,
    );

    // And it reached the file, not just the table: the entry's own serialized form is not
    // what it was. (What it became is the narrow-write suites' subject, not this one's.)
    const entryOf = (text: string) =>
      (chunkOf(text).entries as any[]).find((e) => e.name === hostName);
    assert.notDeepStrictEqual(
      entryOf(run.after),
      entryOf(run.before),
      `the children deleted from "${hostName}" were written out`,
    );

    // Every deleted entry leaves the table the way the protocol spells a removal: a repaint
    // of its own subtree with NOTHING in it. Worth asserting per entry rather than trusting
    // the count, because a scattered selection is exactly where one operand can be planned
    // and then dropped — the file would be right and the table would still show the row.
    for (const gone of expectedGone) {
      const removals = run.posts.filter(
        (m) => m.type === 'updateEntryRows' && String(m.entryRowId).endsWith(`/${gone}`),
      );
      assert.ok(removals.length, `"${gone}" was taken off the table too, not just out of the file`);
      for (const removal of removals) {
        assert.deepStrictEqual(removal.rows, [], `and left no rows behind ("${gone}")`);
      }
    }
  }).timeout(60000);

  test('a selection of nothing but headers and stale ids is refused, not half-applied', async () => {
    // The other end of the same message. planDeletion drops headers and ids it cannot
    // resolve, so this selection plans to nothing — and the host has to say so and write
    // NOTHING, rather than reach the text with an empty plan and rewrite the file as
    // "itself minus nothing".
    const uri = wsUri('json_delete_no_operands.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    const view = fakePanel();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
      const rows = view.posts.filter((m) => m.type === 'setRows').pop()!.rows as any[];
      const before = doc.getText();
      const version = doc.version;
      view.posts.length = 0;

      view.send({
        type: 'delete',
        rowIds: [...rows.filter(isHeader).map((r) => r.ID), 'not-a-row-id', `${rows[1].ID}/nope`],
      });
      // The error IS the answer here, so it is what to wait for. Then a fixed tail, because
      // "nothing else happened" cannot be waited for — only given time to fail to happen.
      await waitFor('the refusal', () => view.posts.some((m) => m.type === 'error'));
      await settle(500);

      assert.strictEqual(doc.getText(), before, 'the document was not touched');
      assert.strictEqual(doc.version, version, 'and no write was attempted');
      assert.ok(
        view.posts.some((m) => m.type === 'error'),
        `the user was told (saw ${JSON.stringify(view.posts.map((m) => m.type))})`,
      );
    } finally {
      view.close();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});

// --- and now the OTHER path -------------------------------------------------------------
//
// A compressed-binary .sldd is a different editor with a different write path: no
// TextDocument, an XML payload spliced by hand, an undo stack the provider owns, and a zip
// to rebuild around it. Every gesture above is repeated here for the reason recorded in
// one-rule-two-paths: the bug this repo keeps producing is not "the rule is wrong", it is
// "the rule is right in one path and absent from the other", and only a test that states
// the pairing catches that.
//
// The fixture is the vitest suite's architectural dictionary, sourced rather than copied so
// the dictionary this asks about is the one the unit tests ask about — and written OUTSIDE
// the workspace folder, whose exact file set two other suites assert. It carries a
// pass-through zip member (System Composer's interfaceDictionary.xml) that the editor never
// edits and must re-zip verbatim, which makes it the fixture that can show a delete
// damaging a part of the file it had no business touching.
const ARCH_ENTRIES = ['StructType', 'DataInterface', 'ValueType'];

function archFixture(): vscode.Uri {
  return vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'fixtures', 'arch_binary.sldd');
}

/** How many DD.ENTRY objects the payload spells. */
const entryCountOfXml = (xml: string): number => (xml.match(/Class="DD\.ENTRY"/g) ?? []).length;

/** Whether the payload names something — an entry, or an element of one. */
const namesInXml = (xml: string, name: string): boolean => xml.includes(`>${name}</P>`);

/**
 * The binary twin of deleteFromJson: open a working copy through the real custom editor,
 * choose a selection from the rows the host sent, post the delete, then SAVE — because on
 * this format the payload and the file are two different things, and a delete that got the
 * payload right can still write a broken zip.
 */
async function deleteFromBinary(
  copyName: string,
  pick: (rows: any[]) => string[],
): Promise<{
  before: string;
  after: string;
  edits: number;
  posts: any[];
  rows: any[];
  saved: Record<string, Uint8Array>;
}> {
  const uri = vscode.Uri.joinPath(ws(), '..', copyName);
  await vscode.workspace.fs.copy(archFixture(), uri, { overwrite: true });
  const provider = new BinarySlddEditorProvider(ctx());
  let edits = 0;
  const sub = provider.onDidChangeCustomDocument(() => {
    edits += 1;
  });
  const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  try {
    await provider.resolveCustomEditor(doc, view.panel, token());
    // No settle anywhere in here: this provider answers `ready` and `delete` synchronously
    // (the model is mutated and the payload spliced before postMessage), which is the whole
    // point of the entry-scoped write path — see the comment on liveModel().
    view.send({ type: 'ready' });
    const opened = view.posts.filter((m) => m.type === 'setRows').pop();
    assert.ok(opened, 'the first paint sent the whole table');
    const rows = opened.rows as any[];

    const before = (doc as any).chunkXml as string;
    const rowIds = pick(rows);
    assert.ok(rowIds.length > 1, 'this file is about MULTI-row deletes');
    view.posts.length = 0;
    view.send({ type: 'delete', rowIds });

    const after = (doc as any).chunkXml as string;
    assert.ok(
      !view.posts.some((m) => m.type === 'error'),
      `no error was reported (${JSON.stringify(view.posts.filter((m) => m.type === 'error'))})`,
    );
    await provider.saveCustomDocument(doc, token());
    const saved = unzipSync(await vscode.workspace.fs.readFile(uri));
    return { before, after, edits, posts: view.posts, rows, saved };
  } finally {
    // The view first: closing it is what unregisters the webview and takes this view out of
    // `document.views`, and the document should not be disposed with a view still in it.
    view.close();
    sub.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  }
}

/** The fixture's own copy of a zip member, to compare a saved one against. */
async function archMember(member: string): Promise<Uint8Array> {
  const zip = unzipSync(await vscode.workspace.fs.readFile(archFixture()));
  const bytes = zip[member];
  assert.ok(bytes, `the fixture carries ${member}`);
  return bytes;
}

suite('The same two gestures, on a compressed-binary .sldd', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('select-all empties the payload in ONE edit, and the file it saves is still a dictionary', async () => {
    const run = await deleteFromBinary('bin_delete_all_collapsed.sldd', (rows) =>
      rows.filter((r) => isHeader(r) || isEntryRow(r)).map((r) => r.ID),
    );
    assert.strictEqual(entryCountOfXml(run.before), ARCH_ENTRIES.length, 'the fixture had three');
    assert.strictEqual(entryCountOfXml(run.after), 0, 'and the payload holds none');
    for (const name of ARCH_ENTRIES) {
      assert.ok(!namesInXml(run.after, name), `"${name}" is gone from the payload`);
    }
    // One edit on the provider's own undo stack — the equivalent of the JSON path's single
    // WorkspaceEdit, and the same promise to the user: one Ctrl+Z puts it all back.
    assert.strictEqual(run.edits, 1, 'one document edit, so one undo step');

    // The payload is not the file. What a save writes has to still be a zip with the
    // dictionary member in it, and the two must agree.
    const chunk = run.saved['data/chunk0.xml'];
    assert.ok(chunk, 'the saved file still holds data/chunk0.xml');
    assert.strictEqual(new TextDecoder().decode(chunk), run.after, 'and it is the emptied payload');
    assert.ok(run.saved['metadata/mwcoreProperties.xml'], 'the metadata part came through too');

    // The part the editor never touches. Deleting every entry is the widest edit there is,
    // and it must still leave System Composer's catalog byte-for-byte alone: it is written
    // verbatim, so a rebuilt one would land in the user's file as a reformatting of
    // something this session never meant to change.
    assert.deepStrictEqual(
      run.saved[SC_PART_XML],
      await archMember(SC_PART_XML),
      'the pass-through part survived the widest delete there is',
    );

    const landed = run.posts.filter((m) => m.type === 'selectRows').pop();
    assert.ok(landed, 'the host named a row for the selection to land on');
    assert.deepStrictEqual(
      (landed.rowIds as string[]).filter((id) => !id.startsWith('section:')),
      [],
      `with every entry gone the only place left is a header (got ${JSON.stringify(landed.rowIds)})`,
    );
    assert.ok(landed.rowIds.length, 'and it named one');
  }).timeout(60000);

  test('collapsed and expanded select-all produce the SAME payload', async () => {
    // The JSON pairing, restated on the path that splices XML by hand. Here the redundant
    // child ids are bus elements whose owning entry is in the same selection, and this
    // provider is the one where dropping subsumption fails loudest: reserializing a child
    // group needs its entry's section, and the entry is on its way out of the tree.
    const collapsed = await deleteFromBinary('bin_delete_all_ref.sldd', (rows) =>
      rows.filter((r) => isHeader(r) || isEntryRow(r)).map((r) => r.ID),
    );
    const expanded = await deleteFromBinary('bin_delete_all_expanded.sldd', (rows) => {
      const ids = rows.map((r) => r.ID);
      assert.ok(
        ids.length > rows.filter((r) => isHeader(r) || isEntryRow(r)).length,
        'the fixture has nested children, so expanded really is a wider selection',
      );
      return ids;
    });

    assert.strictEqual(expanded.before, collapsed.before, 'both started from the same fixture');
    assert.strictEqual(
      expanded.after,
      collapsed.after,
      'the child ids changed nothing: one payload, two selections',
    );
    assert.strictEqual(expanded.edits, 1, 'still one edit');
  }).timeout(60000);

  test('a scattered selection takes the entry and the child it named, and nothing adjacent', async () => {
    // One whole entry and one CHILD of a different entry, in a single message — the two
    // shapes applyDeleteMany folds together, and the pair that has to be spliced in the
    // right order: the child group is edited inside its entry while the other entry's whole
    // object is cut out of the same string.
    const run = await deleteFromBinary('bin_delete_scattered.sldd', (rows) => {
      const struct = rowNamed(rows, 'StructType');
      const kids = childrenOf(rows, struct.ID);
      assert.deepStrictEqual(kids.map(nameOf), ['Element'], 'StructType has the one bus element');
      return [
        rowNamed(rows, 'DataInterface').ID, // a whole entry
        kids[0].ID, // and a child of an entry that STAYS
        rows.find(isHeader)!.ID, // a header is not an operand
        `${struct.ID}/NoSuchElementAnywhere`, // and neither is a row that does not exist
      ];
    });

    assert.ok(!namesInXml(run.after, 'DataInterface'), 'the entry that was named is gone');
    assert.ok(namesInXml(run.after, 'StructType'), 'the entry that only lost a child survives');
    assert.ok(!namesInXml(run.after, 'Element'), 'without the element that was named');
    assert.ok(namesInXml(run.after, 'ValueType'), 'and the entry nobody named is untouched');
    assert.strictEqual(entryCountOfXml(run.after), 2, 'exactly one entry left');
    assert.strictEqual(run.edits, 1, 'one edit for the whole scattered gesture');

    // The table agrees: the child's entry was repainted without it, and the deleted entry
    // left by a repaint with no rows in it.
    const paints = run.posts.filter((m) => m.type === 'updateEntryRows');
    const structPaint = paints.filter((m) => String(m.entryRowId).endsWith('/StructType')).pop();
    assert.ok(structPaint, 'StructType was repainted');
    const structRows = structPaint.rows as any[];
    assert.ok(structRows.length, 'and it is still on the table');
    assert.deepStrictEqual(
      structRows.filter((r) => r.parent === structPaint.entryRowId).map(nameOf),
      [],
      'with no children under it',
    );
    const gonePaint = paints.filter((m) => String(m.entryRowId).endsWith('/DataInterface')).pop();
    assert.ok(gonePaint, 'DataInterface was taken off the table too');
    assert.deepStrictEqual(gonePaint.rows, [], 'and left no rows behind');

    // Still a valid file, still carrying the part the editor does not own.
    assert.strictEqual(
      new TextDecoder().decode(run.saved['data/chunk0.xml']),
      run.after,
      'the save wrote the payload the delete produced',
    );
    assert.deepStrictEqual(
      run.saved[SC_PART_XML],
      await archMember(SC_PART_XML),
      'and left the pass-through part alone',
    );
  }).timeout(60000);
});
