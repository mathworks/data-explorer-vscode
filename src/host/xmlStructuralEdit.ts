// Copyright 2026 The MathWorks, Inc.
//
// Pure (VS-Code-free) XML text transforms for structural edits on a binary .sldd's
// data/chunk0.xml — the XML analog of structuralEdit.ts. Each edit regenerates the
// WHOLE touched entry's <Object> fragment (via serializeEntryToXml) and byte-splices
// it, so untouched sibling entries stay byte-identical.
//
// Only the SPLICING is format-specific. Everything that decides what an edit MEANS
// — which node owns a row, what a section will accept, what a pasted entry becomes,
// where the selection goes after a delete, the all-or-nothing multi-paste fold — is
// imported from the JSON path, not duplicated. Those rules had been copied here
// once, each copy commented "mirrors the JSON path", and that is exactly the drift
// this repo has already shipped bugs from: a rule fixed on one side leaves the other
// .sldd format classifying entries differently.

import { serializeEntryToXml } from 'data-explorer-core';
import { buildSectionRowId } from '../common/sectionRowId.js';
import {
  findEntryObjectSpan,
  findEntryElementSpan,
  findEntryInsertionPoint,
} from './xmlEntrySplice.js';
import {
  findOwningEntry,
  reselectAfterRemoval,
  prepareEntryForPaste,
  foldPasteEntries,
  type StructuralResult,
} from './structuralEdit.js';
import { entrySelectorOf, type EntrySelector } from './entrySelector.js';

export type { StructuralResult };

// Reserialize one entry to its <Object> fragment (no trailing newline), for an
// in-place span replacement.
export function reserializeEntryXml(entry: any): string {
  return serializeEntryToXml(entry).replace(/\n$/, '');
}

// Replace the owning entry's fragment in-place with its reserialized form.
function spliceEntry(text: string, entry: any, selectId: string | null): StructuralResult {
  const frag = reserializeEntryXml(entry);
  const span = findEntryObjectSpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" text.`);
  const newText = text.slice(0, span.offset) + frag + text.slice(span.offset + span.length);
  return { newText, selectId };
}

// Insert a freshly-created model entry's fragment before the trailing dictionary.
function insertNewEntry(text: string, node: any): StructuralResult {
  const frag = serializeEntryToXml(node); // keeps trailing newline for clean stacking
  const at = findEntryInsertionPoint(text);
  if (at === null) throw new Error('Could not locate the insertion point.');
  const newText = text.slice(0, at) + frag + text.slice(at);
  return { newText, selectId: node.id };
}

/** Delete a top-level entry by removing its <Object> element span. */
export function deleteEntryXml(text: string, entry: any): StructuralResult {
  const section = entry.parent;
  const siblings = (section?.children ?? []) as any[];
  const selectId = reselectAfterRemoval(siblings, entry, buildSectionRowId(section?.name ?? ''));
  // By selector, not name — see entrySelector.ts and the JSON path's deleteEntry.
  const span = findEntryElementSpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" to delete.`);
  const newText = text.slice(0, span.offset) + text.slice(span.offset + span.length);
  return { newText, selectId };
}

/** Delete a nested child: mutate model, reserialize the owning entry, splice it. */
export function deleteChildXml(text: string, node: any): StructuralResult {
  const parent = node.parent;
  if (!parent || typeof parent.canRemoveChild !== 'function' || !parent.canRemoveChild()) {
    throw new Error('This item cannot be deleted.');
  }
  // PRECONDITION (untested), mirroring the JSON path: canRemoveChild restricts
  // `node` to a container's child, and every container sits under a top-level
  // entry (a SECTION has no canRemoveChild). Kept for a detached node.
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');
  const selectId = reselectAfterRemoval(parent.children ?? [], node, parent.id);
  parent.removeChildNode(node);
  return spliceEntry(text, entry, selectId);
}

/** Add a child to a container node, reserialize its owning entry, splice it. */
export function addChildXml(text: string, node: any): StructuralResult {
  if (typeof node.canAddChild !== 'function' || !node.canAddChild()) {
    throw new Error('This item cannot have children added.');
  }
  // PRECONDITION (untested): as in deleteChildXml, every node whose canAddChild()
  // is true sits under a top-level entry (a SECTION's returns false), and every
  // such container's addChildNode() builds a child unconditionally. Both guards
  // are belt-and-braces nets for a future container type.
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');
  const child = node.addChildNode();
  if (!child) throw new Error('Failed to add a child element.');
  return spliceEntry(text, entry, child.id);
}

/**
 * Paste a serialized entry payload as a new entry. Every rule about what the
 * pasted entry BECOMES (allow-check, unique name, section rebind, fresh uuid,
 * Constant value gate) is prepareEntryForPaste, shared with the JSON path; only
 * the fragment insert below is XML-specific.
 */
export function pasteEntryXml(
  text: string,
  section: any,
  payload: Record<string, unknown>,
): StructuralResult {
  return insertNewEntry(text, prepareEntryForPaste(section, payload));
}

/** Multi-paste for a binary .sldd (multi-select drop). See foldPasteEntries. */
export function pasteEntriesXml(
  text: string,
  section: any,
  payloads: Record<string, unknown>[],
): { newText: string; selectIds: string[] } {
  return foldPasteEntries(text, section, payloads, pasteEntryXml);
}

/**
 * Remove many entries, each identified by a selector or a bare name (see
 * entrySelector.ts). Each span is re-found against the text the previous removal
 * produced, mirroring the JSON path: a target listed twice (the same entry
 * reaching the move list from two selected rows) would otherwise be spliced twice
 * from stale offsets, deleting an innocent neighbouring entry's fragment and
 * leaving unbalanced <Object> tags. Absent targets are skipped.
 */
export function deleteEntriesByNameXml(text: string, targets: (string | EntrySelector)[]): string {
  let out = text;
  for (const target of targets) {
    const span = findEntryElementSpan(out, target);
    if (span) out = out.slice(0, span.offset) + out.slice(span.offset + span.length);
  }
  return out;
}
