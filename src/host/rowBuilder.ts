// Copyright 2026 The MathWorks, Inc.

import { ModelBlockNode, RowCellPool, schemaColumnLabels } from 'data-explorer-core';
import { buildSectionRowId } from '../common/sectionRowId.js';
import { stampMatrix } from './matrixPayload.js';
import { planRows, stampLazy, type PlannedRow, type RowPlan } from './lazyRows.js';

// Columns shown across the dictionary tree (union that fits all sections), in
// display order: the ungrouped core columns first, then the grouped columns
// (Data Object → Code Generation → Data Dictionary). Min/Max/Unit are node-owned
// value properties surfaced as columns; lastModified/lastModifiedBy are
// dictionary-entry metadata columns (host-owned, stamped in buildEntryRows).
// Grouped and metadata columns ship hidden by default like Class/Kind.
export const COLUMNS = [
  'Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class',
  'dimensions', 'dimensionsMode', 'complexity', 'Min', 'Max', 'Unit',
  'storageClass', 'headerFile', 'alignment',
  'lastModified', 'lastModifiedBy',
];
// Base labels for the host-owned columns, merged with the schema-derived labels
// for the schema-driven columns (dimensions/complexity/dimensionsMode/
// storageClass/headerFile/alignment). The schema is the single source of truth
// for its own columns' labels, so we overlay them rather than hand-copying them.
// Min/Max/Unit are node-owned, so their (short) column labels live here.
export const COLUMN_LABELS: Record<string, string> = {
  Name: 'Name', Value: 'Value', Class: 'Class', Kind: 'Kind', DataType: 'Data Type', Status: 'Status', UsedBy: 'Usage',
  Min: 'Min', Max: 'Max', Unit: 'Unit',
  lastModified: 'Last Modified', lastModifiedBy: 'Last Modified By',
  ...schemaColumnLabels(),
};

// Column-key → picker group header. Column grouping is a GLOBAL table concern
// (one picker, columns unioned across all sections), so it is owned here rather
// than derived per-class from the schema: node-owned value props (Min/Max/Unit),
// host-owned metadata (lastModified/lastModifiedBy), and the schema-driven
// columns (dimensions/complexity/dimensionsMode → Data Object;
// storageClass/headerFile/alignment → Code Generation) all get their picker
// header here. Read-only for most classes, but not by definition: on a
// Simulink.BusElement, complexity and dimensionsMode emit an editable select over
// MATLAB's own enum, which the generic cell path renders and edits like any other
// object cell. Labels still come from the schema (schemaColumnLabels), which
// remains the single source of truth for a column's display name.
export const COLUMN_GROUPS: Record<string, string> = {
  Min: 'Data Object', Max: 'Data Object', Unit: 'Data Object',
  dimensions: 'Data Object', complexity: 'Data Object', dimensionsMode: 'Data Object',
  storageClass: 'Code Generation', headerFile: 'Code Generation', alignment: 'Code Generation',
  lastModified: 'Data Dictionary', lastModifiedBy: 'Data Dictionary',
};

// Columns for a MATLAB/Simulink Project (.prj). buildRows is generic over
// section containers, so a ProjectNode produces its rows via the same path;
// the editor just posts these columns instead of the dictionary COLUMNS.
export const PROJECT_COLUMNS = ['Name', 'Type', 'Location', 'Labels'];
export const PROJECT_COLUMN_LABELS: Record<string, string> = {
  Name: 'Name', Type: 'Type', Location: 'Location', Labels: 'Labels',
};

// Identifies the entries currently marked on the host clipboard, so their source rows
// can render the cut (dimmed) / copied (dashed) affordance. A SET because the clipboard
// holds every entry a multi-row copy resolved to, and all of their rows carry the mark.
//
// Keyed by section AND name because entry names are only unique within a section. The key
// is a PATH shape rather than a bare name so that dimming an individual child row (the
// deferred node-granular seam) widens the key instead of reshaping this.
export interface ClipMark {
  keys: Set<string>;
  mode: 'cut' | 'copy';
}

/** The mark key for one entry. `\0` cannot occur in a section or entry name. */
export function clipMarkKey(section: string, name: string): string {
  return `${section}\u0000${name}`;
}

/** The section and name a mark key spells. */
export function splitClipMarkKey(key: string): { section: string; name: string } {
  const at = key.indexOf('\u0000');
  return at < 0
    ? { section: '', name: key }
    : { section: key.slice(0, at), name: key.slice(at + 1) };
}

