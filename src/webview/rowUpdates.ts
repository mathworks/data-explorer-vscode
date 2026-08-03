// Copyright 2026 The MathWorks, Inc.

interface RowLike {
  ID: string;
  parent: string | null;
}

/**
 * Decide which rows should be expanded after a `setRows`.
 *
 * Every repaint — the initial load, a value edit, a structural edit, a text-view
 * edit, undo, AND redo — arrives as a fresh `setRows`. To avoid collapsing the
 * tree under the user on any of those, we PRESERVE the prior expansion: keep
 * whichever previously-expanded rows still exist in the new row set.
 *
 * On the first load (no prior expansion) we default to expanding the section
 * rows (parent === null) so entries are visible immediately — a data viewer
 * should not open fully collapsed.
 */
export function nextExpandedIds<T extends RowLike>(prev: Set<string> | null, rows: T[]): Set<string> {
  if (!prev || prev.size === 0) {
    return new Set(rows.filter((r) => r.parent === null).map((r) => r.ID));
  }
  const existing = new Set(rows.map((r) => r.ID));
  return new Set([...prev].filter((id) => existing.has(id)));
}
