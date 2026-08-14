// Copyright 2026 The MathWorks, Inc.
// Unit tests for filterEntries — the pure match/cap rule behind the global
// entry-search overlay. The overlay itself (QuickPick wiring) needs a live
// vscode, so only this pure core is unit-tested; the end-to-end index build is
// covered by test-integration/suite/nameIndex.test.ts.
import { describe, it, expect } from 'vitest';
import { filterEntries } from '../src/host/searchFilter.js';
import type { NameRecord } from '../src/host/nameExtract.js';

function rec(name: string, sourceLabel = 'data.sldd'): NameRecord {
  return { name, sourceUri: `file:///w/${sourceLabel}`, sourceLabel, kind: 'sldd' };
}

const RECORDS: NameRecord[] = [
  rec('Kp'),
  rec('Ki'),
  rec('gain', 'model.slx'),
  rec('gainSchedule', 'model.slx'),
  rec('Throttle', 'params.sldd'),
];

describe('filterEntries', () => {
  it('returns nothing for an empty or whitespace query (list stays empty until typing)', () => {
    expect(filterEntries(RECORDS, '', 500)).toEqual([]);
    expect(filterEntries(RECORDS, '   ', 500)).toEqual([]);
  });

  it('matches entry names case-insensitively as a substring', () => {
    expect(filterEntries(RECORDS, 'gain', 500).map((r) => r.name)).toEqual([
      'gain',
      'gainSchedule',
    ]);
    // case-insensitive
    expect(filterEntries(RECORDS, 'GAIN', 500).map((r) => r.name)).toEqual([
      'gain',
      'gainSchedule',
    ]);
    // interior substring, not just prefix
    expect(filterEntries(RECORDS, 'chedul', 500).map((r) => r.name)).toEqual(['gainSchedule']);
  });

  it('also matches on the source label so a file name narrows results', () => {
    expect(filterEntries(RECORDS, 'params', 500).map((r) => r.name)).toEqual(['Throttle']);
  });

  it('preserves input order among matches', () => {
    // Query 'i' matches Ki, gain, gainSchedule (Throttle has no 'i', and no source
    // label contains 'i'); the result must follow the input array order.
    expect(filterEntries(RECORDS, 'i', 500).map((r) => r.name)).toEqual([
      'Ki',
      'gain',
      'gainSchedule',
    ]);
  });

  it('caps the result count at `max` (the un-virtualized list guard)', () => {
    const many = Array.from({ length: 1000 }, (_, i) => rec(`sig${i}`));
    const out = filterEntries(many, 'sig', 10);
    expect(out).toHaveLength(10);
    // the cap keeps the first N in input order
    expect(out[0].name).toBe('sig0');
    expect(out[9].name).toBe('sig9');
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterEntries(RECORDS, 'zzz', 500)).toEqual([]);
  });
});
