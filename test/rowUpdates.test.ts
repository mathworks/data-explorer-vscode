// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nextExpandedIds, nextStickyIds, pendingSelectionToApply, spliceEntryRows, insertEntryRows } from '../src/webview/rowUpdates.js';
import { getModel } from '../src/host/SlddModel.js';
import { buildRows, buildEntryRows } from '../src/host/rowBuilder.js';

type Row = { ID: string; parent: string | null; Value?: unknown };

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

// Every repaint (edit, text-view edit, undo, redo) arrives as a fresh setRows.
// nextExpandedIds preserves the user's expansion across all of them so the tree
// never collapses; it defaults to section rows only on the first load.
describe('nextExpandedIds — expansion preserved across setRows', () => {
  const rows: Row[] = [
    { ID: 'section:P', parent: null },
    { ID: 'section:P/Gain', parent: 'section:P' },
    { ID: 'section:P/Gain/Field', parent: 'section:P/Gain' },
    { ID: 'section:Q', parent: null },
  ];

  it('defaults to section rows (parent === null) on first load (no prior state)', () => {
    expect(nextExpandedIds(null, rows)).toEqual(new Set(['section:P', 'section:Q']));
    expect(nextExpandedIds(new Set(), rows)).toEqual(new Set(['section:P', 'section:Q']));
  });

  it('preserves prior expansion (deep node stays expanded across a rebuild)', () => {
    const prev = new Set(['section:P', 'section:P/Gain']);
    expect(nextExpandedIds(prev, rows)).toEqual(new Set(['section:P', 'section:P/Gain']));
  });

  it('drops previously-expanded ids that no longer exist (e.g. a deleted entry)', () => {
    const prev = new Set(['section:P', 'section:P/Gain', 'section:P/Deleted']);
    expect(nextExpandedIds(prev, rows)).toEqual(new Set(['section:P', 'section:P/Gain']));
  });

  it('does not force-expand collapsed sections on a rebuild', () => {
    // The user collapsed section:Q; a rebuild must keep it collapsed.
    const prev = new Set(['section:P']);
    const result = nextExpandedIds(prev, rows);
    expect(result.has('section:Q')).toBe(false);
  });
});

