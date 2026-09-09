// Copyright 2026 The MathWorks, Inc.
//
// The entry-scoped repaint for a compressed-binary .sldd: an edit paints ONE entry's
// rows from the model it just mutated, instead of re-parsing the whole dictionary and
// rebuilding every row. On a real customer file (75 MB of data/chunk0.xml, 31k entries)
// the old path spent ~7.5 s per keystroke-commit — two full parses of the same XML, one
// before the mutation and one to repaint — to express a one-cell change.
//
// BinarySlddEditorProvider imports `vscode` and cannot run under vitest, so — like
// binaryDirtyLifecycle.test.ts beside it — this reproduces the provider's composition
// from the real modules:
//   BinarySlddParser     (parseBinarySlddParts)      — the parse post() no longer does
//   DataModel            (mutateSubtree, findNodeById)
//   BinarySlddSerializer (serializeEntryToXml)
//   xmlEntrySplice       (findEntryObjectSpan)
//   xmlStructuralEdit    (addChildXml / deleteChildXml)
//   slddBaseline         (isEntryModified vs computeModified)
//   rowBuilder           (buildEntryRows vs buildRows)
//   rowUpdates           (spliceEntryRows — the webview's half)
//
// Two invariants, and they are the whole point:
//
//  1. NARROW === WIDE. Splicing the entry's freshly built rows into the rows already on
//     screen must produce, row for row, what a full re-parse-and-rebuild would have
//     produced. Anything the fast path gets wrong here is a table that disagrees with
//     the file until something else forces a full repaint.
//
//  2. The row ids it paints must still RESOLVE. Skipping the re-parse means skipping the
//     re-registration that used to rebuild DataModel's node index — and a node id is a
//     path, so a rename rekeys the entry and everything under it. Get this wrong and the
//     edit looks fine; it is the NEXT edit on that row that fails with "could not locate
//     the edited item in the model".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, parseBinarySlddParts, serializeEntryToXml } from 'data-explorer-core';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import { entrySelectorOf } from '../src/host/entrySelector.js';
import {
  addChildXml,
  deleteChildXml,
  deleteEntryXml,
  pasteEntryXml,
} from '../src/host/xmlStructuralEdit.js';
import {
  applyEntryOps,
  entryRecord,
  insertAnchorOf,
  insertOp,
  patchOfPairs,
  removeOp,
  replaceOp,
  type AppliedOp,
  type EntryOp,
  type EntryOpPair,
} from '../src/host/entryOps.js';
import { captureBaseline, computeModified, isEntryModified, clearBaseline } from '../src/host/slddBaseline.js';
import { buildRows, buildEntryRows } from '../src/host/rowBuilder.js';
import { spliceEntryRows, insertEntryRows } from '../src/webview/rowUpdates.js';
import { buildSectionRowId } from '../src/common/sectionRowId.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const bytes = readFileSync(
  fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url)),
);

function loadFixture() {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return { xml, meta };
}

// One open document, with the provider's two repaint paths side by side.
function openDoc(uri: string) {
  const srcId = 'binedit:' + uri;
  const { xml, meta } = loadFixture();
  clearBaseline(uri);
  DataModel.removeDataSource(srcId);
  const doc = { chunkXml: xml };

  // buildModel(): re-parse chunkXml and re-register. What post() does, and what an
  // edit is no longer allowed to do.
  const build = () => {
    DataModel.removeDataSource(srcId);
    return DataModel.addDataSource(srcId, parseBinarySlddParts(doc.chunkXml, meta), { path: 'params.sldd' });
  };
  // liveModel(): the tree as it already stands.
  const live = () => (DataModel as any).getDataSource(srcId) ?? build();

  captureBaseline(uri, build());

  // post(): the wide repaint — re-parse, diff every entry, rebuild every row.
  const widePaint = () => {
    const model = build();
    return buildRows(model, computeModified(uri, model));
  };
  // postEntry(): the narrow repaint — this entry's subtree, from the live model.
  const narrowPaint = (entry: any) => {
    const modified = new Set<string>();
    if (isEntryModified(uri, entry)) modified.add(entry.name);
    return buildEntryRows(entry, entry.parent.name, modified);
  };
  // The text half of an edit: replace the owning entry's <Object> with its
  // reserialization, addressed by the selector the entry had BEFORE the mutation.
  const spliceEntryText = (entry: any, selector: ReturnType<typeof entrySelectorOf>) => {
    const frag = serializeEntryToXml(entry).replace(/\n$/, '');
    const span = findEntryObjectSpan(doc.chunkXml, selector);
    expect(span, `the entry text for "${selector.name}" is locatable`).not.toBeNull();
    doc.chunkXml = doc.chunkXml.slice(0, span!.offset) + frag + doc.chunkXml.slice(span!.offset + span!.length);
  };

  const entryNamed = (name: string) =>
    (live() as any).children.flatMap((s: any) => s.children).find((e: any) => e.name === name);

  const dispose = () => {
    DataModel.removeDataSource(srcId);
    clearBaseline(uri);
  };

  return { doc, build, live, widePaint, narrowPaint, spliceEntryText, entryNamed, dispose };
}

