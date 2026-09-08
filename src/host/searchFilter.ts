// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) match/cap rule behind the global entry-search overlay.
// Split from searchSources.ts (the QuickPick wiring) so the filter is unit-
// testable without a live vscode — mirrors the nameExtract.ts ↔ nameIndex.ts
// pure-core / host-IO split.
import type { NameRecord } from './nameExtract.js';

// Filter the name index for the overlay. An empty/whitespace query returns no
// matches (the list stays empty until the user types). Otherwise a case-
// insensitive substring match on the entry name, its source label, OR — for a block
// — its path through the model, preserving input order and capped at `max`. The cap
// guards the QuickPick, which has no virtual scrolling: a broad query over a large
// index is truncated rather than handed over whole.
//
// The path is searchable because it is the only thing that distinguishes one `Gain`
// from another, so "the Gain in Controller" has to be expressible; and because
// `Controller` is a block a user knows the name of while its own row is not in this
// index (a subsystem has no parameter reference of its own to be recorded by).
// Whatever matches here must also be VISIBLE on the item searchSources builds — the
// QuickPick filters our results again by label and description, so a field we match
// on and it does not would be silently dropped from the list.
export function filterEntries(records: NameRecord[], query: string, max: number): NameRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: NameRecord[] = [];
  for (const rec of records) {
    if (
      rec.name.toLowerCase().includes(q) ||
      rec.sourceLabel.toLowerCase().includes(q) ||
      (rec.blockPath ?? '').toLowerCase().includes(q)
    ) {
      matches.push(rec);
      if (matches.length >= max) break;
    }
  }
  return matches;
}
