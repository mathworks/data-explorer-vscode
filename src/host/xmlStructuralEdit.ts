// Copyright 2026 The MathWorks, Inc.
//
// Pure (VS-Code-free) XML text transforms for structural edits on a binary .sldd's
// data/chunk0.xml — the XML analog of structuralEdit.ts. Each edit regenerates the
// WHOLE touched entry's <Object> fragment (via serializeEntryToXml) and byte-splices
// it, so untouched sibling entries stay byte-identical. Model-node helpers
// (findOwningEntry, resolveSectionForPaste, cloneForPaste) are shared with the JSON
// path — imported, not duplicated.

import { serializeEntryToXml } from '../dex/datamodel/parser/BinarySlddSerializer.js';
import { generateUuid } from '../dex/datamodel/node/container/SectionNode.js';
import { getSectionMetadata } from '../dex/datamodel/SectionConstants.js';
import { buildSectionRowId } from '../common/sectionRowId.js';
import {
  findEntryObjectSpan,
  findEntryElementSpan,
  findEntryInsertionPoint,
} from './xmlEntrySplice.js';
import { findOwningEntry, cloneForPaste, assertConstantValueAllowed, type StructuralResult } from './structuralEdit.js';

export type { StructuralResult };

// Reserialize one entry to its <Object> fragment (no trailing newline), for an
// in-place span replacement.
export function reserializeEntryXml(entry: any): string {
  return serializeEntryToXml(entry).replace(/\n$/, '');
}

// The row id to select after removing `node` from `siblings`: the previous
// sibling if any, else the next, else the fallback id.
function reselectAfterRemoval(siblings: any[], node: any, fallbackId: string): string {
  const idx = siblings.indexOf(node);
  if (idx > 0) return siblings[idx - 1].id;
  if (idx >= 0 && idx < siblings.length - 1) return siblings[idx + 1].id;
  return fallbackId;
}

/** The Simulink class name of a serialized entry payload, or '' if none. */
function payloadClassName(payload: Record<string, unknown>): string {
  const value = payload.value as Record<string, unknown> | undefined;
  return (value && typeof value === 'object' && (value._array_class as string)) || '';
}

// Replace the owning entry's fragment in-place with its reserialized form.
function spliceEntry(text: string, entry: any, selectId: string | null): StructuralResult {
  const frag = reserializeEntryXml(entry);
  const span = findEntryObjectSpan(text, entry.name);
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
  const span = findEntryElementSpan(text, entry.name);
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
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');
  const child = node.addChildNode();
  if (!child) throw new Error('Failed to add a child element.');
  return spliceEntry(text, entry, child.id);
}

/** Add a brand-new default entry of a class into a section. */
export function addEntryXml(text: string, section: any, className: string): StructuralResult {
  const node = section.addEntry(className);
  if (!node) throw new Error(`Could not add a "${className}" entry.`);
  return insertNewEntry(text, node);
}

/** Paste a serialized entry payload as a new entry (mirrors structuralEdit.pasteEntry). */
export function pasteEntryXml(
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
    md.uuid = generateUuid();
    const sectionMeta = getSectionMetadata(section.name);
    md.namespace = sectionMeta.namespace;
    md.isderived = sectionMeta.isderived;
  }
  const newNode = section.parseEntry(raw);
  if (!newNode) throw new Error('Failed to paste the entry.');
  assertConstantValueAllowed(section, newNode);
  return insertNewEntry(text, newNode);
}

/**
 * Paste MANY payloads into `section` in one edit (multi-select drop). All-or-
 * nothing allow-check up front, then a fold over pasteEntryXml so each dropped
 * entry gets a distinct unique name from the growing namespace.
 */
export function pasteEntriesXml(
  text: string,
  section: any,
  payloads: Record<string, unknown>[],
): { newText: string; selectIds: string[] } {
  for (const payload of payloads) {
    const className = payloadClassName(payload);
    if (className && typeof section.allowsType === 'function' && !section.allowsType(className)) {
      throw new Error(`A "${className}" entry is not allowed in ${section.displayName ?? section.name}.`);
    }
  }
  let currentText = text;
  const selectIds: string[] = [];
  for (const payload of payloads) {
    const { newText, selectId } = pasteEntryXml(currentText, section, payload);
    currentText = newText;
    if (selectId) selectIds.push(selectId);
  }
  return { newText: currentText, selectIds };
}

/** Remove many entries by name (high-offset-first so earlier splices stay valid). */
export function deleteEntriesByNameXml(text: string, names: string[]): string {
  const spans: { offset: number; length: number }[] = [];
  for (const name of names) {
    const span = findEntryElementSpan(text, name);
    if (span) spans.push(span);
  }
  spans.sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const span of spans) {
    out = out.slice(0, span.offset) + out.slice(span.offset + span.length);
  }
  return out;
}
