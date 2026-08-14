// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) match/cap rule behind the global entry-search overlay.
// Split from searchSources.ts (the QuickPick wiring) so the filter is unit-
// testable without a live vscode — mirrors the nameExtract.ts ↔ nameIndex.ts
// pure-core / host-IO split.
import type { NameRecord } from './nameExtract.js';

// Filter the name index for the overlay. An empty/whitespace query returns no
// matches (the list stays empty until the user types). Otherwise a case-
// insensitive substring match on the entry name OR its source label, preserving
// input order and capped at `max`. The cap guards the QuickPick, which has no
// virtual scrolling: a broad query over a large index is truncated rather than
// handed over whole.
export function filterEntries(records: NameRecord[], query: string, max: number): NameRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: NameRecord[] = [];
  for (const rec of records) {
    if (rec.name.toLowerCase().includes(q) || rec.sourceLabel.toLowerCase().includes(q)) {
      matches.push(rec);
      if (matches.length >= max) break;
    }
  }
  return matches;
}
