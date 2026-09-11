// Copyright 2026 The MathWorks, Inc.

import { ModelBlockNode, schemaColumnLabels } from 'data-explorer-core';
import { buildSectionRowId } from '../common/sectionRowId.js';
import { stampMatrix } from './matrixPayload.js';

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

export function buildRows(sldd: any, modifiedNames?: Set<string>, clipMark?: ClipMark): any[] {
  const rows: any[] = [];
  const sections = (sldd.children || []) as any[];
  for (const section of sections) {
    // Always emit the section's parent row, even when it has no entries.
    rows.push({
      ID: buildSectionRowId(section.name),
      parent: null,
      Name: { label: section.displayName || section.name, iconId: section.icon, editable: false, disabled: false, element: false },
      Value: '', Class: '', Kind: '', DataType: '', Status: '', UsedBy: '',
    });
    // Entry rows (flatten each entry subtree so nested struct/bus children appear).
    // PRECONDITION (untested) for `|| []`: a parsed section always has a children
    // array (empty when the section holds nothing), so the fallback never fires.
    // Kept because a missing array here would blank the WHOLE table, not one row.
    for (const entry of (section.children || []) as any[]) {
      rows.push(...buildEntryRows(entry, section.name, modifiedNames, clipMark));
    }
  }
  return rows;
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

// Build the rows for a single entry subtree (the entry plus its flattened
// nested children), reparented under its section. Used both by buildRows for
// the full tree and by the incremental edit write-back, which repaints only
// the edited entry's rows instead of rebuilding the whole table.
export function buildEntryRows(entry: any, sectionName: string, modifiedNames?: Set<string>, clipMark?: ClipMark): any[] {
  const out: any[] = [];
  const flat = entry.flatten ? entry.flatten() : [entry];
  for (const n of flat) {
    let row: any;
    try { row = n.toRow(); } catch { continue; }
    if (!row) continue;
    // Block elements express their column meaning differently from data:
    // the node puts block type in Value and param-usage in DataType. Remap so
    // the "Usage" column (key UsedBy) carries the param-usage and "Data Type"
    // shows the block type, matching the data-vs-block column semantics.
    if (n instanceof ModelBlockNode) {
      // _isBlockRow lets the async model-view annotation (usageGraph) replace
      // this cell with cross-file-resolved param links + source labels.
      row = { ...row, UsedBy: row.DataType, DataType: n.blockType, Value: '', _isBlockRow: true };
    }
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
    // Context-menu capability flags (consumed by the webview menu builder), then
    // the grid-view payload if this node's value is a griddable matrix. Both are
    // stamps over the node's own row; neither rewrites the row's columns.
    out.push(stampMatrix({ ...row, ...capabilityFlags(n) }, n));
  }
  return out;
}
