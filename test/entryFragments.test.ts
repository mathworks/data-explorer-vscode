// Copyright 2026 The MathWorks, Inc.
//
// An undo or redo of a binary .sldd edit rebuilds the entries it changes from the `<Object>` text
// the chunk it restores holds for them (entryOps' EntryFragment), so an undone entry keeps the
// bytes it came from: the maintainer's D12, kept across undo and redo.
//
// BinarySlddEditorProvider cuts each op's fragment out of the restored chunk (cutFragments) and
// hands the ops to applyEntryOps. What that buys is only visible at the NEXT save: an entry that
// still has the bytes it was read from can be held to them by the save gate, and one rebuilt from
// its record has nothing to be held to, so the gate refuses the edit after it as one it cannot
// check. That is the invariant pinned here, between the undo path and the save gate, together
// with the rule that keeps a fragment from doing harm: one that does not read as exactly the
// entry its record names is dropped, and the record rebuilds the entry, with nothing left behind.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, DATA_PART_XML, entrySelectorOf, keptPartsViolations, spliceEntryObject } from 'data-explorer-core';
import { savedChunkRefusal, SavedChunk } from '../src/host/binarySaveGate.js';
import { entryKey, scanChunkEntries } from '../src/host/chunkEntries.js';
import {
  applyEntryOps,
  entryRecord,
  mutateEntry,
  patchOfPairs,
  removeEntries,
  type EntryOp,
} from '../src/host/entryOps.js';
import { readSlddParts } from 'data-explorer-view/model';

/* eslint-disable @typescript-eslint/no-explicit-any */

const zip = unzipSync(
  new Uint8Array(readFileSync(fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url)))),
);
const XML = new TextDecoder().decode(zip[DATA_PART_XML]);
const META: Record<string, Uint8Array> = {};
for (const [k, v] of Object.entries(zip)) if (k !== DATA_PART_XML) META[k] = v;

const registered: string[] = [];
let opened = 0;

function open(xml = XML) {
  const srcId = `binedit:test://fragments-${opened++}.sldd`;
  registered.push(srcId);
  const model: any = DataModel.addDataSource(srcId, readSlddParts(xml, META, []), { path: 'params.sldd' });
  const entry = (name: string) =>
    (model.children as any[]).flatMap((s: any) => s.children as any[]).find((e: any) => e.name === name);
  return { srcId, model, entry };
}

afterEach(() => {
  for (const srcId of registered.splice(0)) DataModel.removeDataSource(srcId);
});

/** What cutFragments gives an op: the entry's `<Object>…</Object>` in the chunk it restores. */
function cut(chunk: string, name: string): string {
  const e = scanChunkEntries(chunk).entries.find((x) => x.name === name)!;
  return chunk.slice(e.start, e.end);
}

const keyOf = (node: any) => entryKey(node.name, node.metadata?.uuid);
const armed = (node: any) => keptPartsViolations(node, '').length > 0;

/** A cell edit as the provider makes it, returning the chunk after and the undo op it pushes. */
function editDescription(chunk: string, node: any, value: string) {
  const before = entryRecord(node);
  const selector = entrySelectorOf(node);
  mutateEntry(node, () => node.setProperty('Description', value));
  const after = spliceEntryObject(chunk, node, selector)!;
  expect(after).not.toBeNull();
  const undo: EntryOp = { kind: 'replace', rowId: node.id, record: before };
  return { after, undo };
}