// The row-level half of the entry-scoped repaint: replace one entry's contiguous run
// with the rows the host just rebuilt for it, and leave every other row untouched.
describe('spliceEntryRows — replace one entry subtree', () => {
  // Two sections, and a first entry with two children and a grandchild — the shape
  // buildRows emits: entry row, then its flattened descendants, then the next entry.
  const rows = (): Row[] => [
    { ID: 'section:P', parent: null },
    { ID: 'section:P/Bus', parent: 'section:P' },
    { ID: 'section:P/Bus/a', parent: 'section:P/Bus' },
    { ID: 'section:P/Bus/a/deep', parent: 'section:P/Bus/a' },
    { ID: 'section:P/Bus/b', parent: 'section:P/Bus' },
    { ID: 'section:P/Next', parent: 'section:P' },
    { ID: 'section:Q', parent: null },
    { ID: 'section:Q/Other', parent: 'section:Q' },
  ];

  it('replaces the entry and its whole subtree, keeping the rest byte-identical', () => {
    const before = rows();
    const replacement: Row[] = [
      { ID: 'section:P/Bus', parent: 'section:P', Value: 'new' },
      { ID: 'section:P/Bus/a', parent: 'section:P/Bus' },
    ];
    expect(spliceEntryRows(before, 'section:P/Bus', replacement)).toEqual([
      before[0],
      ...replacement,
      before[5],
      before[6],
      before[7],
    ]);
  });

  it('stops at the next entry, not at the next row with a different parent', () => {
    // The run ends where a row's parent is NOT inside the subtree. Walking by depth or
    // by id prefix instead would swallow the following sibling entry.
    const spliced = spliceEntryRows(rows(), 'section:P/Bus', [])!;
    expect(spliced.map((r) => r.ID)).toEqual(['section:P', 'section:P/Next', 'section:Q', 'section:Q/Other']);
  });

  it('handles a childless entry (a run of one)', () => {
    const before = rows();
    const replacement: Row[] = [{ ID: 'section:P/Next', parent: 'section:P', Value: 9 }];
    const spliced = spliceEntryRows(before, 'section:P/Next', replacement)!;
    expect(spliced).toEqual([...before.slice(0, 5), ...replacement, ...before.slice(6)]);
  });

  it('handles the last entry in the table (the run ends at the array end)', () => {
    const before = rows();
    const replacement: Row[] = [{ ID: 'section:Q/Other', parent: 'section:Q', Value: 1 }];
    expect(spliceEntryRows(before, 'section:Q/Other', replacement)).toEqual([
      ...before.slice(0, 7),
      ...replacement,
    ]);
  });

  it('accepts a replacement whose ids differ — a rename', () => {
    // The rows on screen carry the OLD id (which is what the caller passes); the
    // replacement carries the new one, for the entry and every descendant.
    const replacement: Row[] = [
      { ID: 'section:P/Renamed', parent: 'section:P' },
      { ID: 'section:P/Renamed/a', parent: 'section:P/Renamed' },
    ];
    const spliced = spliceEntryRows(rows(), 'section:P/Bus', replacement)!;
    expect(spliced.map((r) => r.ID)).toEqual([
      'section:P',
      'section:P/Renamed',
      'section:P/Renamed/a',
      'section:P/Next',
      'section:Q',
      'section:Q/Other',
    ]);
  });

  it('returns null when the entry row is absent, so the caller can ask for a full repaint', () => {
    // Silently dropping the update would leave the table disagreeing with the file.
    expect(spliceEntryRows(rows(), 'section:P/Missing', [{ ID: 'x', parent: null }])).toBeNull();
    expect(spliceEntryRows([], 'section:P/Bus', [])).toBeNull();
  });

  it('does not mutate the array it was given', () => {
    const before = rows();
    spliceEntryRows(before, 'section:P/Bus', []);
    expect(before).toEqual(rows());
  });
});

