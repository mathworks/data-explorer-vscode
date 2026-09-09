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

/**
 * Replace ONE entry's subtree rows in place, returning a new array (or null when
 * the entry's row isn't present).
 *
 * This is the row-level half of the entry-scoped repaint. A `setRows` carrying the
 * whole table is the wrong shape for an edit confined to one entry: on a real
 * customer dictionary that is ~130,000 rows and a ~67 MB postMessage, rebuilt from
 * a re-parse of a 75 MB XML chunk, to express a one-cell change. The host instead
 * rebuilds just the edited entry's rows and this splices them over the run the
 * table already holds.
 *
 * WHY A CONTIGUOUS RUN: `buildRows` emits each entry's rows together — the entry
 * row, then its flattened descendants — so an entry's rows are always one run
 * starting at its own row. The run's END is found by walking forward while each
 * row's parent is a row already known to be inside the subtree; `flatten()`
 * guarantees a child follows its parent, so the first row that fails that test is
 * the next entry (whose parent is the section) or the next section header (whose
 * parent is null).
 *
 * Deliberately NOT keyed on an id prefix. Two reasons it would be wrong: a nested
 * child's id is not required to extend its entry's id, and a RENAME changes the
 * entry's id while the rows on screen still carry the old one — which is why the
 * caller passes the id the table currently spells, not the entry's new id.
 *
 * An empty `replacement` removes the subtree, which is what makes this the same
 * primitive for a deletion as for an update.
 *
 * Returns null rather than guessing when the entry row is absent, so the caller
 * can ask for a full repaint instead of silently dropping the update.
 */
export function spliceEntryRows<T extends RowLike>(
  rows: T[],
  entryRowId: string,
  replacement: T[],
): T[] | null {
  const start = rows.findIndex((r) => r.ID === entryRowId);
  if (start < 0) return null;
  const subtree = new Set<string>([entryRowId]);
  let end = start + 1;
  while (end < rows.length) {
    const parent = rows[end].parent;
    if (typeof parent !== 'string' || !subtree.has(parent)) break;
    subtree.add(rows[end].ID);
    end++;
  }
  return [...rows.slice(0, start), ...replacement, ...rows.slice(end)];
}

/**
 * Insert ONE new entry's rows into a section, returning a new array (or null when
 * the position can't be located).
 *
 * The counterpart of spliceEntryRows for an entry the table does not hold yet: a
 * paste, a drop, or the undo of a delete. Where a splice finds its place by the run
 * it replaces, an insert has to be TOLD the place, and the two forms of it are the
 * two the host can produce:
 *
 *  - `beforeRowId` given → immediately before that entry's row (the undo of a
 *    delete, which must put the entry back where it was).
 *  - absent → after the section's last row, which is where a pasted entry lands.
 *
 * "The section's last row" is found by walking forward from the section header while
 * rows keep belonging to it. `buildRows` emits a section's rows contiguously and
 * every following section header carries `parent === null`, so the first row with a
 * null parent ends the section — and a section that is the table's last needs no
 * terminator beyond the array's end.
 *
 * Returns null rather than guessing when the section row is absent (or the named
 * `beforeRowId` isn't in it), so the caller can ask for a full repaint instead of
 * dropping the new entry or filing it under the wrong section.
 */
export function insertEntryRows<T extends RowLike>(
  rows: T[],
  sectionRowId: string,
  beforeRowId: string | undefined,
  addition: T[],
): T[] | null {
  const sectionAt = rows.findIndex((r) => r.ID === sectionRowId);
  if (sectionAt < 0) return null;
  let end = sectionAt + 1;
  while (end < rows.length && rows[end].parent !== null) end++;
  let at = end;
  if (beforeRowId !== undefined) {
    const beforeAt = rows.findIndex((r) => r.ID === beforeRowId);
    // Inside THIS section, or not at all: an anchor found in another section would
    // file the new entry under the wrong header, which is worse than a full repaint.
    if (beforeAt <= sectionAt || beforeAt >= end) return null;
    at = beforeAt;
  }
  return [...rows.slice(0, at), ...addition, ...rows.slice(at)];
}
