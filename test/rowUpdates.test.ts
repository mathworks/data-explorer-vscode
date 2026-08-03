// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nextExpandedIds } from '../src/webview/rowUpdates.js';
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