// The other row-level half: an entry the table does NOT hold yet — a paste, a drop, or
// the undo of a delete. A splice finds its place by the run it replaces; an insert has to
// be told, and the host states it as "this section, before this entry (or last)".
describe('insertEntryRows — add one new entry to a section', () => {
  const rows = (): Row[] => [
    { ID: 'section:P', parent: null },
    { ID: 'section:P/Bus', parent: 'section:P' },
    { ID: 'section:P/Bus/a', parent: 'section:P/Bus' },
    { ID: 'section:P/Next', parent: 'section:P' },
    { ID: 'section:Q', parent: null },
    { ID: 'section:Q/Other', parent: 'section:Q' },
  ];
  const addition: Row[] = [
    { ID: 'section:P/New', parent: 'section:P' },
    { ID: 'section:P/New/kid', parent: 'section:P/New' },
  ];

  it('appends after the section’s last row when no anchor is given — where a paste lands', () => {
    // Not at the array's end and not after the section HEADER: after the section's last
    // row, which is the row before the next section's header.
    const inserted = insertEntryRows(rows(), 'section:P', undefined, addition)!;
    expect(inserted.map((r) => r.ID)).toEqual([
      'section:P',
      'section:P/Bus',
      'section:P/Bus/a',
      'section:P/Next',
      'section:P/New',
      'section:P/New/kid',
      'section:Q',
      'section:Q/Other',
    ]);
  });

  it('inserts before the anchor row — the undo of a delete, which must restore position', () => {
    const inserted = insertEntryRows(rows(), 'section:P', 'section:P/Next', addition)!;
    expect(inserted.map((r) => r.ID)).toEqual([
      'section:P',
      'section:P/Bus',
      'section:P/Bus/a',
      'section:P/New',
      'section:P/New/kid',
      'section:P/Next',
      'section:Q',
      'section:Q/Other',
    ]);
  });

  it('inserts as the section’s FIRST entry when the anchor is its first', () => {
    const inserted = insertEntryRows(rows(), 'section:P', 'section:P/Bus', addition)!;
    expect(inserted.map((r) => r.ID)).toEqual([
      'section:P',
      'section:P/New',
      'section:P/New/kid',
      'section:P/Bus',
      'section:P/Bus/a',
      'section:P/Next',
      'section:Q',
      'section:Q/Other',
    ]);
  });

  it('appends into the table’s LAST section (no following header to stop at)', () => {
    const addQ: Row[] = [{ ID: 'section:Q/New', parent: 'section:Q' }];
    expect(insertEntryRows(rows(), 'section:Q', undefined, addQ)!.map((r) => r.ID)).toEqual([
      'section:P',
      'section:P/Bus',
      'section:P/Bus/a',
      'section:P/Next',
      'section:Q',
      'section:Q/Other',
      'section:Q/New',
    ]);
  });

  it('appends directly under the header of an EMPTY section', () => {
    const empty: Row[] = [
      { ID: 'section:P', parent: null },
      { ID: 'section:Q', parent: null },
      { ID: 'section:Q/Other', parent: 'section:Q' },
    ];
    expect(insertEntryRows(empty, 'section:P', undefined, addition)!.map((r) => r.ID)).toEqual([
      'section:P',
      'section:P/New',
      'section:P/New/kid',
      'section:Q',
      'section:Q/Other',
    ]);
  });

  it('returns null when the section row is absent', () => {
    expect(insertEntryRows(rows(), 'section:Z', undefined, addition)).toBeNull();
    expect(insertEntryRows([], 'section:P', undefined, addition)).toBeNull();
  });

  it('returns null when the anchor is in ANOTHER section, rather than filing it there', () => {
    // The failure that matters: an anchor found outside this section would put the new
    // entry under the wrong header, which is worse than paying for a full repaint.
    expect(insertEntryRows(rows(), 'section:P', 'section:Q/Other', addition)).toBeNull();
    // Including the section header itself, which is not one of its entries.
    expect(insertEntryRows(rows(), 'section:P', 'section:P', addition)).toBeNull();
    expect(insertEntryRows(rows(), 'section:P', 'section:P/Missing', addition)).toBeNull();
  });

  it('does not mutate the array it was given', () => {
    const before = rows();
    insertEntryRows(before, 'section:P', undefined, addition);
    expect(before).toEqual(rows());
  });
});

// Editing a row is how a user makes it stop matching their own search. nextStickyIds
// is what keeps that row in the filtered list across the repaint, so the answer to a
// search changes only when the user searches again.
describe('nextStickyIds — a filtered list holds still across a repaint', () => {
  const rows: Row[] = [
    { ID: 'section:P', parent: null },
    { ID: 'section:P/Gain', parent: 'section:P' },
    { ID: 'section:P/Offset', parent: 'section:P' },
  ];

  it('keeps the ids that were visible, so an edited row cannot vanish', () => {
    expect(nextStickyIds('gain', ['section:P', 'section:P/Gain'], rows, [])).toEqual(
      new Set(['section:P', 'section:P/Gain']),
    );
  });

  it('nothing is sticky when no search is active', () => {
    // Without a filter the set would hold every visible id in the document —
    // ~130,000 on a real customer dictionary — and buy nothing: an unfiltered
    // view hides no rows to begin with.
    expect(nextStickyIds('', ['section:P', 'section:P/Gain'], rows, [])).toEqual(new Set());
  });

  it('drops ids that no longer exist, so a deleted row does not linger', () => {
    expect(nextStickyIds('gain', ['section:P/Gain', 'section:P/Deleted'], rows, [])).toEqual(
      new Set(['section:P/Gain']),
    );
  });

  it("adds the host's post-edit selection, which a rename made unrecognisable", () => {
    // A rename changes the row's id (core keys a row by its path), so the row just
    // edited out of the match arrives under an id the previous list never held. The
    // host supplies the new spelling; the webview must not re-derive core's id rule.
    const renamed: Row[] = [
      { ID: 'section:P', parent: null },
      { ID: 'section:P/Renamed', parent: 'section:P' },
    ];
    expect(nextStickyIds('gain', ['section:P', 'section:P/Gain'], renamed, ['section:P/Renamed'])).toEqual(
      new Set(['section:P', 'section:P/Renamed']),
    );
  });

  it('ignores a selection that is not in the new rows', () => {
    expect(nextStickyIds('gain', [], rows, ['section:P/Absent'])).toEqual(new Set());
  });

  it('keeps EVERY row of a multi-entry paste in a filtered list, not just the last', () => {
    // The paste appends N entries and the host names all N. Only the ones held here
    // survive the filter, so keeping one would leave the user selecting rows the search
    // has hidden — which is the same defect this whole set exists to prevent.
    const pasted: Row[] = [
      { ID: 'section:P', parent: null },
      { ID: 'section:P/Bus1', parent: 'section:P' },
      { ID: 'section:P/Bus2', parent: 'section:P' },
    ];
    expect(nextStickyIds('gain', [], pasted, ['section:P/Bus1', 'section:P/Bus2'])).toEqual(
      new Set(['section:P/Bus1', 'section:P/Bus2']),
    );
  });
});