// Every row the narrow paint produced must name a node the session can still find —
// the question the NEXT edit on that row asks.
function expectRowsResolve(rows: any[]): void {
  for (const row of rows) {
    expect((DataModel as any).findNodeById(row.ID), `row ${row.ID} resolves to a node`).toBeTruthy();
  }
}

/**
 * The webview's half of an op list: fold what the model ops produced into the rows that
 * are already on screen.
 *
 * This is the dispatch the table performs on the three narrow messages — `updateEntryRows`
 * for a replace or a remove, `insertEntryRows` for an insert — so a fold that cannot place
 * an op is the same failure the real view reports by asking for a full repaint.
 */
function foldOps(rows: any[], applied: AppliedOp[], paint: (entry: any) => any[]): any[] {
  let out = rows;
  for (const op of applied) {
    const next =
      op.kind === 'remove'
        ? spliceEntryRows(out, op.entryRowId, [])
        : op.kind === 'replace'
          ? spliceEntryRows(out, op.entryRowId, paint(op.entry))
          : insertEntryRows(
              out,
              buildSectionRowId(op.entry.parent.name),
              op.beforeRowId,
              paint(op.entry),
            );
    expect(next, `the ${op.kind} op lands in the rows on screen`).not.toBeNull();
    out = next!;
  }
  return out;
}

