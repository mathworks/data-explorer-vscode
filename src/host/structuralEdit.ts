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
import { getSectionMetadata } from '../dex/datamodel/SectionConstants.js';

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

// Resolve the section a paste should target, given the right-clicked row's
// model node (may be null) and its row id. Two cases:
//  - The row is an entry or nested child → its owning entry's parent section.
//  - The row is a SECTION HEADER (`section:<name>`) → that section directly.
//    findNode can't resolve a `section:*` id (a real node id is a name-path,
//    not prefixed), and an empty section can ONLY be pasted into via its header,
//    so we look the section up on the model by name. Returns null if neither
//    path yields a section (e.g. an unknown header, or a detached node).
const SECTION_ROW_PREFIX = 'section:';
export function resolveSectionForPaste(model: any, node: any, rowId: string): any {
  const owning = node ? findOwningEntry(node) : null;
  if (owning?.parent) return owning.parent;
  if (typeof rowId === 'string' && rowId.startsWith(SECTION_ROW_PREFIX)) {
    const sectionName = rowId.slice(SECTION_ROW_PREFIX.length);
    const section = (model?.children ?? []).find((s: any) => s.name === sectionName);
    if (section) return section;
  }
  return null;
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

/** The Simulink class name of a serialized entry payload, or '' if none. */
function payloadClassName(payload: Record<string, unknown>): string {
  const value = payload.value as Record<string, unknown> | undefined;
  return (value && typeof value === 'object' && (value._array_class as string)) || '';
}

/**
 * Paste a serialized entry as a NEW top-level entry in `section`. The name is
 * made unique across the section's whole namespace (Design and Architectural
 * Data share one), the entry gets a freshly generated uuid so it is a distinct
 * object (never a duplicate of the source's), and its metadata namespace AND
 * isderived flag are rewritten to the target section's — so an Arch entry
 * pasted into Design becomes a genuine, editable Design entry (the section split
 * is purely `isderived`). Rejects a payload whose class has no home in the
 * target section (e.g. a Simulink.ServiceBus into Design). Inserts the element
 * into the entries array, preserving sibling bytes.
 *
 * Pasting into Architectural Data is allowed: the new entry gets a fresh uuid
 * the ArchitecturePart / SystemComposer mapping simply does not reference yet,
 * which leaves every existing (referenced) entry intact - the same benign
 * desync already accepted for add-child. It never corrupts existing references.
 */
export function pasteEntry(
  text: string,
  section: any,
  payload: Record<string, unknown>,
): StructuralResult {
  const className = payloadClassName(payload);
  if (className && typeof section.allowsType === 'function' && !section.allowsType(className)) {
    throw new Error(`A "${className}" entry is not allowed in ${section.displayName ?? section.name}.`);
  }

  const raw = cloneForPaste(payload);
  const baseName = typeof raw.name === 'string' ? raw.name : 'Entry';
  raw.name = section._uniqueName(baseName);
  if (raw.metadata && typeof raw.metadata === 'object') {
    const md = raw.metadata as Record<string, unknown>;
    // A pasted entry is a new object: give it its own uuid rather than
    // duplicating the source's, matching the add-entry path (SectionNode).
    md.uuid = generateUuid();
    // Rebind the entry to the target section. Both fields matter: namespace
    // routes it, and isderived is what actually distinguishes Arch from Design
    // (they share NS_DESIGN), so this is what declassifies an arch paste.
    const sectionMeta = getSectionMetadata(section.name);
    md.namespace = sectionMeta.namespace;
    md.isderived = sectionMeta.isderived;
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

/**
 * Source-side of a MOVE drop: remove the dragged entries from the SOURCE text by
 * name. Works purely on text so it applies to any document (the move source may
 * differ from the paste target). Each named top-level entry's array element is
 * spliced out; spans are removed high-offset-first so earlier removals don't
 * shift the offsets of later ones. Names not present are silently skipped, so an
 * already-absent entry never throws (and an all-absent list returns the text
 * unchanged, byte-identical).
 */
export function deleteEntriesByName(text: string, names: string[]): string {
  const spans: { offset: number; length: number }[] = [];
  for (const name of names) {
    const span = findEntryElementSpan(text, name);
    if (span) spans.push(span);
  }
  // Remove from the end so each splice leaves earlier offsets valid.
  spans.sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const span of spans) {
    out = out.slice(0, span.offset) + out.slice(span.offset + span.length);
  }
  return out;
}

/**
 * Drop-completion transform: paste MANY payloads into `section` in one edit —
 * exactly what a multi-select drop needs. It is a fold over pasteEntry: each
 * paste re-inserts into the text produced by the previous one AND adds the new
 * node to the live `section`, so `_uniqueName` sees the growing namespace and
 * every dropped entry gets a distinct name (a first Bus becomes Bus1, a second
 * Bus2). The allow-check is all-or-nothing: any disallowed payload throws before
 * any text changes, so a rejected multi-drop leaves the document untouched. A
 * move deletes the sources separately (the host, via deleteEntry) — this side
 * is purely the paste, identical to how drop mirrors copy/cut + paste.
 */
export function pasteEntries(
  text: string,
  section: any,
  payloads: Record<string, unknown>[],
): { newText: string; selectIds: string[] } {
  // All-or-nothing allow-check up front: reject the whole drop before mutating
  // any text or the section, so a bad item can't leave a half-applied paste.
  for (const payload of payloads) {
    const className = payloadClassName(payload);
    if (className && typeof section.allowsType === 'function' && !section.allowsType(className)) {
      throw new Error(`A "${className}" entry is not allowed in ${section.displayName ?? section.name}.`);
    }
  }
  let currentText = text;
  const selectIds: string[] = [];
  for (const payload of payloads) {
    const { newText, selectId } = pasteEntry(currentText, section, payload);
    currentText = newText;
    if (selectId) selectIds.push(selectId);
  }
  return { newText: currentText, selectIds };
}
