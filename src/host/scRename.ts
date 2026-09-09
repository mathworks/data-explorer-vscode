// Copyright 2026 The MathWorks, Inc.
//
// CARRYING AN ENTRY RENAME INTO THE SYSTEM COMPOSER CATALOG.
//
// An Architectural Data entry is stored as an ordinary Simulink object, and a second
// part of the dictionary — the System Composer interface dictionary — says which System
// Composer thing it models, BY NAME. That is the only link the file has (the entry's
// uuid appears in `simulink/ArchitecturePart`, never in this part), so a rename that
// changes the entry alone breaks the file in both directions at once: the entry re-reads
// as its raw Simulink class (a struct type comes back a plain data interface) and the
// catalog is left defining an interface no entry backs.
//
// Core owns the vocabulary — where a definition spells its name in either syntax, and
// which of those sites move with a rename. What lives here is the HOST's half, which the
// two providers cannot share any further than this because their edit surfaces differ:
//
//   uncompressed-text  the catalog is in the same TextDocument as the entry, so the
//                      rename is extra range replacements in the SAME WorkspaceEdit —
//                      one undo step, and one change event (which is a MULTI-change
//                      event, so both narrow repaint paths refuse it and the provider
//                      falls back to the wide repaint that re-reads the catalog anyway).
//   compressed-binary  the catalog is a zip member the document only passes through, so
//                      the rename is a member swap that undo has to restore with the
//                      chunk and that every save re-zips.
//
// `catalogRenameOf` is the one sentence both of them DO share: which renames carry at
// all. It is deliberately not a lookup in the catalog — the two format helpers already
// answer "no definition carries this name" by finding no sites, and asking twice is one
// rule with two chances to disagree. What it decides is the part neither helper can see:
// that this edit is a rename OF A TOP-LEVEL ENTRY. The catalog lists only entries, and a
// bus element named after the value type it references (which is how System Composer
// writes a bus of value types) would otherwise drag the catalog off the entry that
// really carries that name.
//
// Kept VS-Code-free, like the rest of the edit vocabulary, so it is testable without a
// window.
import {
  SC_PART_XML,
  applyScEdits,
  scRenameEdits,
  scanScJsonText,
  scanScXml,
  type ScTextEdit,
} from 'data-explorer-core';

/** The rename to carry: the name the FILE still spells, and the name it will spell. */
export interface CatalogRename {
  oldName: string;
  newName: string;
}

/**
 * The rename this cell edit carries into the catalog, or null if it carries none.
 *
 * MUST be called before the mutation: `node.name` is the name the file still spells, and
 * once `setProperty` has run there is nothing left to look the definition up by.
 */
export function catalogRenameOf(
  columnId: string,
  newValue: string,
  node: { name: string },
  entry: { name: string },
): CatalogRename | null {
  if (columnId !== 'Name' || node !== entry) {
    return null;
  }
  if (!node.name || node.name === newValue) {
    return null;
  }
  return { oldName: node.name, newName: newValue };
}

/**
 * The range replacements that carry a rename into an uncompressed-text dictionary's
 * catalog, as offsets into the document text the caller is about to edit.
 *
 * Empty for the overwhelming majority of renames (an entry no catalog classifies, or a
 * dictionary with no catalog part at all), which is what keeps this off the hot path: a
 * dictionary without the part is one failed `indexOf` away from an empty answer.
 */
export function scJsonRenameEdits(text: string, oldName: string, newName: string): ScTextEdit[] {
  if (oldName === newName) {
    return [];
  }
  return scRenameEdits(scanScJsonText(text), oldName, newName);
}

/** A pass-through zip member, before and after a rename was carried into it. */
export interface ScPartPatch {
  member: string;
  before: Uint8Array;
  after: Uint8Array;
}

/**
 * The catalog member swap that carries a rename into a compressed-binary dictionary, or
 * null when there is nothing to carry.
 *
 * Both halves are kept because the swap has to be undoable, and `before` is the member's
 * ORIGINAL BYTES rather than a re-serialization of them: everything but `data/chunk0.xml`
 * is written back verbatim, so an undo that rebuilt the part would land in the user's
 * file as a reformatting of a part this session never meant to touch.
 */
export function scXmlRenamePatch(
  zipMeta: Record<string, Uint8Array>,
  oldName: string,
  newName: string,
): ScPartPatch | null {
  const before = zipMeta[SC_PART_XML];
  if (!before || oldName === newName) {
    return null;
  }
  const xml = new TextDecoder().decode(before);
  const edits = scRenameEdits(scanScXml(xml), oldName, newName);
  if (edits.length === 0) {
    return null;
  }
  return { member: SC_PART_XML, before, after: new TextEncoder().encode(applyScEdits(xml, edits)) };
}
