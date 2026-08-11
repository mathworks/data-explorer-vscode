// Copyright 2026 The MathWorks, Inc.
//
// Pure (VS-Code-free) text transforms for STRUCTURAL edits — delete, add-child,
// and paste — that keep untouched entries byte-identical. Each takes already-
// resolved model nodes (the host locates them via findNode) plus the current
// document text, and returns the new text and the row id to re-select.
//
// Two shapes of edit:
//  - Whole-entry array changes (delete a top-level entry, paste a new one) →
//    splice the `entries` array element via entrySplice helpers.
//  - Within-entry changes (delete a nested child, add a child) → mutate the
//    model, reserialize JUST the owning entry, and replace its span — the exact
//    byte-scoped pattern applyEdit uses for value edits, so siblings are
//    untouched for free.

import {
  findEntrySpan,
  findEntryElementSpan,
  findEntriesArrayInsertion,
  detectIndent,
} from './entrySplice.js';
import { generateUuid } from '../dex/datamodel/node/container/SectionNode.js';

export interface StructuralResult {
  newText: string;
  selectId: string | null;
}

// Walk up from any node to its owning top-level entry (the node where
// `isEntry` is true), or null if there is none. Section rows and detached
// nodes have no owning entry.
export function findOwningEntry(node: any): any {
  let entry: any = node;
  while (entry && !entry.isEntry) entry = entry.parent;
  return entry ?? null;
}

// Reserialize one entry to text, indented to its array depth (5 levels), the
// same way applyEdit does. The first line stays un-indented (the splice target
// begins mid-line at the element's `{`); continuation lines get the full indent.
export function reserializeEntry(entry: any, indent: string): string {
  const lines = JSON.stringify(entry.serialize(), null, indent).split('\n');
  return lines.map((line, i) => (i === 0 ? line : indent.repeat(5) + line)).join('\n');
}

// The row id to select after removing `node` from `siblings`: the previous
// sibling if any, else the next, else the fallback (parent/section) id.
function reselectAfterRemoval(siblings: any[], node: any, fallbackId: string): string {
  const idx = siblings.indexOf(node);
  if (idx > 0) return siblings[idx - 1].id;
  if (idx >= 0 && idx < siblings.length - 1) return siblings[idx + 1].id;
  return fallbackId;
}

/** Delete a top-level entry by removing its element (and one comma) from the array. */
export function deleteEntry(text: string, entry: any): StructuralResult {
  const section = entry.parent;
  const siblings = (section?.children ?? []) as any[];
  const selectId = reselectAfterRemoval(siblings, entry, `section:${section?.name ?? ''}`);
  const span = findEntryElementSpan(text, entry.name);
  if (!span) throw new Error(`Could not locate entry "${entry.name}" to delete.`);
  const newText = text.slice(0, span.offset) + text.slice(span.offset + span.length);
  return { newText, selectId };
}

/** Delete a nested child: remove it from its parent, reserialize the owning entry. */
export function deleteChild(text: string, node: any): StructuralResult {
  const parent = node.parent;
  if (!parent || typeof parent.canRemoveChild !== 'function' || !parent.canRemoveChild()) {
    throw new Error('This item cannot be deleted.');
  }
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');

  const selectId = reselectAfterRemoval(parent.children ?? [], node, parent.id);
  parent.removeChildNode(node);

  const indent = detectIndent(text);
  const entryText = reserializeEntry(entry, indent);
  const span = findEntrySpan(text, entry.name);
  if (!span) throw new Error(`Could not locate entry "${entry.name}" text.`);
  const newText = text.slice(0, span.offset) + entryText + text.slice(span.offset + span.length);
  return { newText, selectId };
}

/** Add a child to a container node (struct/bus/enum), reserialize its owning entry. */
export function addChild(text: string, node: any): StructuralResult {
  if (typeof node.canAddChild !== 'function' || !node.canAddChild()) {
    throw new Error('This item cannot have children added.');
  }
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');

  const child = node.addChildNode();
  if (!child) throw new Error('Failed to add a child element.');

  const indent = detectIndent(text);
  const entryText = reserializeEntry(entry, indent);
  const span = findEntrySpan(text, entry.name);
  if (!span) throw new Error(`Could not locate entry "${entry.name}" text.`);
  const newText = text.slice(0, span.offset) + entryText + text.slice(span.offset + span.length);
  return { newText, selectId: child.id };
}

/** Deep-clone a clipboard payload so repeated pastes don't alias the same object. */
export function cloneForPaste(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload));
}

/**
 * Paste a serialized entry as a NEW top-level entry in `section`. The name is
 * made unique within the section, the entry gets a freshly generated uuid so it
 * is a distinct object (never a duplicate of the source's), and the metadata
 * namespace is rewritten to the target section's so a cross-section paste
 * survives the reparse. Inserts the element into the entries array, preserving
 * sibling bytes.
 */
export function pasteEntry(
  text: string,
  section: any,
  payload: Record<string, unknown>,
  sectionNamespace: string | undefined,
): StructuralResult {
  const raw = cloneForPaste(payload);
  const baseName = typeof raw.name === 'string' ? raw.name : 'Entry';
  raw.name = section._uniqueName(baseName);
  if (raw.metadata && typeof raw.metadata === 'object') {
    // A pasted entry is a new object: give it its own uuid rather than
    // duplicating the source's, matching the add-entry path (SectionNode).
    (raw.metadata as Record<string, unknown>).uuid = generateUuid();
    if (sectionNamespace) {
      (raw.metadata as Record<string, unknown>).namespace = sectionNamespace;
    }
  }

  const newNode = section.parseEntry(raw);
  if (!newNode) throw new Error('Failed to paste the entry.');

  const indent = detectIndent(text);
  const entryText = reserializeEntry(newNode, indent);
  const insertion = findEntriesArrayInsertion(text);
  if (!insertion) throw new Error('Could not locate the entries array.');

  const prefix = insertion.needsLeadingComma ? ',\n' + insertion.elementIndent : insertion.elementIndent;
  const inserted = prefix + entryText;
  const newText = text.slice(0, insertion.offset) + inserted + text.slice(insertion.offset);
  return { newText, selectId: newNode.id };
}
