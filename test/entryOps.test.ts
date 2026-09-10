// Copyright 2026 The MathWorks, Inc.
//
// What entryOps does when it CANNOT be sure.
//
// The happy paths of this module are already pinned end to end, against real dictionaries,
// by the two narrow-repaint suites — binaryEntryScopedEdit.test.ts and
// jsonStructuralNarrow.test.ts. They answer "does an op restore what it said it would".
// This file answers the other half, which is the half that costs a user their data: an op
// that CANNOT be applied must refuse, by name, before it has touched the model. Every
// caller wraps these in a try and answers a throw with the wide repaint — a re-parse of
// text that is already correct — so a refusal costs a few seconds and nothing else. Any
// other outcome is a table describing a file that does not exist, or a model with a hole
// in it that the undo stack cannot fill.
//
// Three properties, and each has a concrete failure behind it:
//
//  1. AN OP IS CAPTURED WHILE THE ENTRY IS STILL ATTACHED. `insertOp` reads the entry's
//     section and position out of the tree, so capturing it one line after the removal it
//     is the inverse of yields an op that names no section at all. That op must fail
//     loudly rather than land the entry in whichever section the model happens to list
//     first — an undo that moves a variable from Configurations into Design Data has
//     silently rewritten the user's dictionary.
//
//  2. A LOOKUP THAT CANNOT SETTLE ON ONE ENTRY ANSWERS NOTHING. A cross-document move
//     deletes its source by NAME, because that is all a clipboard payload carries, and one
//     .sldd holds several namespaces — so two entries legitimately answer to one name. The
//     uuid is the tie-breaker; when it settles nothing, the answer is null and the caller
//     falls back. Guessing here deletes an entry the user never touched.
//
//  3. A RECORD THAT WILL NOT REBUILD LEAVES THE LIVE ENTRY ALONE. `replace` parses the
//     record BEFORE it detaches the entry the record is replacing. Reversed — or with the
//     falsy-node guard gone — the section ends up holding `undefined` where the user's
//     entry was: every later row build, flatten and save walks into it, and the entry it
//     replaced has already been unindexed and dropped.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, parseBinarySlddParts } from 'data-explorer-core';
import {
  applyEntryOps,
  entryRecord,
  findEntryBySelector,
  insertAnchorOf,
  insertOp,
  opsOfPastedEntries,
  removeOp,
  type EntryOp,
} from '../src/host/entryOps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const bytes = readFileSync(
  fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url)),
);

/** One registered dictionary, as a provider's `liveModel()` hands it to these ops. */
function openModel(srcId: string) {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  DataModel.removeDataSource(srcId);
  const model = DataModel.addDataSource(srcId, parseBinarySlddParts(xml, meta), {
    path: 'params.sldd',
  }) as any;
  const entryNamed = (name: string) =>
    (model.children as any[]).flatMap((s: any) => s.children).find((e: any) => e.name === name);
  /** Every section's entry names, in order — what a wrongly-applied op disturbs. */
  const inventory = () => (model.children as any[]).map((s: any) => s.children.map((e: any) => e.name));
  return { model, entryNamed, inventory, dispose: () => DataModel.removeDataSource(srcId) };
}

// --------------------------------------------------------------- PROPERTY 1 ---

describe('insertOp — the moment of capture is part of the op', () => {
  it('describes a detached entry as belonging to no section, so its undo refuses instead of guessing', () => {
    const d = openModel('test://ops-insert-capture-order.sldd');
    const entry = d.entryNamed('gravity');
    const section = entry.parent;
    const index = section.children.indexOf(entry);
    const before = d.inventory();

    // The order every caller uses: state the inverse while the entry is still in the tree.
    const captured = insertOp(entry);
    DataModel.unindexSubtree(entry, () => section.removeChild(entry));
    // And the same call one line too late, which is the mistake this guard is about.
    const tooLate = insertOp(entry);

    expect(captured).toMatchObject({ kind: 'insert', sectionName: section.name, index });
    expect((tooLate as any).sectionName, 'a detached entry can name no section').toBe('');
    expect((tooLate as any).index, 'and no position inside one').toBe(-1);

    // The late op names a section no dictionary has, so it throws — and a throw is the
    // caller's wide repaint. Answering with a real section instead would put the entry
    // back in the wrong namespace, where its name may not even be unique.
    expect(() => applyEntryOps(d.model, [tooLate])).toThrow(/no "" section/);
    expect(d.inventory(), 'the refused op changed nothing').toEqual(
      before.map((names: string[]) => names.filter((n) => n !== 'gravity')),
    );

    // The op captured at the right moment puts the entry back where it was.
    applyEntryOps(d.model, [captured]);
    expect(d.inventory()).toEqual(before);
    d.dispose();
  });
});