describe('binary .sldd entry-scoped repaint — narrow paint equals wide paint', () => {
  it('a value edit: spliced rows are identical to a full rebuild', () => {
    const d = openDoc('test://scoped-value.sldd');
    const onScreen = d.widePaint();
    const entry = d.entryNamed('scalarD');
    const entryRowId = entry.id;

    const applied = (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    expect(applied).toBe(true);
    d.spliceEntryText(entry, entrySelectorOf(entry));

    const narrow = spliceEntryRows(onScreen, entryRowId, d.narrowPaint(entry));
    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });

  it('a rename: spliced rows are identical to a full rebuild, and the new ids resolve', () => {
    const d = openDoc('test://scoped-rename.sldd');
    const onScreen = d.widePaint();
    const entry = d.entryNamed('scalarD');
    // Snapshotted BEFORE the mutation, both of them: the selector addresses the text as
    // it is still written, the row id addresses the run as it is still displayed.
    const selector = entrySelectorOf(entry);
    const entryRowId = entry.id;

    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Name', 'scalarRenamed'));
    d.spliceEntryText(entry, selector);

    const entryRows = d.narrowPaint(entry);
    expect(entryRows[0].ID).not.toBe(entryRowId);
    expectRowsResolve(entryRows);
    // And the id the table used to show this entry under is gone, so a stale row id
    // cannot route an edit at a node that has since moved.
    expect((DataModel as any).findNodeById(entryRowId)).toBeNull();

    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('a rename of an entry WITH children rekeys the children too', () => {
    // The case a per-node index patch gets wrong: nothing touched the bus elements, but
    // their ids are paths through the entry that was renamed.
    const d = openDoc('test://scoped-rename-children.sldd');
    const onScreen = d.widePaint();
    const bus = d.entryNamed('MyBus');
    expect(bus.children.length).toBeGreaterThan(0);
    const selector = entrySelectorOf(bus);
    const entryRowId = bus.id;
    const childIdsBefore = bus.children.map((c: any) => c.id);

    (DataModel as any).mutateSubtree(bus, () => bus.setProperty('Name', 'MyRenamedBus'));
    d.spliceEntryText(bus, selector);

    const entryRows = d.narrowPaint(bus);
    expect(entryRows.length).toBe(1 + bus.children.length);
    expectRowsResolve(entryRows);
    for (const stale of childIdsBefore) {
      expect((DataModel as any).findNodeById(stale)).toBeNull();
    }

    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('an edit on a nested child paints the whole entry subtree', () => {
    // The user's design: the update unit is the ENTRY, whatever depth the change was at,
    // so nothing has to track which rows inside an entry a change could have touched.
    const d = openDoc('test://scoped-child-value.sldd');
    const onScreen = d.widePaint();
    const struct = d.entryNamed('myStruct');
    const field = struct.children[0];
    const entryRowId = struct.id;

    (DataModel as any).mutateSubtree(struct, () => field.setProperty('Value', '7'));
    d.spliceEntryText(struct, entrySelectorOf(struct));

    const entryRows = d.narrowPaint(struct);
    expect(entryRows.map((r: any) => r.ID)).toContain(field.id);
    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('adding a child grows the entry run and the new row resolves', () => {
    const d = openDoc('test://scoped-add-child.sldd');
    const onScreen = d.widePaint();
    const bus = d.entryNamed('MyBus');
    const entryRowId = bus.id;
    const runBefore = onScreen.filter((r: any) => r.ID === entryRowId || r.parent === entryRowId).length;

    const { newText } = (DataModel as any).mutateSubtree(bus, () => addChildXml(d.doc.chunkXml, bus));
    d.doc.chunkXml = newText;

    const entryRows = d.narrowPaint(bus);
    expect(entryRows.length).toBe(runBefore + 1);
    // The child the user is about to be selected on, and may edit next.
    expectRowsResolve(entryRows);
    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('deleting a nested child shrinks the entry run and drops its id', () => {
    const d = openDoc('test://scoped-delete-child.sldd');
    const onScreen = d.widePaint();
    const bus = d.entryNamed('MyBus');
    const element = bus.children[0];
    const elementId = element.id;
    const entryRowId = bus.id;

    const { newText } = (DataModel as any).mutateSubtree(bus, () => deleteChildXml(d.doc.chunkXml, element));
    d.doc.chunkXml = newText;

    const entryRows = d.narrowPaint(bus);
    expect(entryRows.map((r: any) => r.ID)).not.toContain(elementId);
    // Not merely absent from the rows: gone from the index, so a row id left over in
    // some other view cannot route an edit into a detached node.
    expect((DataModel as any).findNodeById(elementId)).toBeNull();
    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });
});

describe('binary .sldd entry-scoped repaint — the Modified mark', () => {
  it('marks the edited entry, and only it', () => {
    const d = openDoc('test://scoped-modified.sldd');
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    d.spliceEntryText(entry, entrySelectorOf(entry));

    expect(d.narrowPaint(entry)[0].Status).toBe('Modified');
    const untouched = d.entryNamed('gravity');
    expect(d.narrowPaint(untouched)[0].Status).toBeFalsy();
    d.dispose();
  });

  it('stays marked when an entry is edited BACK to its saved value', () => {
    // Not the obvious answer, and worth pinning: the value round-trips exactly, but a
    // dictionary entry carries a lastModified stamp that every edit rewrites, so its
    // canonical JSON no longer matches the baseline and the entry is still, correctly,
    // modified with respect to the last SAVE. Both repaint paths agree on that.
    const uri = 'test://scoped-modified-back.sldd';
    const d = openDoc(uri);
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    const original = entry.toRow().Value;

    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    d.spliceEntryText(entry, entrySelectorOf(entry));
    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', String(original)));
    d.spliceEntryText(entry, entrySelectorOf(entry));

    expect(entry.toRow().Value).toBe(original);
    expect(d.narrowPaint(entry)[0].Status).toBe('Modified');
    expect(computeModified(uri, d.build())).toEqual(new Set(['scalarD']));
    d.dispose();
  });

  it('lets the caller CLEAR a mark the node itself is still carrying', () => {
    // The rule the narrow path needs and the wide path never did: `modifiedNames` is
    // authoritative in both directions. A node sets its own `status = 'Modified'` the
    // moment it is touched and never clears it (DataNode._markModified), and the wide
    // path was blind to that because it re-parsed and threw the mutated node away. The
    // narrow path keeps the node, so the baseline diff — which is what "Modified" MEANS
    // here — has to be able to overrule the node's own flag.
    //
    // The stamp above is why no end-to-end sequence reaches this today. It is pinned as
    // a unit rule rather than left to chance because the alternative is a row that stays
    // marked forever on the strength of a flag that answers a different question.
    const d = openDoc('test://scoped-modified-authoritative.sldd');
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    expect(entry.status).toBe('Modified');

    expect(buildEntryRows(entry, entry.parent.name, new Set<string>())[0].Status).toBe('');
    // ...and with no set at all the node's own status still shows through, which is what
    // a caller that has no baseline to diff against (before the first capture) reports.
    expect(buildEntryRows(entry, entry.parent.name)[0].Status).toBe('Modified');
    d.dispose();
  });

  it('is dropped by an undo that restores the pre-edit record', () => {
    // The mark answers "does this differ from the last SAVE", so an undo back to the saved
    // state has to clear it — and it does so through the same isEntryModified the edit
    // used, on an entry rebuilt from the record rather than re-read from the text.
    const uri = 'test://ops-modified-undo.sldd';
    const d = openDoc(uri);
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    const undoOps: EntryOp[] = [{ kind: 'replace', rowId: entry.id, record: entryRecord(entry) }];
    const beforeXml = d.doc.chunkXml;

    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    d.spliceEntryText(entry, entrySelectorOf(entry));
    expect(d.narrowPaint(entry)[0].Status).toBe('Modified');

    d.doc.chunkXml = beforeXml;
    const applied = applyEntryOps(d.live(), undoOps);
    expect(d.narrowPaint((applied[0] as any).entry)[0].Status).toBeFalsy();
    expect(computeModified(uri, d.build())).toEqual(new Set());
    d.dispose();
  });

  it('isEntryModified answers for one entry what computeModified answers for all', () => {
    // Two repaint paths ask the same question through different functions; if they can
    // disagree, a "Modified" dot appears or clears depending on which repaint the user
    // happened to trigger. They share differsFromBaseline for exactly this reason.
    const uri = 'test://scoped-modified-agree.sldd';
    const d = openDoc(uri);
    d.widePaint();
    const entry = d.entryNamed('MyBus');
    (DataModel as any).mutateSubtree(entry, () => entry.children[0].setProperty('Name', 'RenamedElement'));
    d.spliceEntryText(entry, entrySelectorOf(entry));

    const model = d.live() as any;
    const wide = computeModified(uri, model);
    for (const section of model.children) {
      for (const e of section.children) {
        expect(isEntryModified(uri, e), `${e.name}`).toBe(wide.has(e.name));
      }
    }
    expect(wide).toEqual(new Set(['MyBus']));
    d.dispose();
  });
});

// The other half of the same problem, and the one the user actually hit: an EDIT was fast
// but its UNDO took 5-9 s, because restoring the text was the whole edit and the repaint
// that followed re-parsed the dictionary to catch the model up. Undo, redo, delete, paste
// and drop now each state the entries they change as ops (entryOps.ts), applied to the live
// model and folded into the rows on screen.
//
// Same two invariants as above — NARROW === WIDE, and every painted row still RESOLVES —
// plus the two that only ops can get wrong: a redo must restore what its undo took away
// (not re-run the edit that produced it), and inverses must be replayed in reverse order.
//
// NOTE on ordering: `widePaint()` re-parses and RE-REGISTERS, which throws away the live
// tree these ops were built against. Every comparison against it therefore comes last in
// its step, and anything read from the model afterwards is re-fetched by name.
describe('binary .sldd entry ops — undo, redo, delete, paste', () => {
  it('undo and redo of a value edit are one replace op each', () => {
    const d = openDoc('test://ops-undo-value.sldd');
    const onScreen = d.widePaint();
    const entry = d.entryNamed('scalarD');
    const entryRowId = entry.id;
    const beforeXml = d.doc.chunkXml;
    const originalValue = entry.toRow().Value;

    // The edit, as applyEdit performs it: the pre-edit record is snapshotted first,
    // because this is the only moment that state exists.
    const undoOps: EntryOp[] = [{ kind: 'replace', rowId: entryRowId, record: entryRecord(entry) }];
    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    d.spliceEntryText(entry, entrySelectorOf(entry));
    const redoOps: EntryOp[] = [replaceOp(entry, entryRowId)];
    const afterXml = d.doc.chunkXml;
    const edited = foldOps(onScreen, [{ kind: 'replace', entryRowId, entry }], d.narrowPaint);
    expect(edited).toEqual(d.widePaint());

    // Undo: restore the text, then replay the inverse against the live model — no parse.
    d.doc.chunkXml = beforeXml;
    const undone = foldOps(edited, applyEntryOps(d.live(), undoOps), d.narrowPaint);
    expect(d.entryNamed('scalarD').toRow().Value).toBe(originalValue);
    expect(undone).toEqual(d.widePaint());

    // Redo: the recorded post-edit state, addressed by the id undo just put back.
    d.doc.chunkXml = afterXml;
    const redone = foldOps(undone, applyEntryOps(d.live(), redoOps), d.narrowPaint);
    expect(d.entryNamed('scalarD').toRow().Value).toBe('42');
    expect(redone).toEqual(d.widePaint());
    d.dispose();
  });

  it('undo of a rename addresses the POST-rename id and puts the old one back', () => {
    // The asymmetry that makes a rename its own case: each direction addresses the entry by
    // the id the OTHER one leaves behind. Get it backwards and the op resolves nothing, so
    // the undo silently falls back to the slow repaint it exists to avoid.
    const d = openDoc('test://ops-undo-rename.sldd');
    const onScreen = d.widePaint();
    const bus = d.entryNamed('MyBus');
    const oldId = bus.id;
    const selector = entrySelectorOf(bus);
    const beforeXml = d.doc.chunkXml;
    const undoRecord = entryRecord(bus);
    const childIds = bus.children.map((c: any) => c.id);
    expect(childIds.length).toBeGreaterThan(0);

    (DataModel as any).mutateSubtree(bus, () => bus.setProperty('Name', 'MyRenamedBus'));
    d.spliceEntryText(bus, selector);
    const newId = bus.id;
    expect(newId).not.toBe(oldId);
    const undoOps: EntryOp[] = [{ kind: 'replace', rowId: newId, record: undoRecord }];
    const renamed = foldOps(onScreen, [{ kind: 'replace', entryRowId: oldId, entry: bus }], d.narrowPaint);

    d.doc.chunkXml = beforeXml;
    const applied = applyEntryOps(d.live(), undoOps);
    // The rows on screen carry the renamed id, so that is the run the fold replaces.
    expect(applied[0]).toMatchObject({ kind: 'replace', entryRowId: newId });
    const undone = foldOps(renamed, applied, d.narrowPaint);
    // The rename's rekeying is undone for the entry AND for every descendant.
    expect((DataModel as any).findNodeById(newId)).toBeNull();
    expectRowsResolve([{ ID: oldId }, ...childIds.map((id: string) => ({ ID: id }))]);
    expect(undone).toEqual(d.widePaint());
    d.dispose();
  });

  it('deleting an entry and undoing it restores the same id at the same position', () => {
    // The user's bug, at entry granularity: a delete's undo has to put the entry back where
    // the restored TEXT says it is, or a later re-parse would reorder the table under them.
    const d = openDoc('test://ops-delete-undo.sldd');
    const onScreen = d.widePaint();
    const entry = d.entryNamed('gravity');
    const entryRowId = entry.id;
    const index = entry.parent.children.indexOf(entry);
    const beforeXml = d.doc.chunkXml;
    // Both directions are snapshotted while the entry is still attached: insertOp reads its
    // section and position from the tree.
    const patch = { undo: [insertOp(entry)], redo: [removeOp(entryRowId)] };

    const { newText } = deleteEntryXml(beforeXml, entry);
    d.doc.chunkXml = newText;
    const afterDelete = foldOps(onScreen, applyEntryOps(d.live(), patch.redo), d.narrowPaint);
    expect((DataModel as any).findNodeById(entryRowId)).toBeNull();
    expect(afterDelete).toEqual(d.widePaint());

    d.doc.chunkXml = beforeXml;
    const restored = foldOps(afterDelete, applyEntryOps(d.live(), patch.undo), d.narrowPaint);
    const back = d.entryNamed('gravity');
    expect(back.id).toBe(entryRowId);
    expect(back.parent.children.indexOf(back)).toBe(index);
    expect(restored).toEqual(d.widePaint());
    d.dispose();
  });

  it('a paste inserts one entry run, and its redo keeps the pasted name and uuid', () => {
    // Why an op carries a RECORD and not the edit that made it: pasting again would mint
    // another uuid and another unique name, so a "redo" would add a third entry rather than
    // restore the one undo took away.
    const d = openDoc('test://ops-paste.sldd');
    const onScreen = d.widePaint();
    const model = d.live();
    const section = (model.children as any[]).find((s) => s.name === 'design');
    const payload = entryRecord(d.entryNamed('gravity')); // what a copy puts on the clipboard
    const beforeXml = d.doc.chunkXml;

    // Exactly applyPaste's shape: the paste attaches the new entry itself, appending, so
    // the tail past this count is what it added.
    const addedFrom = section.children.length;
    const { newText } = pasteEntryXml(beforeXml, section, payload);
    d.doc.chunkXml = newText;
    const pairs: EntryOpPair[] = [];
    const applied: AppliedOp[] = [];
    for (const fresh of (section.children as any[]).slice(addedFrom)) {
      DataModel.indexSubtree(fresh);
      pairs.push({ redo: insertOp(fresh), undo: removeOp(fresh.id) });
      applied.push({ kind: 'insert', entry: fresh, beforeRowId: insertAnchorOf(fresh) });
    }
    expect(applied.length).toBe(1);
    const pasted = (applied[0] as any).entry;
    const pastedName = pasted.name;
    const pastedUuid = pasted.metadata.uuid;
    expect(pastedName).not.toBe('gravity'); // uniquified across the namespace
    expect(pastedUuid).not.toBe((payload.metadata as any).uuid); // and a distinct object
    // Appended, so it is its section's last entry and there is no row to insert before.
    expect((applied[0] as any).beforeRowId).toBeUndefined();

    const withPaste = foldOps(onScreen, applied, d.narrowPaint);
    expectRowsResolve(d.narrowPaint(pasted));
    expect(withPaste).toEqual(d.widePaint());

    const patch = patchOfPairs(pairs);
    d.doc.chunkXml = beforeXml;
    const undone = foldOps(withPaste, applyEntryOps(d.live(), patch.undo), d.narrowPaint);
    expect(d.entryNamed(pastedName)).toBeUndefined();
    expect(undone).toEqual(d.widePaint());

    d.doc.chunkXml = newText;
    const redone = foldOps(undone, applyEntryOps(d.live(), patch.redo), d.narrowPaint);
    const again = d.entryNamed(pastedName);
    expect(again.metadata.uuid).toBe(pastedUuid);
    expect(redone).toEqual(d.widePaint());
    d.dispose();
  });

  // A same-document move is [remove source, insert copy], and the copy keeps the name the
  // source gave up — so at the moment of the undo, that ONE name has two candidate owners.
  // Order is the only thing keeping them apart.
  describe('a move that reclaims a name', () => {
    // Remove `gravity`, then re-insert a copy of it that keeps the name but carries its own
    // uuid (what prepareEntryForPaste mints). Returns the pair list the provider would push.
    const setUp = (uri: string) => {
      const d = openDoc(uri);
      d.widePaint();
      const model = d.live();
      const src = d.entryNamed('gravity');
      const section = src.parent;
      const srcId = src.id;
      const srcUuid = src.metadata.uuid;
      const copyRecord = entryRecord(src);
      (copyRecord.metadata as any).uuid = 'copy-uuid';

      const pairs: EntryOpPair[] = [{ redo: removeOp(srcId), undo: insertOp(src) }];
      applyEntryOps(model, [pairs[0].redo]);
      const insert: EntryOp = { kind: 'insert', sectionName: section.name, index: -1, record: copyRecord };
      const copy = (applyEntryOps(model, [insert])[0] as any).entry;
      pairs.push({ redo: insertOp(copy), undo: removeOp(copy.id) });
      // The point of the exercise: one id, and for now the copy is what answers to it.
      expect(copy.id).toBe(srcId);
      expect((DataModel as any).findNodeById(srcId).metadata.uuid).toBe('copy-uuid');
      return { d, model, section, srcId, pairs, srcUuid };
    };

    const gravities = (section: any) =>
      (section.children as any[]).filter((e) => e.name === 'gravity').map((e) => e.metadata.uuid);

    it('undoes correctly with the inverses REVERSED, as patchOfPairs orders them', () => {
      const { d, model, section, srcId, pairs, srcUuid } = setUp('test://ops-reclaim-reverse.sldd');
      const patch = patchOfPairs(pairs);
      expect(patch.undo.map((o) => o.kind)).toEqual(['remove', 'insert']);

      applyEntryOps(model, patch.undo);
      // One owner of the name, and it is the original — indexed, so the next edit finds it.
      expect(gravities(section)).toEqual([srcUuid]);
      expect((DataModel as any).findNodeById(srcId).metadata.uuid).toBe(srcUuid);
      d.dispose();
    });

    it('does NOT undo correctly with the inverses in forward order', () => {
      // Pinned as the reason patchOfPairs reverses: inserting the source while the copy is
      // still standing puts two entries under one id, and the remove that follows resolves
      // to whichever was indexed last — the source it just restored. The copy survives in
      // its place, unindexed, and the table shows an entry no edit can address.
      const { d, model, section, srcId, pairs, srcUuid } = setUp('test://ops-reclaim-forward.sldd');
      applyEntryOps(model, pairs.map((p) => p.undo)); // NOT reversed
      expect(gravities(section)).toEqual(['copy-uuid']);
      expect(srcUuid).not.toBe('copy-uuid');
      expect((DataModel as any).findNodeById(srcId)).toBeNull();
      d.dispose();
    });
  });

  it('throws rather than guessing when an op cannot be resolved', () => {
    // The safety property the whole design rests on: a narrow path that cannot be sure
    // hands the caller a throw, and the caller repaints wide from the text — which is
    // already correct. Guessing would leave the table describing a file that does not exist.
    const d = openDoc('test://ops-unresolvable.sldd');
    d.widePaint();
    const model = d.live();
    const entry = d.entryNamed('scalarD');
    const record = entryRecord(entry);
    const inventory = () => (model.children as any[]).map((s) => s.children.map((e: any) => e.name));
    const before = inventory();

    expect(() => applyEntryOps(model, [{ kind: 'replace', rowId: 'no/such/row', record }])).toThrow(
      /No entry is indexed/,
    );
    // A row inside an entry is not an entry: only whole entries are op-addressable.
    expect(() => applyEntryOps(model, [removeOp(d.entryNamed('MyBus').children[0].id)])).toThrow(
      /not a top-level entry/,
    );
    // A section that this dictionary does not have.
    expect(() =>
      applyEntryOps(model, [{ kind: 'insert', sectionName: 'nope', index: 0, record }]),
    ).toThrow(/no "nope" section/);
    expect(inventory()).toEqual(before);
    d.dispose();
  });

  it('refuses an op that resolves into ANOTHER tree of the same document', () => {
    // A wide repaint re-registers the source under the same srcId, so every id now names a
    // node in a brand-new object graph. An op applied to the tree it was BUILT against would
    // mutate something nothing paints — and the table would keep showing the old rows.
    const d = openDoc('test://ops-stale-tree.sldd');
    d.widePaint();
    const stale = d.live();
    const entry = d.entryNamed('scalarD');
    const op = replaceOp(entry, entry.id);

    d.build(); // what the wide path does
    expect(() => applyEntryOps(stale, [op])).toThrow(/belongs to another model/);
    // The same op against the tree that IS registered applies cleanly.
    expect(() => applyEntryOps(d.live(), [op])).not.toThrow();
    d.dispose();
  });
});
