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
import { entrySelectorOf, type EntrySelector } from './entrySelector.js';
import { generateUuid, getSectionMetadata } from 'data-explorer-core';
import { buildSectionRowId, isSectionRowId, sectionNameFromRowId } from '../common/sectionRowId.js';
import type { DragRegisterItem } from './dragState.js';
import { dropFactsOf } from './dropFacts.js';

/** One byte-scoped replacement of a document's text: `length` bytes at `offset` become `text`. */
export interface TextPatch {
  offset: number;
  length: number;
  text: string;
}

/** The text a patch produces. The one applier, so nothing can apply one differently. */
export function applyTextPatch(text: string, patch: TextPatch): string {
  return text.slice(0, patch.offset) + patch.text + text.slice(patch.offset + patch.length);
}

export interface StructuralResult {
  newText: string;
  selectId: string | null;
  /**
   * The ONE region of the input text this edit changed, when it is one region — which every
   * transform in this file is (see the header: an element spliced, dropped, or inserted).
   *
   * Reported so the host can write that region instead of the whole document: VS Code stores
   * an edit as what it was handed, so a full-text replace makes both the edit and its undo
   * cost a 47.8 MB rewrite to say a 1 KB thing. Optional because the multi-target paths
   * (deleteEntriesByName) change several regions and because the XML transforms share this
   * shape without reporting one — an absent patch simply means "write newText".
   */
  patch?: TextPatch;
}

/**
 * The result of a one-region edit, with `newText` DERIVED from the patch.
 *
 * Which is the whole reason it is a function: a patch that disagreed with the text beside it
 * would write a document neither the model nor the user asked for, and the only way two
 * accounts of one edit cannot drift is for there to be one account. Every transform below
 * that changes a single region goes through here.
 */
