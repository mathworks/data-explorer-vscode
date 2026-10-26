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
  indentBefore,
} from './entrySplice.js';
import {
  DataModel,
  applyTextPatch,
  entrySelectorOf,
  generateUuid,
  getSectionMetadata,
  owningEntryOf,
  textDictionaryJson,
  type EntrySelector,
  type TextPatch,
} from 'data-explorer-core';
import { WHOLE_FILE_SECTION, buildSectionRowId, isSectionRowId, sectionNameFromRowId } from '../common/sectionRowId.js';
import type { DragRegisterItem } from './dragState.js';
import type { ClipboardItem } from './clipboard.js';
import { dropFactsOf } from './dropFacts.js';
import { TransferRefused, type TransferTarget } from './transfer.js';
import { recordCopy } from './entryOps.js';

// One byte-scoped replacement of a document's text, and the one applier — both now core's
// (`src/edit/textPatch.ts`), because WHICH REGION a text edit covers is a property of the two
// strings and not of anything that renders them. Re-exported from here rather than imported at
// each use site: this is where the transforms below report a patch from, so it is where every
// other file in the host already names the type, and a re-export keeps all of them reading the
// same specifier they always did.
export type { TextPatch };
export { applyTextPatch };

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
//
// The walk itself is core's now (`owningEntryOf`, beside the `isEntry` it reads): both
// members belong to core's node classes, so "which entry does this row belong to" is a
// question about the MODEL, and this file's named copy of it was the second of two
// spellings — core walked the same chain inline inside DataNode._markModified.
//
// Kept as a name here, and kept `any` in and `any` out, because ~15 call sites in this
// host read the result as a live node and pass it straight to another `any` seam. Typing
// this at core's node class would push a cast onto every one of them to say nothing new.
export function findOwningEntry(node: any): any {
  return owningEntryOf(node);
}

/**
 * A dictionary's section by core's own key (`design`, `arch`, `config`, `other`), or null.
 *
 * One spelling, because two callers now ask the same question for different reasons: a paste
 * into an empty section, which has only its header row to aim at, and the Add gallery, whose
 * tiles name their destination outright and so never had a row to resolve from. A section is
 * a direct child of the dictionary node, so this is a lookup and not a walk.
 */
export function sectionByName(model: any, sectionName: string): any {
  return ((model?.children ?? []) as any[]).find((s) => s.name === sectionName) ?? null;
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
    return sectionByName(model, sectionNameFromRowId(rowId)!);
  }
  return null;
}

/**
 * Where a paste or a drop lands in a dictionary (transfer.ts): the section, and the model it is
 * live in. The model travels with it because the JSON view re-parses whenever its tree is not
 * in step with the text, so asking for "the model" twice can hand back two trees — the section
 * has to be used in the one it was found in.
 */
export interface SectionTarget extends TransferTarget {
  model: any;
  section: any;
}

/**
 * The target a paste or drop onto `rowId` lands in, or null. One answer for both dictionary
 * formats, resolved before anything changes — and by NAME from then on: a same-document move
 * that has to re-read its model after removing the sources finds the section again by its name
 * (`sectionByName`), never through the row, which may have been one of the entries it moved.
 */
export function sectionTarget(model: any, node: any, rowId: string): SectionTarget | null {
  const section = resolveSectionForPaste(model, node, rowId);
  return section ? { sectionName: section.name, model, section } : null;
}

/**
 * Refuse, before anything changes, a paste or drop the section's allow-list will not take.
 *
 * The same check foldPasteEntries makes for every payload before its fold, asked earlier: by
 * then a same-document move has already taken its sources out of the model, so a refusal there
 * has a tree to repair, and here it has none. Worded as it always was, so the message the user
 * sees for a refused class does not depend on which of the two caught it.
 */
export function refuseDisallowedPaste(section: any, payloads: readonly Record<string, unknown>[]): void {
  for (const payload of payloads) {
    try {
      assertTypeAllowed(section, payload);
    } catch (err) {
      throw new TransferRefused(`Failed to apply edit: ${(err as Error).message}`);
    }
  }
}

