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
// A service interface's FUNCTION is the one row below an entry that the catalog also spells:
// it keeps its own copy of each function under the interface's definition (`p_Name`, and
// `p_FunctionPrototype`, which declares the function by name). Core renames the data part's
// Prototype with the Name and carries the rename into the catalog in its own save, which
// neither provider calls; so `catalogFunctionRenameOf` is the second gate, and the two format
// helpers below it are core's own function edits (`scFunctionRenameEdits`, what that save
// applies) over the same two edit surfaces. The two gates never both fire: one needs the row
// to BE the entry, the other needs it to be a function directly under it.
//
// Kept VS-Code-free, like the rest of the edit vocabulary, so it is testable without a
// window.
import {
  SC_PART_XML,
  applyScEdits,
  scFunctionRenameEdits,
  scRenameEdits,
  scanScJsonFunctions,
  scanScJsonText,
  scanScXml,
  scanScXmlFunctions,
  type CatalogFunctionRenames,
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
 * A rename of a service interface's function, which the catalog keeps its own copy of
 * (`p_Name` / `p_FunctionPrototype` under the interface's definition): the interface as the
 * file spells it, and the function's name in the file and next.
 */
export interface CatalogFunctionRename {
  interfaceName: string;
  oldName: string;
  newName: string;
}

/**
 * The function rename this cell edit carries into the catalog, or null if it carries none:
 * a Name edit of a `Simulink.FunctionElement` that is a direct child of the top-level entry,
 * which is the one function rename core records for its own save
 * (`FunctionElementNode._functionRenamed`).
 *
 * MUST be called before the mutation, like `catalogRenameOf`: `node.name` is the name the
 * file still spells. The interface's name needs no such care. Both providers carry an entry
 * rename into the document the moment it is made, so the file spells the interface as
 * `entry.name`.
 *
 * Not a lookup in the catalog either, for the same reason as `catalogRenameOf`: a function
 * the catalog does not list is answered by the helpers finding no sites.
 */
export function catalogFunctionRenameOf(
  columnId: string,
  newValue: string,
  node: { name: string; className?: string; parent?: unknown },
  entry: { name: string },
): CatalogFunctionRename | null {
  if (columnId !== 'Name' || node.parent !== entry || node.className !== 'Simulink.FunctionElement') {
    return null;
  }
  if (!node.name || node.name === newValue) {
    return null;
  }
  return { interfaceName: entry.name, oldName: node.name, newName: newValue };
}

/** The one rename, in the shape core's edits take: interface, then function, as the file spells them. */
const asFunctionRenames = (rename: CatalogFunctionRename): CatalogFunctionRenames =>
  new Map([[rename.interfaceName, new Map([[rename.oldName, rename.newName]])]]);

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

/**
 * The range replacements that carry a function rename into an uncompressed-text
 * dictionary's catalog, as offsets into the document text the caller is about to edit:
 * the function's `p_Name`, and its `p_FunctionPrototype` where that declares it by name.
 *
 * Core's own edits, the ones its save applies, run on the text as it stands. Empty when the
 * catalog does not list the function under that interface, or when there is no catalog part.
 */
export function scJsonFunctionRenameEdits(text: string, rename: CatalogFunctionRename): ScTextEdit[] {
  return scFunctionRenameEdits(text, scanScJsonFunctions(text), asFunctionRenames(rename));
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

/**
 * The catalog member swap that carries a function rename into a compressed-binary
 * dictionary, or null when there is nothing to carry. It has `scXmlRenamePatch`'s shape, so
 * it rides `pushEdit` and its undo the same way, and `before` is again the member's original
 * bytes.
 */
export function scXmlFunctionRenamePatch(
  zipMeta: Record<string, Uint8Array>,
  rename: CatalogFunctionRename,
): ScPartPatch | null {
  const before = zipMeta[SC_PART_XML];
  if (!before) {
    return null;
  }
  const xml = new TextDecoder().decode(before);
  const edits = scFunctionRenameEdits(xml, scanScXmlFunctions(xml), asFunctionRenames(rename));
  if (edits.length === 0) {
    return null;
  }
  return { member: SC_PART_XML, before, after: new TextEncoder().encode(applyScEdits(xml, edits)) };
}
