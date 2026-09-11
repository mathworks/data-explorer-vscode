// Copyright 2026 The MathWorks, Inc.
//
// Operand resolution: the ONE answer to "which rows does this action act on".
//
// It exists because the two triggers used to answer that question separately, and
// differently — the context menu acted on the right-clicked row, the keyboard on
// `selectedRowIds[0]`, while the focus ring sat on the LAST selected row. Both now
// call this, so a shortcut cannot do something other than what the menu advertised.
//
// The rule it encodes is the spec's: an operation's granularity follows whether it
// needs a DESTINATION. Delete has none, so it is row-granular and tolerates a mixed
// selection. Copy/Cut/Paste/Drag all have one, so they stay entry-granular, where
// `sectionRules` + `dropDecision` already answer "can this land here".
//
// Pure and row-shaped on purpose: the webview holds no model, so an owning entry is
// found by walking `parent` until the parent is a section header. The model-side
// mirror of the same rule is host/deletionPlan.ts, and the two are pinned against
// each other in multiSelectInvariants.test.ts — that pairing is the point, because this
// is the `one rule, two paths` bug class.
import { isSectionRowId } from '../common/sectionRowId.js';

/** The subset of a table row this module reads. */
export interface OperandRow {
  ID: string;
  /** The parent ROW id: a section header (`section:<name>`) for a top-level entry. */
  parent?: string | null;
  _canCopy?: boolean;
  _canDelete?: boolean;
  _canAddChild?: boolean;
}

export interface Operands {
  /**
   * Rows to delete, entries and nested children alike, after subsumption.
   * Order-stable (selection order) and deduped.
   */
  deleteIds: string[];
  /** Owning-entry rows for Copy/Cut, deduped, order-stable. */
  entryIds: string[];
  /** Distinct section header rows the selection's data rows resolve to. */
  sections: string[];
}

// The entry row a data row belongs to: walk up until the parent is a section
// header (or is missing, which is a row whose ancestor is not in the table). A row
// that cannot be walked answers for itself, so a partial table degrades to
// row-granular rather than to nothing.
function owningEntryId(rowId: string, byId: Map<string, OperandRow>): string {
  let cur = byId.get(rowId);
  let id = rowId;
  // Bounded by the table size, so a malformed cycle cannot spin here.
  for (let hops = 0; cur && hops <= byId.size; hops++) {
    const parent = cur.parent;
    if (typeof parent !== 'string' || isSectionRowId(parent)) return cur.ID;
    const next = byId.get(parent);
    if (!next) return cur.ID;
    id = next.ID;
    cur = next;
  }
  return id;
}

// Whether any row STRICTLY above `rowId` is selected. Deleting an ancestor already
// removes this row, so listing both is redundant — and double-handling would throw
// on the second model op (the hazard BinarySlddEditorProvider's drop path guards
// with a `seen` set).
function hasSelectedAncestor(
  rowId: string,
  byId: Map<string, OperandRow>,
  selected: ReadonlySet<string>,
): boolean {
  let cur = byId.get(rowId);
  for (let hops = 0; cur && hops <= byId.size; hops++) {
    const parent = cur.parent;
    if (typeof parent !== 'string' || isSectionRowId(parent)) return false;
    if (selected.has(parent)) return true;
    cur = byId.get(parent);
  }
  return false;
}

/**
 * Resolve a selection into the operands each action acts on.
 *
 * Section headers are dropped: a header is never a row-action operand, though it
 * remains valid as a PASTE TARGET (the only target an empty section has). A
 * selection of headers alone therefore yields no operands, which is what tells the
 * menu builder to show the short section menu.
 */
export function resolveOperands(
  selectedRowIds: readonly string[],
  rows: readonly OperandRow[],
): Operands {
  const byId = new Map<string, OperandRow>();
  for (const row of rows) byId.set(row.ID, row);
  const selected = new Set(selectedRowIds);

  const deleteIds: string[] = [];
  const entryIds: string[] = [];
  const sections: string[] = [];
  const seenDelete = new Set<string>();
  const seenEntry = new Set<string>();
  const seenSection = new Set<string>();

  for (const rowId of selectedRowIds) {
    if (typeof rowId !== 'string' || isSectionRowId(rowId)) continue;
    // A stale id contributes nothing rather than aborting the whole resolution:
    // rows can lag a repaint, and one dead id must not disable the menu.
    if (!byId.has(rowId)) continue;
    if (hasSelectedAncestor(rowId, byId, selected)) continue;

    if (!seenDelete.has(rowId)) {
      seenDelete.add(rowId);
      deleteIds.push(rowId);
    }
    // Identity by ROW ID, which is a name path — so two same-named entries in
    // different sections stay two entries, exactly as buildDragSnapshot's
    // dedupe-by-node-identity does on the host side.
    const entryId = owningEntryId(rowId, byId);
    if (!seenEntry.has(entryId)) {
      seenEntry.add(entryId);
      entryIds.push(entryId);
    }
    const sectionId = byId.get(entryId)?.parent;
    if (typeof sectionId === 'string' && isSectionRowId(sectionId) && !seenSection.has(sectionId)) {
      seenSection.add(sectionId);
      sections.push(sectionId);
    }
  }

  return { deleteIds, entryIds, sections };
}