/** The rows for a sectioned tree, plus what the plan held back (for the banner). */
export interface SectionedRows {
  rows: any[];
  plan: RowPlan;
}

/**
 * Rows for a whole sectioned tree (dictionary, model, project), within `budget`.
 *
 * ONE PLAN OVER EVERY ENTRY OF EVERY SECTION, not one plan per section. That is what
 * makes the first level of the plan "every entry name in the file" — the rule this
 * exists to serve is that the NAMES are complete and the deep values may wait, and a
 * per-section plan would instead spend the budget on section 1's depth and leave
 * section 9's entries unnamed. Entries are planned as a flat root list and put back
 * under their own section by `PlannedRow.root`.
 *
 * Section headers are not in the plan — they are structure, not data, and a file whose
 * sections alone exceeded the budget would have nothing worth showing — so the plan is
 * given `budget - sections.length` and the headers are emitted unconditionally. Without
 * that subtraction a planned payload could still be over the payload cap, and `capRows`
 * would truncate exactly the names this was meant to keep.
 *
 * `budget` of Infinity is the whole tree with nothing deferred, which is what every
 * caller had before this existed.
 */
export function buildRowsPlanned(
  sldd: any,
  modifiedNames?: Set<string>,
  clipMark?: ClipMark,
  budget: number = Infinity,
): SectionedRows {
  const rows: any[] = [];
  // One cell pool for this pass. A table's cells are overwhelmingly repetition — measured
  // over a 128,111-row customer dictionary, 1.36M cells hold ~200k distinct values — so
  // giving each distinct value ONE object takes the row set from 88 MB to 55 MB, and the
  // copy the webview receives from 60 MB to 47 MB, because structured clone preserves
  // aliasing (it does not re-expand the shared cells into copies).
  //
  // The pool lives for this call and is then dropped. It is deliberately not a cache
  // across builds: a cache would keep every cell of every dictionary ever opened alive
  // for the life of the extension host, which is the opposite of the point.
  const pool = new RowCellPool();
  const sections = (sldd.children || []) as any[];
  // PRECONDITION (untested) for `|| []`: a parsed section always has a children array
  // (empty when the section holds nothing), so the fallback never fires. Kept because a
  // missing array here would blank the WHOLE table, not one row.
  const entries: any[] = [];
  for (const section of sections) {
    for (const entry of (section.children || []) as any[]) entries.push(entry);
  }
  const headroom = budget === Infinity ? Infinity : Math.max(1, budget - sections.length);
  const plan = planRows(entries, headroom);

  // The plan is pre-order over the roots IN ORDER, so its rows are contiguous and
  // ascending by `root` — which is section order. One cursor therefore walks the whole
  // plan once, handing each section the run that belongs to it, and a root the budget
  // dropped simply has no run.
  //
  // NB: append with a loop, not `rows.push(...entryRows)`. ONE entry can flatten to more
  // rows than the engine takes call arguments — V8 throws `Maximum call stack size
  // exceeded` somewhere between 100,000 and 125,000 — and a 1000x1000 double produced
  // 1,000,001 rows from a single entry. The customer saw it as `Failed to parse <file>:
  // Maximum call stack size exceeded`, which named the parse, the one stage that had
  // worked. A budget bounds this now, but the loop stays: `buildRows` still passes
  // Infinity, and nameIndex.ts avoids the same trap the same way.
  let at = 0;
  let firstRoot = 0;
  for (const section of sections) {
    // Always emit the section's parent row, even when it has no entries.
    rows.push({
      ID: buildSectionRowId(section.name),
      parent: null,
      Name: { label: section.displayName || section.name, iconId: section.icon, editable: false, disabled: false, element: false },
      Value: '', Class: '', Kind: '', DataType: '', Status: '', UsedBy: '',
    });
    const pastLastRoot = firstRoot + ((section.children || []) as any[]).length;
    while (at < plan.planned.length && plan.planned[at].root < pastLastRoot) {
      const p = plan.planned[at++];
      const row = plannedRow(p, entries[p.root], section.name, modifiedNames, clipMark, pool);
      if (row) rows.push(row);
    }
    firstRoot = pastLastRoot;
  }
  return { rows, plan };
}

/** The rows alone, unplanned — the signature every caller that cannot answer a fetch uses. */
export function buildRows(sldd: any, modifiedNames?: Set<string>, clipMark?: ClipMark): any[] {
  return buildRowsPlanned(sldd, modifiedNames, clipMark).rows;
}