describe('insertAnchorOf — the row a newly attached entry goes before', () => {
  it('names the next entry, and nothing at all for one with no section to look in', () => {
    // The insert op and the host's paste both ask this, and they must get the SAME answer
    // or the narrow insert and the wide rebuild disagree about where the entry sits.
    // `undefined` is "last in its section", which is where a paste lands.
    const d = openModel('test://ops-insert-anchor.sldd');
    const section = (d.model.children as any[]).find((s: any) => s.children.length >= 2);
    expect(section, 'the fixture has a section with two entries').toBeTruthy();
    const first = section.children[0];
    const last = section.children[section.children.length - 1];

    expect(insertAnchorOf(first)).toBe(section.children[1].id);
    expect(insertAnchorOf(last)).toBeUndefined();

    // An entry that is not in the tree has no siblings to consult, so there is no row to
    // anchor to — it answers "last" rather than throwing, because the caller that asks is
    // in the middle of describing a repaint and a throw there loses the whole edit.
    DataModel.unindexSubtree(first, () => section.removeChild(first));
    expect(insertAnchorOf(first)).toBeUndefined();
    d.dispose();
  });
});

// --------------------------------------------------------------- PROPERTY 2 ---

describe('findEntryBySelector — the entry a clipboard or drag payload means', () => {
  const model = (...entries: Array<[string, string]>) => ({
    children: [
      { name: 'design', children: entries.map(([name, uuid]) => ({ name, metadata: { uuid } })) },
    ],
  });

  it('answers nothing when two entries share a name and the uuid names neither of them', () => {
    // A payload captured in ANOTHER document, whose uuid belongs to that document's copy.
    // Two candidates here, and nothing to choose between them: the move must not delete
    // one of the user's entries on a coin toss.
    const m = model(['Array', 'in-design'], ['Array', 'in-other-data']);
    expect(findEntryBySelector(m, { name: 'Array', uuid: 'from-another-file' })).toBeNull();
  });

  it('answers nothing when two entries share a name AND the uuid, rather than taking the first', () => {
    // Reachable by hand: the text view lets a user duplicate an entry wholesale, uuid
    // included. The uuid stops being a tie-breaker, so there is again no single answer.
    const m = model(['Array', 'same-uuid'], ['Array', 'same-uuid']);
    expect(findEntryBySelector(m, { name: 'Array', uuid: 'same-uuid' })).toBeNull();
  });

  it('answers nothing for a model that is not there, instead of throwing', () => {
    // Both finders are reached from a lookup that can come back empty (a document whose
    // parse failed, a source no longer registered), and both must degrade to the caller's
    // fallback the same way — `findEntryByName` is pinned for this beside its own tests.
    // A throw from here escapes into a clipboard/drag handler that has no fallback.
    expect(findEntryBySelector(null, 'Array')).toBeNull();
    expect(findEntryBySelector(undefined, { name: 'Array', uuid: '1' })).toBeNull();
    // ...and for a section holding no entry list at all, which is what an empty or
    // half-parsed dictionary looks like from here.
    expect(findEntryBySelector({ children: [{ name: 'design' }] }, 'Array')).toBeNull();
  });
});

// --------------------------------------------------------------- PROPERTY 3 ---