/**
 * Each row id's owning ENTRY, deduped, in selection order.
 *
 * The one walk behind both registers a paste can come from — the drag register
 * (buildDragSnapshot) and the clipboard (buildClipboardSnapshot). Rows are deduped BY
 * OWNING ENTRY because a gesture carries whole entries while a selection is a set of
 * ROWS, and several rows can share one entry: shift-selecting a bus and two elements
 * nested under it is three rows and one entry. Snapshotting per row made a drag paste
 * the bus three times while the move deleted the single source once.
 *
 * Identity, not name: two same-named entries in different sections are genuinely two
 * entries, and both may legitimately be carried at once.
 *
 * A row id that resolves to nothing, or to a node with no owning entry (a section
 * header, a detached node), contributes nothing rather than aborting the gesture.
 */
function owningEntriesOf(rowIds: unknown, findNode: (rowId: string) => any): any[] {
  const entries: any[] = [];
  const seen = new Set<any>();
  for (const rowId of Array.isArray(rowIds) ? rowIds : []) {
    const node = findNode(rowId);
    if (!node) continue;
    const entry = findOwningEntry(node);
    if (!entry || !entry.isEntry || seen.has(entry)) continue;
    seen.add(entry);
    entries.push(entry);
  }
  return entries;
}

/**
 * A copy, a cut or a drag refused before anything reached its register: an entry that cannot
 * travel (core's copyRefusal). The message names the entry and is shown as it is, never behind
 * a "Failed to" prefix: it is a reason, not a failure.
 */
export class CopyRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopyRefused';
  }
}

/**
 * The section an entry is carried from, as its register item spells `sourceSection`: its
 * section's name in a dictionary, and WHOLE_FILE_SECTION for an entry with no section between
 * it and its document — a MAT-file's variable, whose parent is the file's own source node. That
 * node's name is the srcId it was registered under, which no section rule spells, so a copied
 * variable recorded under it would make no same-file move a no-op and dim no row.
 *
 * Told by the session, not by the node's class: a parent the session holds as a source IS the
 * document. A detached entry, or one whose section has no name, is '' as it always was.
 */
export function sourceSectionOf(entry: any): string {
  const parent = entry?.parent;
  if (!parent) return WHOLE_FILE_SECTION;
  if (typeof parent.name === 'string' && (DataModel as any).getDataSource?.(parent.name) === parent) return WHOLE_FILE_SECTION;
  return parent.name ?? '';
}

/**
 * Refuse, in core's words, the first of `entries` that cannot travel on the clipboard or in a
 * drag (DataModel.copyRefusal): one with no value to write, one past the writer's budget, a
 * MAT-file variable a copy would read back as another value. Asked of every format's entries
 * alike, here, where both registers are filled: the reason a copy can be refused is a fact about
 * the entry, and a check one provider made and another did not is a paste that lands wrong.
 *
 * Asked by id, so only of an entry the session resolves that id to: a node it does not hold, or
 * one whose id it resolves to another node (two same-named MAT-file variables share one), would
 * be judged as something else. Such an entry is left to its serialize(), which the snapshot
 * makes next and which refuses what cannot be written.
 */
function refuseUncopyable(entries: readonly any[]): void {
  for (const entry of entries) {
    if (typeof entry?.id !== 'string' || (DataModel as any).findNodeById?.(entry.id) !== entry) continue;
    const why = DataModel.copyRefusal(entry.id);
    if (why) throw new CopyRefused(why);
  }
}

/**
 * Of `entries`, the ones a move could not take out of their document alone.
 *
 * A move deletes its originals by selector (core's entrySelector.ts): the name, with the uuid
 * consulted only to tell same-named entries apart. A selector with no uuid — every MAT-file
 * variable's, whose payload has no metadata, and a dictionary entry added by hand — names
 * whichever entry of that name the delete finds first, and a document can hold two: a
 * dictionary's in two namespaces, a MAT-file's two records of one name. Such an entry can be
 * copied, never moved: the delete would take out the wrong one, or both.
 *
 * Counted once per document, over every entry in it, because that is the delete's scope (it
 * searches the whole entries array, not the section).
 */
