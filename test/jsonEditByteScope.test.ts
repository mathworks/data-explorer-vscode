// Copyright 2026 The MathWorks, Inc.
//
// Every write to a JSON .sldd hits exactly the entry it aimed at — for EVERY entry of a real
// fixture, not just the one an example happened to pick.
//
// The finders that decide which bytes an edit overwrites (entrySplice.ts) resolve a selector
// against a scanned index of the entries array rather than a jsonc parse tree. The scan is
// 7x cheaper, and the whole risk of that trade sits in one place: an index that named the
// wrong element would make a cell edit, a rename or a delete rewrite an entry the user never
// touched. entrySpliceScan.test.ts pins the index against jsonc-parser's tree; this pins the
// consequence, at the only level that matters — the bytes of the document afterwards.
//
// The sweeps below deliberately avoid `serialize()`/`setProperty` and splice a synthetic
// marker instead, so a failure means the SPAN was wrong and cannot mean the model
// round-tripped a value oddly. The real model paths are covered on top of that
// (editWriteback.test.ts for a cell edit and a rename, structuralEdit.test.ts and
// cutPasteEndToEnd.test.ts for the structural edits).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findEntrySpan, findEntryElementSpan, findEntriesArrayInsertion } from '../src/host/entrySplice.js';
import { entrySelectorOf } from '../src/host/entrySelector.js';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { deleteEntry } from '../src/host/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURES: Array<{ label: string; text: string }> = [
  {
    label: 'workspace/data.sldd',
    text: readFileSync(
      fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
      'utf8',
    ),
  },
  {
    label: 'numeric_json.sldd',
    text: readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'),
  },
];

/** The entries array as JSON.parse reads it — the document's own account, not ours. */
function entriesOf(text: string): any[] {
  const root = JSON.parse(text);
  return root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
}

/** Every top-level entry node of the model built from `text`, in document order. */
function entryNodes(uri: string, label: string, text: string): any[] {
  invalidate(uri);
  const model = getModel(uri, label, text);
  return (model.children ?? []).flatMap((section: any) => section.children ?? []);
}

for (const { label, text } of FIXTURES) {
  describe(`one edit, one entry — ${label}`, () => {
    const before = entriesOf(text);

    it('has enough entries to make the sweeps meaningful', () => {
      expect(before.length).toBeGreaterThan(3);
      // Names really are the thing being resolved, so they must all be present.
      expect(before.every((e) => typeof e.name === 'string' && e.name.length > 0)).toBe(true);
    });

    // A cell edit and a rename both replace the owning entry's `{...}` span with its
    // reserialized text. Whatever they write, the span they write it into must be this
    // entry's and no part of any other.
    it('replacing each entry’s span leaves every other entry byte-for-byte intact', () => {
      before.forEach((entry, i) => {
        const span = findEntrySpan(text, entry.name);
        expect(span, `span of "${entry.name}"`).not.toBeNull();
        const marker = JSON.stringify({ name: entry.name, __probe__: i });
        const after = text.slice(0, span!.offset) + marker + text.slice(span!.offset + span!.length);

        const now = entriesOf(after); // throws if the splice broke the JSON
        expect(now.length, `entry count after editing "${entry.name}"`).toBe(before.length);
        expect(now[i], `the edited element "${entry.name}"`).toEqual({ name: entry.name, __probe__: i });
        now.forEach((el, j) => {
          if (j !== i) expect(el, `"${before[j].name}" while editing "${entry.name}"`).toEqual(before[j]);
        });
      });
    });

    // The delete path removes the element AND the one comma joining it to a sibling, so it
    // is the edit with the most room to take a neighbour with it — including at the two
    // positions where the comma it removes is on the other side (first and last).
    it('deleting each entry removes only that entry', () => {
      before.forEach((entry, i) => {
        const span = findEntryElementSpan(text, entry.name);
        expect(span, `element span of "${entry.name}"`).not.toBeNull();
        const after = text.slice(0, span!.offset) + text.slice(span!.offset + span!.length);

        const now = entriesOf(after);
        expect(now.map((e) => e.name)).toEqual(before.filter((_, j) => j !== i).map((e) => e.name));
        now.forEach((el, j) => expect(el).toEqual(before[j < i ? j : j + 1]));
      });
    });

    // The same sweep through the real structural path, which resolves by SELECTOR (name plus
    // the metadata uuid as a tiebreak) off a live model node rather than a bare name.
    it('the model-driven delete removes only the entry whose node it was given', () => {
      const nodes = entryNodes(`test://scope-delete-${label}.sldd`, label, text);
      expect(nodes.length).toBe(before.length);
      nodes.forEach((node) => {
        const { uuid } = entrySelectorOf(node.serialize());
        // What the document should read afterwards, decided from the document itself: every
        // element except the one this node IS (by uuid, its rename-stable identity).
        const expected = before.filter((e) => (uuid ? e.metadata?.uuid !== uuid : e.name !== node.name));
        expect(expected.length, `"${node.name}" identifies exactly one element`).toBe(before.length - 1);

        const { newText } = deleteEntry(text, node);
        expect(entriesOf(newText), `after deleting "${node.name}"`).toEqual(expected);
      });
    });

    it('appending an entry leaves every existing one intact', () => {
      const ins = findEntriesArrayInsertion(text);
      expect(ins).not.toBeNull();
      const added =
        text.slice(0, ins!.offset) +
        ',\n' +
        ins!.elementIndent +
        '{ "name": "AppendedProbe", "metadata": {} }' +
        text.slice(ins!.offset);
      const now = entriesOf(added);
      expect(now.length).toBe(before.length + 1);
      before.forEach((el, j) => expect(now[j]).toEqual(el));
      expect(now[now.length - 1].name).toBe('AppendedProbe');
    });
  });
}