/**
 * The rows under one node, within `budget` — the answer to a `requestChildren` on a
 * sectioned source.
 *
 * The same walk as the payload's from a different root, which is the whole reason the
 * per-node work lives in `plannedRow`: a fetched row that came out of a second emitter
 * would differ from its siblings in exactly the ways nothing checks (a missing matrix
 * stamp, an absent capability flag, a twisty that never appears). `entry` is null here
 * because a fetch only ever returns NESTED nodes — the entry row itself was delivered
 * with the payload — so there is no section reparent to do and no entry-only stamp to
 * apply, and passing null says that rather than re-deciding it per row.
 *
 * No pool: a fetch is one node's children merged into a table that already exists, so
 * there is almost nothing to share, and a pool that outlived the call to be reused by
 * the next fetch would pin the whole first build's cells forever.
 *
 * Returns the plan as the payload does, for the one thing a fetch can also lose: a node
 * with more direct children than a whole delivery holds (core caps numeric and string
 * expansion at 10,000 but builds a cell's children uncapped). Those names are absent
 * with no row to open, and the payload path already says so in its banner — a fetch that
 * dropped them silently would be the same rule on two paths, one of them mute.
 */
export function buildChildRows(node: any, budget: number = Infinity): SectionedRows {
  const rows: any[] = [];
  const plan = planRows((node?.children ?? []) as any[], budget);
  for (const p of plan.planned) {
    const row = plannedRow(p, null, '', undefined, undefined, undefined);
    if (row) rows.push(row);
  }
  return { rows, plan };
}

// Context-menu capability flags for a node, computed host-side so the webview
// (which holds no model) can build the right-click menu synchronously from row
// data. Every method is called defensively: canAddChild/canRemoveChild only
// exist on some node types, so we guard with typeof before invoking.
function capabilityFlags(n: any): {
  _canCopy: boolean;
  _canDelete: boolean;
  _canAddChild: boolean;
} {
  // An entry is removable from its section; a nested child is removable only if
  // its parent container permits it (bus/struct/enum expose canRemoveChild).
  const parent = n.parent;
  const canDelete =
    !!n.isEntry ||
    !!(parent && typeof parent.canRemoveChild === 'function' && parent.canRemoveChild());
  const canAddChild = typeof n.canAddChild === 'function' && n.canAddChild();
  return { _canCopy: true, _canDelete: canDelete, _canAddChild: canAddChild };
}

// Build the rows for a single entry subtree (the entry plus its nested children),
// reparented under its section. Used by the incremental edit write-back, which repaints
// only the edited entry's rows instead of rebuilding the whole table.
//
// `budget` is why a 1000x1000 double can be edited: the repaint of ONE entry is as
// unbounded as the payload was, so a caller that can answer a `requestChildren` passes
// the same budget here and gets the same deferred rows back. Infinity keeps the whole
// subtree, which is what a caller that cannot answer one must ask for.
//
// `pool` is optional because the two callers want different things from it. buildRows
// materializes the WHOLE table and brings one, so its rows share cells; the edit
// write-back repaints ONE entry into a table that already exists and brings none —
// a pool over a handful of rows shares almost nothing, and one that outlived the call
// to be reused by the next repaint would pin the whole first build's cells forever.
// Mixing pooled and unpooled rows in one table is safe: a cell is read-only data to
// everything downstream, so sharing is invisible to it.
export function buildEntryRows(
  entry: any,
  sectionName: string,
  modifiedNames?: Set<string>,
  clipMark?: ClipMark,
  pool?: RowCellPool,
  budget: number = Infinity,
): any[] {
  const out: any[] = [];
  const plan = planRows([entry], budget);
  for (const p of plan.planned) {
    const row = plannedRow(p, entry, sectionName, modifiedNames, clipMark, pool);
    if (row) out.push(row);
  }
  return out;
}

/**
 * The row for ONE planned node — the single place a sectioned row is made.
 *
 * Three callers reach it (the whole payload, one entry's repaint, one row's fetch) and
 * the rule they share is everything below: the block-row column remap, the section
 * reparent, the entry-only stamps, the capability flags, the matrix payload and the
 * deferred mark. This repo's recurring defect is one rule with two implementations, and
 * a row is the shape most able to hide one — a missing stamp renders as a plausible row
 * with a feature quietly absent.
 *
 * `entry` null means "this node is not under an entry row in this delivery" (a fetch),
 * which switches off exactly the two things that are about the entry: the reparent onto
 * the section row, and the entry-level Modified/metadata/clipboard stamps.
 *
 * Returns null for a node that has no row — `toRow()` threw, or answered null (a
 * container) — which is the caller's cue to emit nothing and keep going.
 */
