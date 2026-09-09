// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nextExpandedIds, spliceEntryRows } from '../src/webview/rowUpdates.js';
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