function entriesSharingAName(entries: readonly any[]): Set<any> {
  const shared = new Set<any>();
  const counts = new Map<any, Map<string, number>>();
  for (const entry of entries) {
    if (entrySelectorOf(entry).uuid) continue;
    let root = entry;
    while (root.parent) root = root.parent;
    let names = counts.get(root);
    if (!names) counts.set(root, (names = entryNameCounts(root)));
    if ((names.get(entry.name) ?? 0) > 1) shared.add(entry);
  }
  return shared;
}

// How many entries of the document under `root` answer to each name: its entries are the
// first nodes down each branch that are one (a MAT-file's children, a dictionary's sections'
// children). Nothing below an entry is one.
function entryNameCounts(root: any): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: any) => {
    for (const child of (node?.children ?? []) as any[]) {
      if (child?.isEntry) counts.set(child.name, (counts.get(child.name) ?? 0) + 1);
      else visit(child);
    }
  };
  visit(root);
  return counts;
}

/**
 * Each row's owning entry as a register item: what to paste, the section it came from, the
 * facts a drop target judges it by, whether a move could take its original out alone, and,
 * where its document hands one out (`originOf`), the token its deleter later tells the entry
 * by. The one build behind both registers, after the one refusal they share.
 */
function registerItemsOf(
  rowIds: unknown,
  findNode: (rowId: string) => any,
  originOf?: (entry: any) => object | undefined,
): ClipboardItem[] {
  const entries = owningEntriesOf(rowIds, findNode);
  refuseUncopyable(entries);
  const shared = entriesSharingAName(entries);
  return entries.map((entry): ClipboardItem => {
    const payload = entry.serialize() as Record<string, unknown>;
    const item: ClipboardItem = { payload, sourceSection: sourceSectionOf(entry), ...dropFactsOf(entry, payload) };
    const origin = originOf?.(entry);
    if (origin) item.origin = origin;
    if (shared.has(entry)) item.sharedName = true;
    return item;
  });
}

/**
 * Snapshot the rows a drag started on into the drag-register shape.
 *
 * Shared by every table provider, through clipboardAction's dragEntries: the formats
 * differ only in how they get a live model, never in what a dragged row means, so this
 * ran as two near-identical 35-line copies. A divergence between them would show up as a
 * drag from one .sldd format predicting a different drop than the same drag from the other.
 *
 * `findNode` is injected because that IS the per-format difference. Which rows become
 * which entries — the dedupe by owning entry, and the rows that contribute nothing — is
 * `owningEntriesOf`, shared with the clipboard so the two registers cannot disagree.
 *
 * Each item keeps its OWN source section, as a clipboard item does: a multi-row drag can
 * span sections, and whether a move is a no-op depends on every item's section.
 */
export function buildDragSnapshot(
  rowIds: unknown,
  findNode: (rowId: string) => any,
  originOf?: (entry: any) => object | undefined,
): { items: DragRegisterItem[] } {
  return { items: registerItemsOf(rowIds, findNode, originOf) };
}

/**
 * Snapshot the rows a copy/cut acts on into the clipboard shape.
 *
 * The same walk and the same dedupe as buildDragSnapshot — a different destination
 * register is the only difference, which is what makes `dropDecision.ts`'s invariant
 * ("if you can cut/copy you can drag") true by construction rather than by comment.
 *
 * Each item keeps its OWN source section, as a dragged one does: a cut is lazy, so the
 * source deletion at paste time must find each entry where it actually lives.
 */
export function buildClipboardSnapshot(
  rowIds: unknown,
  findNode: (rowId: string) => any,
  originOf?: (entry: any) => object | undefined,
): ClipboardItem[] {
  return registerItemsOf(rowIds, findNode, originOf);
}

// Reserialize one entry to text, lined up behind the element's own `{`, the same way
// applyEdit does. The first line stays un-indented (the splice target begins mid-line at
// that `{`); continuation lines get `elementIndent`.
//
// `elementIndent` is read from the text by the callers rather than assumed here. It used to
// be `indent.repeat(5)` — true of every dictionary MATLAB writes, since `entries` sits five
// levels down in all of them, but it made the element's first line and its remaining lines
// two separate accounts of one depth, and only one of them was derived from the file.
export function reserializeEntry(entry: any, indent: string, elementIndent = indent.repeat(5)): string {
  return recordText(entry.serialize(), indent, elementIndent);
}

