// Copyright 2026 The MathWorks, Inc.

import ModelBlockNode from '../dex/datamodel/node/data/ModelBlockNode.js';
import { schemaColumnGroups } from '../dex/datamodel/node/schemaBridge.js';
import { buildSectionRowId } from '../common/sectionRowId.js';

// Columns shown across the dictionary tree (union that fits all sections).
export const COLUMNS = ['Name', 'Value', 'Class', 'Kind', 'DataType', 'Status', 'UsedBy', 'dimensions', 'complexity', 'storageClass', 'alignment'];
export const COLUMN_LABELS: Record<string, string> = {
  Name: 'Name', Value: 'Value', Class: 'Class', Kind: 'Kind', DataType: 'Data Type', Status: 'Status', UsedBy: 'Usage',
  dimensions: 'Dimensions', complexity: 'Complexity', storageClass: 'Storage Class', alignment: 'Alignment',
};

// Column-key → picker group header, derived from the shared schema (single
// source of truth — not hand-maintained). Ungrouped columns are simply absent.
export const COLUMN_GROUPS: Record<string, string> = schemaColumnGroups();

// Columns for a MATLAB/Simulink Project (.prj). buildRows is generic over
// section containers, so a ProjectNode produces its rows via the same path;
// the editor just posts these columns instead of the dictionary COLUMNS.
export const PROJECT_COLUMNS = ['Name', 'Type', 'Location', 'Labels'];
export const PROJECT_COLUMN_LABELS: Record<string, string> = {
  Name: 'Name', Type: 'Type', Location: 'Location', Labels: 'Labels',
};

// Identifies the single entry currently marked on the host clipboard, so its
// source row can render the cut (dimmed) / copied (dashed) affordance. Matched
// by name AND section because entry names are only unique within a section.
export interface ClipMark {
  name: string;
  section: string;
  mode: 'cut' | 'copy';
}

export function buildRows(sldd: any, modifiedNames?: Set<string>, clipMark?: ClipMark): any[] {
  const rows: any[] = [];
  const sections = (sldd.children || []) as any[];
  for (const section of sections) {
    const entries = (section.children || []) as any[];
    // Only the section the clipboard entry lives in can carry the mark, so pass
    // the mode down solely for that section (name uniqueness is per-section).
    const sectionMark = clipMark && clipMark.section === section.name ? clipMark : undefined;
    // Always emit the section row, even when it has no entries.
    // Parent row for the section
    rows.push({
      ID: buildSectionRowId(section.name),
      parent: null,
      Name: { label: section.displayName || section.name, iconId: section.icon, editable: false, disabled: false, element: false },
      Value: '', Class: '', Kind: '', DataType: '', Status: '', UsedBy: '',
    });
    // Entry rows (flatten each entry subtree so nested struct/bus children appear)
    for (const entry of entries) {
      rows.push(...buildEntryRows(entry, section.name, modifiedNames, sectionMark));
    }
  }
  return rows;
}

// Context-menu capability flags for a node, computed host-side so the webview
// (which holds no model) can build the right-click menu synchronously from row
// data. Every method is called defensively: canAddChild/canRemoveChild only
// exist on some node types, so we guard with typeof before invoking.
function capabilityFlags(n: any): {
  _isEntry: boolean;
  _canCopy: boolean;
  _canDelete: boolean;
  _canAddChild: boolean;
} {
  const isEntry = !!n.isEntry;
  // An entry is removable from its section; a nested child is removable only if
  // its parent container permits it (bus/struct/enum expose canRemoveChild).
  const parent = n.parent;
  const canDelete = isEntry
    ? true
    : !!(parent && typeof parent.canRemoveChild === 'function' && parent.canRemoveChild());
  const canAddChild = typeof n.canAddChild === 'function' && n.canAddChild();
  return { _isEntry: isEntry, _canCopy: true, _canDelete: canDelete, _canAddChild: canAddChild };
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
    try { row = n.toRow(); } catch (e) { continue; }
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
    // Mark only the top-level entry row as Modified (not nested children).
    if (row.ID === entry.id && modifiedNames?.has(entry.name)) {
      row = { ...row, Status: 'Modified' };
    }
    // Stamp the clipboard affordance on the cut/copied entry's own row (the
    // section is pre-matched by the caller, so here just match the name). The
    // table reads Name.clipboardMode to dim (cut) or dash-outline (copied).
    if (row.ID === entry.id && clipMark && clipMark.name === entry.name && row.Name && typeof row.Name === 'object') {
      row = { ...row, Name: { ...row.Name, clipboardMode: clipMark.mode } };
    }
    // Context-menu capability flags (consumed by the webview menu builder).
    out.push({ ...row, ...capabilityFlags(n) });
  }
  return out;
}