describe('an undo rebuilt from its fragment keeps the bytes, so the next edit can be checked', () => {
  it('a replace with the fragment is the entry as read: written as its bytes, and the gate holds it to them', () => {
    const d = open();
    const gravity = d.entry('gravity');
    const section = gravity.parent;
    const index = section.children.indexOf(gravity);
    const { after, undo } = editDescription(XML, gravity, 'g');

    // Undo: the chunk is the text before the edit again, and the op rebuilds from it.
    const op = { ...undo, fragment: cut(XML, 'gravity') } as EntryOp;
    const [applied] = applyEntryOps(d.model, [op]) as any[];
    const fresh = applied.entry;
    expect(fresh.name).toBe('gravity');
    expect(section.children.indexOf(fresh)).toBe(index);
    expect(spliceEntryObject(after, fresh)).toBe(XML);
    expect(armed(fresh)).toBe(true);

    // The edit after the undo is merged with those bytes, and the gate passes it.
    const { after: again } = editDescription(XML, fresh, 'h');
    expect(savedChunkRefusal(new SavedChunk(XML), again, new Set([keyOf(fresh)]), d.model)).toBeNull();
  });

  it('(control) the same undo from its record alone leaves the next edit uncheckable, and refused', () => {
    // Why the provider cuts fragments at all. Rebuilt from the record, the entry reads the same
    // and is even written the same while nothing edits it, but it has no bytes it was read from,
    // so the next edit writes it whole from the model and the gate cannot vouch for that.
    const d = open();
    const gravity = d.entry('gravity');
    const { after, undo } = editDescription(XML, gravity, 'g');
    const [applied] = applyEntryOps(d.model, [{ ...undo, fragment: null } as EntryOp]) as any[];
    const fresh = applied.entry;
    expect(spliceEntryObject(after, fresh)).toBe(XML);
    expect(armed(fresh)).toBe(false);

    const { after: again } = editDescription(XML, fresh, 'h');
    expect(savedChunkRefusal(new SavedChunk(XML), again, new Set([keyOf(fresh)]), d.model)).toMatch(
      /^Refusing to save: the edit to entry "gravity" cannot be checked/,
    );
  });

  it('an insert with the fragment (the undo of a delete) is back at its place, with its bytes', () => {
    const d = open();
    const u8 = d.entry('u8Scalar');
    const section = u8.parent;
    const index = section.children.indexOf(u8);
    const removal = removeEntries(d.model, [u8]);
    expect(d.entry('u8Scalar')).toBeUndefined();

    const undo = patchOfPairs(removal.pairs).undo.map((op) => ({ ...op, fragment: cut(XML, 'u8Scalar') }) as EntryOp);
    const [applied] = applyEntryOps(d.model, undo) as any[];
    expect(applied.kind).toBe('insert');
    const fresh = applied.entry;
    expect(section.children.indexOf(fresh)).toBe(index);
    expect(spliceEntryObject(XML, fresh)).toBe(XML);
    expect(armed(fresh)).toBe(true);
    const selector = entrySelectorOf(fresh);
    mutateEntry(fresh, () => fresh.setProperty('Value', '7'));
    const edited = spliceEntryObject(XML, fresh, selector)!;
    expect(savedChunkRefusal(new SavedChunk(XML), edited, new Set([keyOf(fresh)]), d.model)).toBeNull();
  });
});

describe('a fragment that is not the record’s entry is dropped, and the record rebuilds it', () => {
  const cases: [string, (fragment: string) => string][] = [
    ['another entry’s text (a cut from the wrong span)', () => cut(XML, 'scalarD')],
    ['the entry’s name with another UUID', (f) => f.replace(/(<P Name="UUID" Class="char">)[^<]+/, '$1not-the-uuid')],
    ['text that does not read as an entry', () => '<Object Class="DD.ENTRY"><P Name="Name"'],
    ['an empty fragment', () => ''],
  ];
  for (const [what, fragmentOf] of cases) {
    it(what, () => {
      const d = open();
      const gravity = d.entry('gravity');
      const section = gravity.parent;
      const names = (section.children as any[]).map((e) => e.name);
      const { undo } = editDescription(XML, gravity, 'g');
      const [applied] = applyEntryOps(d.model, [{ ...undo, fragment: fragmentOf(cut(XML, 'gravity')) } as EntryOp]) as any[];
      // The record's entry, in its slot, and no node the fragment read is left in the section.
      expect(applied.entry.name).toBe('gravity');
      expect(applied.entry.metadata.uuid).toBe(gravity.metadata.uuid);
      expect((section.children as any[]).map((e) => e.name)).toEqual(names);
      expect(armed(applied.entry)).toBe(false);
      // And what it rebuilt is the state before the edit, which the record holds.
      expect(spliceEntryObject(XML, applied.entry)).toBe(XML);
    });
  }
});

describe('removeEntries refuses a node from a tree that has been replaced', () => {
  it('names the entry, and removes nothing from either tree', () => {
    // A re-read registers a new tree under the same srcId, with all the same ids: a node the
    // caller still holds from the old one is not the one the index hands out for its id.
    const d = open();
    const stale = d.entry('gravity');
    const fresh: any = DataModel.addDataSource(d.srcId, readSlddParts(XML, META, []), { path: 'params.sldd' });
    const count = (m: any) => (m.children as any[]).reduce((n, s) => n + s.children.length, 0);
    expect(() => removeEntries(fresh, [stale])).toThrow(/is not the one indexed under its id/);
    expect(count(fresh)).toBe(40);
    expect(count(d.model)).toBe(40);
  });
});