// The text of one serialized record, laid out as reserializeEntry lays out an entry's: the one
// place this editor writes an entry's text (a cell edit, an Add or Delete in it, a paste, an Add).
// Its numbers are spelled as MATLAB spells them in a text dictionary, by core's own writer, which
// its save uses too (textDictionaryJson): JSON.stringify wrote a double of 2^64 - 1 or -2^63 as an
// integer literal past what a 64-bit integer holds, and MATLAB could not open the dictionary.
function recordText(record: unknown, indent: string, elementIndent: string): string {
  const lines = textDictionaryJson(record, indent).split('\n');
  return lines.map((line, i) => (i === 0 ? line : elementIndent + line)).join('\n');
}

/**
 * Where in a serialized value a number sits that JSON.stringify writes as `null` — an Inf, a
 * -Inf or a NaN — as the names leading to it ([] for the value itself), or null when there is
 * none. `_dimensions` is passed by: a text dictionary's own dims can hold the infinity JSON.parse
 * makes of an overflowing extent, which its save writes as it always has, and a pasted one is
 * refused by core before it gets here (MatWriter.textDictionaryForm).
 */
function unwrittenNumberIn(value: unknown, path: string[] = []): { value: number; path: string[] } | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : { value, path };
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const element of value) {
      const found = unwrittenNumberIn(element, path);
      if (found) return found;
    }
    return null;
  }
  for (const [key, member] of Object.entries(value)) {
    if (key === '_dimensions') continue;
    // A bag's own keys (`_elements`, `_properties`) are not names a user knows the value by.
    const found = unwrittenNumberIn(member, key.startsWith('_') ? path : [...path, key]);
    if (found) return found;
  }
  return null;
}

/**
 * Refuse to write a NEW entry into a JSON dictionary with a `null` where its value holds a number.
 *
 * A binary dictionary, and a MAT-file, hold a scalar Inf, -Inf or NaN as the bare number, and so
 * does the record a copy of one carries. A text dictionary spells such a number as text
 * (`{"_type": "double", "_value": "Inf"}`, as MATLAB writes one), and core spells a bare one so as
 * it takes a pasted entry in (SectionNode.parseEntry), at an entry's value, a struct's field, a
 * cell's element and an object's property alike: so a paste never reaches this with one. This is
 * the safety net for a record core handed back as it was — a value it could not take apart, one
 * past its writer's budget — whose bare number this writer (textDictionaryJson, as JSON.stringify
 * does) would write as null:
 * the pasted entry would then read, and save, as another value, with nothing said. Refused
 * instead, naming the entry and where in it the number is; nothing is written.
 *
 * New entries only (a paste, a drop, an Add): the file's own entries are written as they read.
 */
function refuseUnwrittenNumber(newNode: any, record: any): void {
  const found = unwrittenNumberIn(record?.value);
  if (!found) return;
  const spelled = Number.isNaN(found.value) ? 'NaN' : found.value > 0 ? 'Inf' : '-Inf';
  const where = found.path.length ? ` (in ${found.path.join('.')})` : '';
  throw new Error(
    `Cannot paste "${newNode?.name}" into a text dictionary: it holds ${spelled}${where}, ` +
      'which would be written there as null. Nothing was pasted.',
  );
}

// Replace the owning entry's text in-place with its reserialized form — the
// within-entry edit shape described at the top of this file. Both callers below
// had this same four-step body (detect indent, reserialize, find span, splice),
// and its XML counterpart is xmlStructuralEdit.spliceEntry, which the two XML
// callers already share.
function spliceEntry(text: string, entry: any, selectId: string | null): StructuralResult {
  const span = findEntrySpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" text.`);
  const entryText = reserializeEntry(entry, detectIndent(text), indentBefore(text, span.offset));
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
  // name. See core's entrySelector.ts.
  const span = findEntryElementSpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" to delete.`);
  return patchResult(text, { offset: span.offset, length: span.length, text: '' }, selectId);
}