function plannedRow(
  p: PlannedRow,
  entry: any | null,
  sectionName: string,
  modifiedNames?: Set<string>,
  clipMark?: ClipMark,
  pool?: RowCellPool,
): any | null {
  const n = p.node;
  let row: any;
  try { row = n.toRow(); } catch { return null; }
  if (!row) return null;
  // Block elements express their column meaning differently from data:
  // the node puts block type in Value and param-usage in DataType. Remap so
  // the "Usage" column (key UsedBy) carries the param-usage and "Data Type"
  // shows the block type, matching the data-vs-block column semantics.
  if (n instanceof ModelBlockNode) {
    // _isBlockRow lets the async model-view annotation (usageGraph) replace
    // this cell with cross-file-resolved param links + source labels.
    row = { ...row, UsedBy: row.DataType, DataType: n.blockType, Value: '', _isBlockRow: true };
  }
  if (entry) {
    // Reparent top-level entries under the section row; keep nested parents as-is.
    if (row.parent == null || row.ID === entry.id) {
      row = { ...row, parent: buildSectionRowId(sectionName) };
    }
    // The stamps below apply to the TOP-LEVEL entry row only: nested children
    // are never marked Modified, carry no dictionary metadata, and never take
    // the clipboard affordance.
    if (row.ID === entry.id) {
      // The "Modified" mark is a diff against the last-saved baseline, so the
      // CALLER owns the answer — and when it supplies one, that answer is
      // authoritative in BOTH directions.
      //
      // Clearing is the half that used to be free. A node carries its own
      // `status = 'Modified'` from the moment it is mutated (DataNode._markModified)
      // and never clears it, and toRow() surfaces it; the full-rebuild path was blind
      // to that because it re-parsed the file and threw the mutated node away. The
      // entry-scoped repaint keeps the mutated node, so the node's flag now reaches a
      // row — and it answers a DIFFERENT question ("was this node touched since it was
      // parsed") from the one the mark shows ("does this entry differ from the last
      // save"). Where they disagree, the baseline wins, because that is what the column
      // means. Only a stale 'Modified' is cleared; any other status is left alone.
      //
      // Today they cannot disagree end to end — an edit rewrites the entry's
      // lastModified stamp, so a mutated entry never matches its baseline again, not
      // even when edited back to the value it had. That is why this is stated as a rule
      // with a unit test (binaryEntryScopedEdit.test.ts) rather than left implicit: the
      // alternative is a row marked forever on the strength of the wrong flag.
      if (modifiedNames) {
        if (modifiedNames.has(entry.name)) row = { ...row, Status: 'Modified' };
        else if (row.Status === 'Modified') row = { ...row, Status: '' };
      }
      // Dictionary metadata columns (Last Modified / Last Modified By). The entry
      // node normalizes the two parse-path key schemes into these display
      // strings; absent values are empty and simply render blank.
      const lastModified = typeof entry.lastModified === 'string' ? entry.lastModified : '';
      const lastModifiedBy = typeof entry.lastModifiedBy === 'string' ? entry.lastModifiedBy : '';
      if (lastModified || lastModifiedBy) {
        row = { ...row, lastModified, lastModifiedBy };
      }
      // Clipboard affordance for a cut/copied entry. The key carries the section, so no
      // caller has to pre-match it. The table reads Name.clipboardMode to dim (cut) or
      // dash-outline (copied).
      if (clipMark?.keys.has(clipMarkKey(sectionName, entry.name)) && row.Name && typeof row.Name === 'object') {
        row = { ...row, Name: { ...row.Name, clipboardMode: clipMark.mode } };
      }
    }
  }
  // Context-menu capability flags (consumed by the webview menu builder), then the
  // grid-view payload if this node's value is a griddable matrix, then the deferred mark
  // if the plan held this node's children back. All three are stamps over the node's own
  // row; none rewrites the row's columns. `_lazy` last, in the same order matRowBuilder
  // applies it, so the two builders' rows are the same shape for the same node.
  const stamped = stampLazy(stampMatrix({ ...row, ...capabilityFlags(n) }, n), p.deferred);
  // Share the FINISHED row, rather than passing the pool to `n.toRow()` above. This row
  // is the node's cells plus this host's own — Usage/Data Type remapped for a block row,
  // the dictionary metadata columns, the clipboard mark — so sharing here covers all of
  // them in ONE walk where doing both would cost two. `_matrix` is left alone: the pool
  // declines any cell it cannot key exactly, and a matrix payload holds a number[].
  return pool ? pool.share(stamped) : stamped;
}