// The retry the host's `selectRows` message goes through: it names rows the model already
// holds, but the ROWS may still be in flight, so it is re-tried after every repaint.
describe('pendingSelectionToApply — all of the asked-for selection, or none yet', () => {
  const rows: Row[] = [
    { ID: 'section:P', parent: null },
    { ID: 'section:P/Bus1', parent: 'section:P' },
    { ID: 'section:P/Bus2', parent: 'section:P' },
  ];

  it('applies every id once they are all present', () => {
    expect(pendingSelectionToApply(rows, ['section:P/Bus1', 'section:P/Bus2'])).toEqual([
      'section:P/Bus1',
      'section:P/Bus2',
    ]);
  });

  it('holds while ANY id is still missing, rather than selecting the half that arrived', () => {
    // A partial answer is both wrong and final: applying it consumes the pending ids, so
    // the entries still in flight would never join the selection.
    expect(pendingSelectionToApply(rows, ['section:P/Bus1', 'section:P/Bus3'])).toBeNull();
  });

  it('holds when the whole selection is absent — the pre-repaint state of every paste', () => {
    expect(pendingSelectionToApply(rows, ['section:P/Bus3'])).toBeNull();
  });

  it('has nothing to do when nothing is pending', () => {
    expect(pendingSelectionToApply(rows, [])).toBeNull();
  });

  it('preserves the host’s order, which is the order the entries were added', () => {
    // selectedRowIds' LAST id is what the table scrolls to (dex-tree-table's
    // selectedRowId), so reordering here would move the viewport to a different member
    // of the group than the one the host's fold ended on.
    expect(pendingSelectionToApply(rows, ['section:P/Bus2', 'section:P/Bus1'])).toEqual([
      'section:P/Bus2',
      'section:P/Bus1',
    ]);
  });
});

// buildEntryRows must produce the same rows as the full buildRows for that entry
// (it's used by the full rebuild for each entry subtree).
describe('buildEntryRows — single-entry rebuild matches full buildRows', () => {
  it('produces the same rows for an entry as buildRows does in context', () => {
    const text = readFileSync(fixturePath('numeric_json.sldd'), 'utf8');
    const sldd = getModel('test://numeric_json-entry.sldd', 'numeric_json.sldd', text);
    const section = sldd.children[0];
    const entry = section.children[0];

    const full = buildRows(sldd);
    const entryRows = buildEntryRows(entry, section.name);

    // Every row buildEntryRows emits appears identically in the full build.
    const fullById = new Map(full.map((r: Row) => [r.ID, r]));
    expect(entryRows.length).toBeGreaterThan(0);
    for (const r of entryRows) {
      expect(fullById.get(r.ID)).toEqual(r);
    }
  });
});