// Whether a node may be removed from its parent: a child of a container (Bus/Struct/
// Enum), never a top-level entry (a SECTION has no canRemoveChild) and never a detached
// node. One predicate because removeChildrenFromModel has to answer it for a whole group
// BEFORE it removes any of them, and a second copy of the condition is how the group
// check and the single check would come to disagree.
function removableChild(node: any): boolean {
  const parent = node?.parent;
  return !!parent && typeof parent.canRemoveChild === 'function' && parent.canRemoveChild();
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
  if (!removableChild(node)) throw new Error('This item cannot be deleted.');
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

/**
 * Remove SEVERAL nested children of ONE entry from the model, reporting the entry to
 * reserialize and where the selection should land.
 *
 * `removeChildFromModel` is this with a list of one; what N adds is a single splice
 * afterwards, which is the bug this exists to prevent. Calling deleteChild twice for two
 * fields of one struct splices the entry twice, and the second splice searches text the
 * first has already rewritten — the span it finds is the wrong length and its write lands
 * over the entry's neighbour. Same reason foldPasteEntries folds N pastes into one
 * insertion instead of writing N times.
 *
 * ALL the children must share one entry, and that is checked rather than assumed: one
 * splice can only rewrite one entry, so a mixed list would drop the other entry's
 * removals from the text while keeping them in the model — a table that disagrees with
 * its own file. The caller that groups them (core's planDeletion) guarantees it;
 * this is what makes the guarantee testable.
 *
 * Both checks run over the WHOLE group before anything is removed, so a group this
 * refuses leaves the model exactly as it found it. Validating as it went would half-apply
 * a gesture that then threw, and the live model would keep those removals until the next
 * re-parse — a table showing a delete the file never received.
 *
 * The selection is the last removal's answer, but only if it survived: reselectAfterRemoval
 * answers per removal, so an earlier one may have taken away the sibling a later one
 * chose. Falling back to the entry keeps the selection on a row that still exists.
 *
 * Both .sldd formats share this and differ only in the splice that follows — see
 * deleteChildren below and deleteChildrenXml in xmlStructuralEdit.ts.
 */
export function removeChildrenFromModel(nodes: readonly any[]): { entry: any; selectId: string } {
  if (!nodes.length) throw new Error('Nothing to delete.');
  const entry = findOwningEntry(nodes[0]);
  if (!entry) throw new Error('Could not locate the owning entry.');
  for (const node of nodes) {
    if (findOwningEntry(node) !== entry) {
      throw new Error('These items are not all in the same entry.');
    }
    if (!removableChild(node)) throw new Error('This item cannot be deleted.');
  }
  // Removals first, one splice after: the text must be rewritten from the entry as it
  // ends up, not once per child.
  const selectIds: string[] = [];
  for (const node of nodes) {
    selectIds.push(removeChildFromModel(node).selectId);
  }
  // reselectAfterRemoval answers per removal, so a later answer can name a sibling an
  // earlier removal already took away. Checked against the tree rather than the node
  // index, because that index is mid-mutation here — mutateEntry re-keys the subtree only
  // after this returns, so findNodeById would still resolve a node that has left.
  const live = subtreeIds(entry);
  const survivor = selectIds.filter((id) => live.has(id)).pop();
  return { entry, selectId: survivor ?? entry.id };
}

// Every id in a subtree as it stands now. An id is a name-path, so a removal does not
// change what its surviving siblings answer to — which is what makes this comparable
// against ids captured before it.
function subtreeIds(node: any, out = new Set<string>()): Set<string> {
  out.add(node.id);
  for (const child of (node.children ?? []) as any[]) subtreeIds(child, out);
  return out;
}

/** Delete several nested children of one entry, reserializing that entry once. */
export function deleteChildren(text: string, nodes: readonly any[]): StructuralResult {
  const { entry, selectId } = removeChildrenFromModel(nodes);
  return spliceEntry(text, entry, selectId);
}

/** Add a child to a container node (struct/bus/enum), reserialize its owning entry. */
export function addChild(text: string, node: any): StructuralResult {
  const { entry, selectId } = addChildToModel(node);
  return spliceEntry(text, entry, selectId);
}

/**
 * Deep-clone a clipboard payload so repeated pastes don't alias the same object.
 *
 * Through entryOps' recordCopy, which the undo records share, and not a JSON round trip: a
 * binary dictionary's payload holds an Inf, a NaN or a -0 as the bare number, which the round
 * trip turned into null or 0, so the pasted entry was another value.
 */
export function cloneForPaste(payload: Record<string, unknown>): Record<string, unknown> {
  return recordCopy(payload) as Record<string, unknown>;
}

/** The Simulink class name of a serialized entry payload, or '' if none. */
function payloadClassName(payload: Record<string, unknown>): string {
  const value = payload.value as Record<string, unknown> | undefined;
  return (value && typeof value === 'object' && (value._array_class as string)) || '';
}

/**
 * The allow-list token a payload has to answer for. An object entry names its own
 * class; a CLASSLESS payload — a plain MATLAB variable, or a variable whose value
 * is a struct — names none, and its token is what it WILL BE once pasted here: a
 * Constant in a derived section (Architectural Data), a MATLAB variable anywhere
 * else. Every payload therefore HAS a token, which is the point: "no class" used
 * to mean "no check", so the one payload kind that carries no class was the one
 * kind no section could refuse.
 *
 * A struct is judged as 'MatlabVariable' and not 'MatlabStruct' even though both
 * are real tokens (SectionNode.addEntry keys the registry by them). No section
 * allows MatlabStruct without also allowing MatlabVariable, so this can only ever
 * be the more permissive of the two — it cannot start refusing a struct anywhere a
 * plain variable is welcome, while still refusing both where neither is.
 */
function payloadAllowToken(section: any, payload: Record<string, unknown>): string {
  return (
    payloadClassName(payload) ||
    (getSectionMetadata(section.name).isderived === '1' ? 'Constant' : 'MatlabVariable')
  );
}

// Reject a payload the target section cannot hold. Shared by the single- and
// multi-paste paths, which differ only in WHEN they call it: paste checks its one
// payload, drop checks every payload up front so a rejected multi-drop leaves the
// document untouched. A section with no allow-list is unrestricted (SectionNode's
// own rule). Shared with the XML path too, so the two .sldd formats can't drift on
// what a section accepts.
export function assertTypeAllowed(section: any, payload: Record<string, unknown>): void {
  if (typeof section.allowsType !== 'function') return;
  const className = payloadClassName(payload);
  if (section.allowsType(payloadAllowToken(section, payload))) return;
  const where = section.displayName ?? section.name;
  // A classless payload has no class name to quote, so name the thing the user
  // dragged rather than the pseudo-token we judged it by.
  throw new Error(
    className
      ? `A "${className}" entry is not allowed in ${where}.`
      : `A MATLAB variable is not allowed in ${where}.`,
  );
}

/**
 * The authoritative Variable→Constant gate, shared by the JSON and XML paste
 * paths. A plain MATLAB variable pasted into a DERIVED section (Architectural
 * Data) becomes a Constant, which must be scalar-numeric. `newNode` is the node
 * section.parseEntry already built — a derived plain variable is reclassed to a
 * ConstantNode, so we test its `isScalarNumeric`. Throws if it isn't, so both
 * keyboard/menu Paste and drop are gated (drop feedback alone is only advisory).
 * Non-variable entries (Bus, Signal, …) have no such flag and are unaffected.
 *
 * `isClassless` says the payload named no class, i.e. it is being MADE a Constant
 * here — such a node must PROVE it is scalar-numeric. Trusting the flag alone was
 * a hole: a struct payload parses to a StructNode, which exposes no
 * `isScalarNumeric` at all, and "no flag" read as "not a variable, exempt" — so a
 * struct landed in Architectural Data as an invalid Constant, even though the
 * webview's drag predictor had already said no-drop for the same gesture.
 */
export function assertConstantValueAllowed(section: any, newNode: any, isClassless = false): void {
  if (getSectionMetadata(section.name).isderived !== '1') return;
  // Only MATLAB-variable / Constant nodes expose `isScalarNumeric`, so the typeof
  // guard restricts this to the variable path — object entries are exempt.
  const mustBeScalarNumeric = isClassless || typeof newNode?.isScalarNumeric === 'boolean';
  if (mustBeScalarNumeric && newNode?.isScalarNumeric !== true) {
    throw new Error(`The value for constant '${newNode?.name}' must be scalar and numeric.`);
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
 *    cannot go into Design), and a payload with no class is judged by the token it
 *    becomes here — see payloadAllowToken.
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
  assertConstantValueAllowed(section, newNode, !payloadClassName(payload));
  return newNode;
}

/**
 * Create a NEW default entry of `className` in `section`, attached to the model.
 *
 * The Add gallery's counterpart to prepareEntryForPaste, and it is one line for the same
 * reason that one is long: core's `addEntry` already IS the rule. It re-tests the section's
 * allow-list (the one gate — see SectionNode), builds the class's own default value, makes
 * the name unique across the whole shared namespace, and stamps uuid, namespace, isderived
 * and status for the section it was handed. Nothing here may re-derive any of that.
 *
 * Shared by both .sldd formats, like prepareEntryForPaste, so a JSON add and a binary add
 * cannot produce differently-classed or differently-stamped entries.
 */
export function createEntry(section: any, className: string): any {
  const node = section.addEntry(className);
  if (!node) {
    // Reached when the section refuses the class. Worth a real message rather than a
    // silent no-op: the gallery only offers legal tiles (its guard test creates every
    // one), so a refusal here means the catalog and core have gone out of step.
    throw new Error(`${className} cannot be added to ${section.displayName || section.name}.`);
  }
  return node;
}

/**
 * Splice a freshly-created or freshly-pasted entry into the `entries` array.
 *
 * Shared by the paste and the add below so there is ONE answer to where a new entry goes in
 * a JSON dictionary. Two answers is the bug this repo has shipped before: the narrow insert
 * and the wide re-parse disagreeing about an entry's position, so the row order changed
 * under the user on the next full repaint.
 */
function insertNewEntry(text: string, newNode: any): StructuralResult {
  const insertion = findEntriesArrayInsertion(text);
  if (!insertion) throw new Error('Could not locate the entries array.');
  // Core spells what JSON has no number for (an Inf, a NaN copied out of a binary dictionary
  // or a MAT-file) as a text dictionary does, `{"_type": "double", "_value": "Inf"}`, as it
  // takes the entry in (parseEntry); a record it handed back as it was is refused rather than
  // written with a null (refuseUnwrittenNumber).
  const record = newNode.serialize();
  refuseUnwrittenNumber(newNode, record);
  const entryText = recordText(record, detectIndent(text), insertion.elementIndent);

  // The line break is unconditional: an element always starts its own line, whether it
  // follows a sibling or opens an empty array. Omitting it in the empty case left the first
  // element sitting on the `[` line, which is not what MATLAB writes AND made the next
  // insert read `"entries": [` as that element's indentation.
  const prefix = (insertion.needsLeadingComma ? ',' : '') + '\n' + insertion.elementIndent;
  const inserted = prefix + entryText + insertion.trailingBreak;
  return patchResult(text, { offset: insertion.offset, length: 0, text: inserted }, newNode.id);
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
  return insertNewEntry(text, prepareEntryForPaste(section, payload));
}

/** Add a new default entry of `className` to `section`. See createEntry. */
export function addNewEntry(text: string, section: any, className: string): StructuralResult {
  return insertNewEntry(text, createEntry(section, className));
}

/**
 * Source-side of a MOVE drop: remove the dragged entries from the SOURCE text.
 * Works purely on text so it applies to any document (the move source may differ
 * from the paste target). Targets are selectors — `entrySelectorOf(payload)` when
 * the caller has the serialized entry, or a bare name when it only has that (see
 * core's entrySelector.ts). Targets not present are silently skipped, so an already-
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