describe('the refusals that hand the caller its wide repaint', () => {
  it('refuses a record its section cannot rebuild, and leaves the live entry standing', () => {
    // The ordering `replaceEntry` promises: build first, detach second. A section that
    // cannot rebuild the record is stubbed here because the real SectionNode.parseEntry
    // always answers with SOME node (its matcher chain falls through to a MATLAB
    // variable) — so this pins the module's own refusal, and what it protects. Without
    // it, `addChild(undefined)` puts a hole where the user's entry was, AFTER the entry
    // has been unindexed and dropped: the row cannot be repainted, the next edit on it
    // cannot resolve, and the undo stack has nothing left to restore from.
    const d = openModel('test://ops-unparseable-record.sldd');
    const entry = d.entryNamed('scalarD');
    const section = entry.parent;
    const rowId = entry.id;
    const index = section.children.indexOf(entry);
    const op: EntryOp = { kind: 'replace', rowId, record: entryRecord(entry) };

    const real = section.parseEntry.bind(section);
    section.parseEntry = () => null;
    try {
      expect(() => applyEntryOps(d.model, [op])).toThrow(/Could not rebuild entry "scalarD"/);
    } finally {
      section.parseEntry = real;
    }

    expect(section.children.indexOf(entry), 'the live entry is still in its slot').toBe(index);
    expect(section.children.every((e: any) => !!e), 'no hole was spliced into the section').toBe(true);
    expect((DataModel as any).findNodeById(rowId), 'and it still resolves for the next edit').toBe(entry);
    d.dispose();
  });

  it('names the entry it could not rebuild as empty when the record has no name', () => {
    // The message is what reaches the log when a fallback fires, and it is all anyone has
    // to tell which entry the op was about. A record with no name must still produce a
    // sentence, not the word "undefined".
    const d = openModel('test://ops-unparseable-nameless.sldd');
    const entry = d.entryNamed('scalarD');
    const section = entry.parent;
    const record = entryRecord(entry);
    delete record.name;

    const real = section.parseEntry.bind(section);
    section.parseEntry = () => null;
    try {
      expect(() =>
        applyEntryOps(d.model, [{ kind: 'insert', sectionName: section.name, index: -1, record }]),
      ).toThrow(/Could not rebuild entry ""/);
    } finally {
      section.parseEntry = real;
    }
    d.dispose();
  });

  it('refuses an op whose node the index still hands out after something detached it', () => {
    // The index and the tree can disagree in one direction only: a detach that forgot to
    // unindex leaves `findNodeById` answering with a node that has left the dictionary.
    // Applying an op there would mutate an orphan — the change would look applied, paint
    // nothing, and vanish on save. So the op refuses, by name, and the caller repaints
    // from the text. (`isEntry` is "my parent is a container", which is why a detached
    // node is caught as "not a top-level entry" rather than by the detached check below
    // it: the two guards overlap on purpose, and the outer one always wins.)
    const d = openModel('test://ops-detached-but-indexed.sldd');
    const entry = d.entryNamed('gravity');
    const rowId = entry.id; // read while attached: an id is a PATH, so it shortens on detach
    const before = d.inventory();
    entry.parent.removeChild(entry); // the mistake: no DataModel.unindexSubtree
    expect((DataModel as any).findNodeById(rowId), 'the index is now stale').toBe(entry);

    expect(() => applyEntryOps(d.model, [removeOp(rowId)])).toThrow(/not a top-level entry/);
    expect(d.inventory()).toEqual(
      before.map((names: string[]) => names.filter((n) => n !== 'gravity')),
    );
    d.dispose();
  });

  it('refuses an op applied to no model at all, with the error the fallback expects', () => {
    // `applyEntryOps` takes whatever the provider's model lookup returned. When that is
    // nothing, an insert has to arrive as the same named throw as any other unresolvable
    // op — a TypeError from reading `.children` of null would be caught by the same try,
    // but it is indistinguishable from a bug in the op itself.
    const d = openModel('test://ops-no-model.sldd');
    const record = entryRecord(d.entryNamed('gravity'));
    const op: EntryOp = { kind: 'insert', sectionName: 'design', index: 0, record };
    expect(() => applyEntryOps(null, [op])).toThrow(/no "design" section/);
    expect(() => applyEntryOps(undefined, [op])).toThrow(/no "design" section/);
    d.dispose();
  });
});

describe('opsOfPastedEntries — the ops for entries the paste already attached', () => {
  it('yields no ops and no repaint when the paste attached nothing', () => {
    // `addedFrom` is the child count read before the transform, so equality means the
    // paste added nothing — a payload the section rejected. Nothing may then be pushed
    // onto the undo stack and nothing painted: an empty op list is how the caller learns
    // that, and an undo op for an entry that was never added would delete a neighbour.
    const d = openModel('test://ops-paste-nothing.sldd');
    const section = (d.model.children as any[])[0];
    expect(opsOfPastedEntries(section, section.children.length)).toEqual({ pairs: [], applied: [] });
    // Same answer for a section that is not there, rather than a throw out of a paste
    // handler: a paste with no target section cannot have added anything either.
    expect(opsOfPastedEntries(null, 0)).toEqual({ pairs: [], applied: [] });
    d.dispose();
  });
});

// A closing sanity check on the ops these refusals sit between: the positive control for
// the capture-order test above, so a change that makes EVERY op throw cannot pass this file.
describe('the ops that do resolve still apply', () => {
  it('removes and re-inserts the same entry at the same position', () => {
    const d = openModel('test://ops-round-trip.sldd');
    const entry = d.entryNamed('gravity');
    const before = d.inventory();
    const rowId = entry.id;
    const undo = insertOp(entry);

    applyEntryOps(d.model, [removeOp(rowId)]);
    expect((DataModel as any).findNodeById(rowId)).toBeNull();

    const applied = applyEntryOps(d.model, [undo]);
    expect(applied[0]).toMatchObject({ kind: 'insert' });
    expect(d.inventory()).toEqual(before);
    expect((DataModel as any).findNodeById(rowId)).toBeTruthy();
    d.dispose();
  });
});