function patchResult(text: string, patch: TextPatch, selectId: string | null): StructuralResult {
  return { newText: applyTextPatch(text, patch), selectId, patch };
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
export function resolveSectionForPaste(model: any, node: any, rowId: string): any {
  const owning = node ? findOwningEntry(node) : null;
  if (owning?.parent) return owning.parent;
  if (typeof rowId === 'string' && isSectionRowId(rowId)) {
    const sectionName = sectionNameFromRowId(rowId)!;
    const section = (model?.children ?? []).find((s: any) => s.name === sectionName);
    if (section) return section;
  }
  return null;
}

/**
 * Snapshot the rows a drag started on into the drag-register shape.
 *
 * Shared by BOTH table providers (SlddTextEditorProvider and
 * BinarySlddEditorProvider): the two formats differ only in how they get a live
 * model, never in what a dragged row means, so this ran as two near-identical
 * 35-line copies. A divergence between them would show up as a drag from one
 * .sldd format predicting a different drop than the same drag from the other.
 *
 * `findNode` is injected because that IS the per-format difference. A row id
 * that resolves to nothing, or to a node with no owning entry (a section header,
 * a detached node), contributes nothing rather than aborting the whole drag.
 *
 * Rows are DEDUPED BY OWNING ENTRY. A drag carries whole entries, but a
 * multi-selection is a set of ROWS, and several rows can share one entry — a
 * user shift-selecting a bus and the elements nested under it selects three rows
 * belonging to one entry. Snapshotting per row instead of per entry made that
 * drag paste the bus three times (DataInterface1, DataInterface2,
 * DataInterface3) while a move deleted the single source once, so the user got
 * three copies of what they dragged once.
 *
 * The section facts come from the LAST contributing row, matching how a
 * multi-select drag is only ever within one section.
 */
export function buildDragSnapshot(
  rowIds: unknown,
  findNode: (rowId: string) => any,
): { items: DragRegisterItem[]; sourceSection: string; sourceSectionLabel: string; sourceIsDerived: boolean } {
  const items: DragRegisterItem[] = [];
  const seen = new Set<any>();
  let sourceSection = '';
  let sourceSectionLabel = '';
  let sourceIsDerived = false;
  for (const rowId of Array.isArray(rowIds) ? rowIds : []) {
    const node = findNode(rowId);
    if (!node) continue;
    const entry = findOwningEntry(node);
    if (!entry || !entry.isEntry) continue;
    // Identity, not name: two same-named entries in different sections are
    // genuinely two entries, and both may legitimately be dragged at once.
    if (seen.has(entry)) continue;
    seen.add(entry);
    const payload = entry.serialize() as Record<string, unknown>;
    items.push({ payload, ...dropFactsOf(entry, payload) });
    const section = entry.parent;
    if (section) {
      sourceSection = section.name ?? '';
      sourceSectionLabel = section.displayName ?? section.name ?? '';
      sourceIsDerived = !!entry.isDerived;
    }
  }
  return { items, sourceSection, sourceSectionLabel, sourceIsDerived };
}

// Reserialize one entry to text, indented to its array depth (5 levels), the
// same way applyEdit does. The first line stays un-indented (the splice target
// begins mid-line at the element's `{`); continuation lines get the full indent.
export function reserializeEntry(entry: any, indent: string): string {
  const lines = JSON.stringify(entry.serialize(), null, indent).split('\n');
  return lines.map((line, i) => (i === 0 ? line : indent.repeat(5) + line)).join('\n');
}

// Replace the owning entry's text in-place with its reserialized form — the
// within-entry edit shape described at the top of this file. Both callers below
// had this same four-step body (detect indent, reserialize, find span, splice),
// and its XML counterpart is xmlStructuralEdit.spliceEntry, which the two XML
// callers already share.
function spliceEntry(text: string, entry: any, selectId: string | null): StructuralResult {
  const entryText = reserializeEntry(entry, detectIndent(text));
  const span = findEntrySpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" text.`);
  return patchResult(text, { offset: span.offset, length: span.length, text: entryText }, selectId);
}

// The row id to select after removing `node` from `siblings`: the previous
// sibling if any, else the next, else the fallback (parent/section) id. Shared
// with the XML path, so a delete leaves the selection in the same place whichever
// .sldd format the row came from.
export function reselectAfterRemoval(siblings: any[], node: any, fallbackId: string): string {
  const idx = siblings.indexOf(node);
  if (idx > 0) return siblings[idx - 1].id;
  if (idx >= 0 && idx < siblings.length - 1) return siblings[idx + 1].id;
  return fallbackId;
}

/** Delete a top-level entry by removing its element (and one comma) from the array. */
export function deleteEntry(text: string, entry: any): StructuralResult {
  const section = entry.parent;
  const siblings = (section?.children ?? []) as any[];
  const selectId = reselectAfterRemoval(siblings, entry, buildSectionRowId(section?.name ?? ''));
  // By selector, not name: the node the user right-clicked is a specific entry,
  // and another section's namespace may hold a different entry with the same
  // name. See entrySelector.ts.
  const span = findEntryElementSpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" to delete.`);
  return patchResult(text, { offset: span.offset, length: span.length, text: '' }, selectId);
}

/**
 * Remove a nested child from the in-memory model, reporting the entry whose text
 * has to be reserialized and where the selection should land. This is the part of
 * a nested delete that decides what the edit MEANS — which nodes may be removed,
 * which entry owns the row, where the selection goes — so both .sldd formats
 * share it and only the splicing differs (see the header of xmlStructuralEdit.ts).
 */
export function removeChildFromModel(node: any): { entry: any; selectId: string } {
  const parent = node.parent;
  if (!parent || typeof parent.canRemoveChild !== 'function' || !parent.canRemoveChild()) {
    throw new Error('This item cannot be deleted.');
  }
  // PRECONDITION (untested): the canRemoveChild guard above already restricts
  // `node` to a child of a container (Bus/Struct/Enum), and every container in a
  // parsed model sits under a top-level entry — a SECTION has no canRemoveChild,
  // so a section child can never reach here. Kept for a detached node.
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');

  const selectId = reselectAfterRemoval(parent.children ?? [], node, parent.id);
  parent.removeChildNode(node);
  return { entry, selectId };
}

/**
 * Add a child to a container node in the in-memory model, reporting the owning
 * entry and the new child's id (which the caller selects). Shared by both .sldd
 * formats, for the same reason as removeChildFromModel.
 */
export function addChildToModel(node: any): { entry: any; selectId: string } {
  if (typeof node.canAddChild !== 'function' || !node.canAddChild()) {
    throw new Error('This item cannot have children added.');
  }
  // PRECONDITION (untested): as in removeChildFromModel, every container node in
  // a parsed model has an owning entry — a SECTION's canAddChild() returns false,
  // so the guard above already excludes the only node kind with no entry above it.
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');

  // PRECONDITION (untested): every node type whose canAddChild() returns true
  // (Bus, ConnectionBus, ServiceBus, Struct, EnumType) builds and returns a child
  // unconditionally, so the guard above already excludes every node that could
  // yield null here. Kept as a belt-and-braces net for a future container type.
  const child = node.addChildNode();
  if (!child) throw new Error('Failed to add a child element.');
  return { entry, selectId: child.id };
}

/** Delete a nested child: remove it from its parent, reserialize the owning entry. */
export function deleteChild(text: string, node: any): StructuralResult {
  const { entry, selectId } = removeChildFromModel(node);
  return spliceEntry(text, entry, selectId);
}

/** Add a child to a container node (struct/bus/enum), reserialize its owning entry. */
export function addChild(text: string, node: any): StructuralResult {
  const { entry, selectId } = addChildToModel(node);
  return spliceEntry(text, entry, selectId);
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

// Reject a payload whose class has no home in the target section. Shared by the
// single- and multi-paste paths, which differ only in WHEN they call it: paste
// checks its one payload, drop checks every payload up front so a rejected
// multi-drop leaves the document untouched. A classless payload (a plain MATLAB
// variable) and a section with no allow-list are both unrestricted. Shared with
// the XML path too, so the two .sldd formats can't drift on what a section
// accepts.
export function assertTypeAllowed(section: any, payload: Record<string, unknown>): void {
  const className = payloadClassName(payload);
  if (className && typeof section.allowsType === 'function' && !section.allowsType(className)) {
    throw new Error(`A "${className}" entry is not allowed in ${section.displayName ?? section.name}.`);
  }
}

/**
 * The authoritative Variable→Constant gate, shared by the JSON and XML paste
 * paths. A plain MATLAB variable pasted into a DERIVED section (Architectural
 * Data) becomes a Constant, which must be scalar-numeric. `newNode` is the node
 * section.parseEntry already built — a derived plain variable is reclassed to a
 * ConstantNode, so we test its `isScalarNumeric`. Throws if it isn't, so both
 * keyboard/menu Paste and drop are gated (drop feedback alone is only advisory).
 * Non-variable entries (Bus, Signal, …) have no such flag and are unaffected.
 */
export function assertConstantValueAllowed(section: any, newNode: any): void {
  // Only MATLAB-variable / Constant nodes expose `isScalarNumeric`, so the typeof
  // guard also restricts this to the variable path — object entries are exempt.
  if (
    getSectionMetadata(section.name).isderived === '1' &&
    typeof newNode?.isScalarNumeric === 'boolean' &&
    !newNode.isScalarNumeric
  ) {
    throw new Error(`The value for constant '${newNode.name}' must be scalar and numeric.`);
  }
}

/**
 * Everything a paste does BEFORE it touches text: gate the payload, clone it,
 * rename it, rebind it to the target section, build the node, and gate its value.
 * Returns the new node, already added to the live `section`.
 *
 * Shared by the JSON and XML paste paths, which differ ONLY in how they splice
 * the resulting node into their document. This ran as two copies whose comments
 * each said "mirrors the other path" — the drift they were worried about is what
 * this removes, because every rule below decides where a pasted entry LANDS and a
 * one-sided fix would silently reclassify entries in one format only.
 *
 * The rules, in order:
 *  - The class must have a home in the target section (a Simulink.ServiceBus
 *    cannot go into Design).
 *  - The payload is deep-cloned, so a repeated paste of one clipboard entry does
 *    not alias (and then mutate) the same object.
 *  - The name is made unique across the section's whole NAMESPACE, not just the
 *    section — Design and Architectural Data share one.
 *  - The entry is rebound to the target section UNCONDITIONALLY, creating the
 *    metadata object when the payload carries none. `metadata` is null for an
 *    entry whose source .sldd never declared one (e.g. hand-added in the text
 *    view), and skipping the rebind there left the pasted entry with no namespace
 *    at all — so getSectionKey fell through to its 'design' default and the
 *    reloaded file put the entry in Design Data no matter which section it was
 *    pasted into.
 *  - It gets a FRESH uuid rather than the source's, so it is a distinct object,
 *    matching the add-entry path (SectionNode). Pasting into Architectural Data
 *    is still allowed: the new uuid is simply one the ArchitecturePart /
 *    SystemComposer mapping does not reference yet, which leaves every existing
 *    (referenced) entry intact — the same benign desync already accepted for
 *    add-child. It never corrupts existing references.
 *  - Both metadata fields matter: `namespace` routes the entry, and `isderived`
 *    is what actually distinguishes Arch from Design (they share NS_DESIGN), so
 *    rewriting it is what declassifies an arch paste into a genuine, editable
 *    Design entry.
 */
export function prepareEntryForPaste(section: any, payload: Record<string, unknown>): any {
  assertTypeAllowed(section, payload);

  const raw = cloneForPaste(payload);
  const baseName = typeof raw.name === 'string' ? raw.name : 'Entry';
  raw.name = section._uniqueName(baseName);
  const md = (raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}) as Record<
    string,
    unknown
  >;
  md.uuid = generateUuid();
  const sectionMeta = getSectionMetadata(section.name);
  md.namespace = sectionMeta.namespace;
  md.isderived = sectionMeta.isderived;
  raw.metadata = md;

  // PRECONDITION (untested): parseEntry always returns a node — an unrecognized
  // class becomes a plain ObjectNode and a valueless payload a MatlabVariableNode,
  // so no payload reaching here (they are all serialize() output of a real entry,
  // or clipboard JSON with a name) can make it null. Kept as a defensive net.
  const newNode = section.parseEntry(raw);
  if (!newNode) throw new Error('Failed to paste the entry.');
  assertConstantValueAllowed(section, newNode);
  return newNode;
}

/**
 * Paste a serialized entry as a NEW top-level entry in `section`, inserting the
 * element into the entries array and preserving sibling bytes. See
 * prepareEntryForPaste for every rule about what the pasted entry becomes.
 */
export function pasteEntry(
  text: string,
  section: any,
  payload: Record<string, unknown>,
): StructuralResult {
  const newNode = prepareEntryForPaste(section, payload);

  const indent = detectIndent(text);
  const entryText = reserializeEntry(newNode, indent);
  const insertion = findEntriesArrayInsertion(text);
  if (!insertion) throw new Error('Could not locate the entries array.');

  const prefix = insertion.needsLeadingComma ? ',\n' + insertion.elementIndent : insertion.elementIndent;
  const inserted = prefix + entryText;
  return patchResult(text, { offset: insertion.offset, length: 0, text: inserted }, newNode.id);
}

/**
 * Source-side of a MOVE drop: remove the dragged entries from the SOURCE text.
 * Works purely on text so it applies to any document (the move source may differ
 * from the paste target). Targets are selectors — `entrySelectorOf(payload)` when
 * the caller has the serialized entry, or a bare name when it only has that (see
 * entrySelector.ts). Targets not present are silently skipped, so an already-
 * absent entry never throws (and an all-absent list returns the text unchanged,
 * byte-identical).
 *
 * Each span is re-found against the text produced by the previous removal rather
 * than all being computed up front. Element spans DO overlap, so no ordering of
 * pre-computed spans is safe: the last element's span starts at the END of its
 * predecessor (to absorb the preceding comma), while the predecessor's own span
 * runs forward to the next element's start — the comma between them belongs to
 * both. Removing both stale spans deleted that overlap twice and ate the array's
 * closing bracket, so moving the last two entries out of a document corrupted it
 * into unparseable JSON. Re-finding also makes a duplicated target a no-op on the
 * second pass instead of splicing out an innocent neighbour.
 */
export function deleteEntriesByName(text: string, targets: (string | EntrySelector)[]): string {
  let out = text;
  for (const target of targets) {
    const span = findEntryElementSpan(out, target);
    if (span) out = out.slice(0, span.offset) + out.slice(span.offset + span.length);
  }
  return out;
}

/**
 * Drop-completion transform: paste MANY payloads into `section` in one edit —
 * exactly what a multi-select drop needs. Shared by both .sldd formats, which
 * supply their own single-entry paste (`pasteOne`) and differ in nothing else.
 *
 * It is a fold: each paste re-inserts into the text produced by the previous one
 * AND adds the new node to the live `section`, so `_uniqueName` sees the growing
 * namespace and every dropped entry gets a distinct name (a first Bus becomes
 * Bus1, a second Bus2).
 *
 * The allow-check is all-or-nothing and runs BEFORE the fold: any disallowed
 * payload throws before any text changes, so a rejected multi-drop leaves the
 * document untouched rather than half-applied. That ordering is the whole reason
 * this is shared rather than written per format.
 *
 * A move deletes the sources separately (the host, via deleteEntry) — this side
 * is purely the paste, identical to how drop mirrors copy/cut + paste.
 */
export function foldPasteEntries(
  text: string,
  section: any,
  payloads: Record<string, unknown>[],
  pasteOne: (text: string, section: any, payload: Record<string, unknown>) => StructuralResult,
): { newText: string; selectIds: string[]; patch?: TextPatch } {
  for (const payload of payloads) {
    assertTypeAllowed(section, payload);
  }
  let currentText = text;
  const selectIds: string[] = [];
  // The insertions, folded into one — see composeInsertions for when that is possible and
  // why it is checked rather than assumed.
  let combined: TextPatch | null | undefined = null;
  for (const payload of payloads) {
    const step = pasteOne(currentText, section, payload);
    combined = composeInsertions(combined, step.patch);
    currentText = step.newText;
    if (step.selectId) selectIds.push(step.selectId);
  }
  return { newText: currentText, selectIds, patch: combined ?? undefined };
}

/**
 * Fold a step's patch into the insertion built so far, or give up (undefined).
 *
 * A paste appends its element to the entries array, so the next paste's insertion point is
 * exactly the end of the one before it: N pastes into one text are N appends at one place,
 * hence a single insertion of the concatenated elements. That is what lets a multi-select
 * drop be one narrow write.
 *
 * Every part of that is CHECKED, not trusted: each step must be a pure insertion (`length`
 * 0) landing exactly where the previous one ended, and a step reporting no patch at all (the
 * XML paste, which shares this fold) folds to nothing. Anything else returns undefined,
 * which is the caller's cue to write the whole text — correct, just not narrow. Guessing
 * here would write a document that has an element in it twice, or not at all.
 *
 * `null` means "nothing folded yet"; `undefined` means "cannot be folded".
 */
function composeInsertions(
  soFar: TextPatch | null | undefined,
  step: TextPatch | undefined,
): TextPatch | undefined {
  if (soFar === undefined || !step || step.length !== 0) return undefined;
  if (soFar === null) return { ...step };
  if (step.offset !== soFar.offset + soFar.text.length) return undefined;
  return { offset: soFar.offset, length: 0, text: soFar.text + step.text };
}

/** Multi-paste for a JSON .sldd. See foldPasteEntries. */
export function pasteEntries(
  text: string,
  section: any,
  payloads: Record<string, unknown>[],
): { newText: string; selectIds: string[]; patch?: TextPatch } {
  return foldPasteEntries(text, section, payloads, pasteEntry);
}
