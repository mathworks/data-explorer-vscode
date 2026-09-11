// Copyright 2026 The MathWorks, Inc.
//
// Entry-level model ops: the one applier for every change to a binary .sldd's model
// that does NOT come from mutating a node in place — undo, redo, and the forward
// halves of delete/paste/drop.
//
// WHY THESE EXIST. This provider owns its own undo stack: an edit is a pair of
// chunkXml strings, and restoring one used to be the whole story, because the repaint
// that followed re-parsed the document and rebuilt every row. On a real customer
// dictionary that re-parse is ~3 s and the rebuild another ~0.8 s plus a 67 MB
// postMessage, so an edit was fast and its undo took 5-9 s. The fix is the same shape
// as the edit's: change the entries that changed, repaint their rows, leave the other
// 130,000 alone. An op is that unit of change, stated so it can be applied in either
// direction and replayed later.
//
// AN OP IS A SNAPSHOT, NOT AN ACTION. `replace` and `insert` carry the entry's
// serialized record and re-parse it; they do not re-run the edit that produced it.
// That is what makes redo safe for a paste — re-running it would mint another uuid and
// another unique name, so redo would not restore the state undo took away. The record
// is deep-copied on capture for the same reason: it has to describe the entry as it
// was at capture time even after later edits mutate that node.
//
// EVERY OP KEEPS THE SESSION HONEST. A node id is a PATH, so an entry joining,
// leaving, or being renamed inside the tree rekeys itself and its descendants in the
// session's node index. The wide re-parse repaired that as a side effect; here it is
// explicit (DataModel.indexSubtree / unindexSubtree), or findNodeById stops resolving
// the very rows the repaint is about and the NEXT edit on one of them fails with
// "could not locate the edited item".
//
// FAILURE IS ALWAYS A FALLBACK, NEVER A HALF-APPLIED MODEL. Every op throws rather
// than guessing when the model is not the shape it expects; the caller answers a throw
// with the wide repaint, which rebuilds from the text that is already correct.

import { DataModel } from 'data-explorer-core';
import { toEntrySelector, type EntrySelector } from './entrySelector.js';

/** One entry serialized the way `SectionNode.parseEntry` takes it back. */
export type EntryRecord = Record<string, unknown>;

/**
 * Mutate `entry`'s subtree in place, with the session's node index repaired around it.
 *
 * The ops below describe a change to an entry by REBUILDING it from a record; this is the
 * other shape, and the one every cell edit takes — the node the user typed into is changed
 * where it stands. It belongs here because it carries the same obligation, for the same
 * reason: a node id is a PATH, so renaming an entry (or a nested child) rekeys everything
 * beneath it, and the wide re-parse used to repair that as a side effect. An edit that keeps
 * the model it already has must say so explicitly, or findNodeById stops resolving the very
 * row ids the repaint is about and the NEXT edit on one of them fails with "could not locate
 * the edited item".
 *
 * Both providers mutate through here, which is what makes a cell edit mean the same thing in
 * a binary .sldd and a JSON one. Returns whatever the mutation returned, so a setProperty
 * refusal reaches the caller unchanged.
 */
export function mutateEntry<T>(entry: any, mutate: () => T): T {
  return DataModel.mutateSubtree(entry, mutate);
}

/**
 * A change to WHICH entries a dictionary has, or to what one of them holds.
 *
 * Deliberately only three, and all at entry granularity: an edit inside an entry —
 * a value, a rename, a nested child added or deleted — is a `replace` of the whole
 * entry, which is why nothing here has to know how entries are built inside.
 */
export type EntryOp =
  /** Rebuild the entry the table spells `rowId` from `record`, in its own slot. */
  | { kind: 'replace'; rowId: string; record: EntryRecord }
  /** Build `record` into `sectionName` at `index` (clamped; < 0 or past the end = last). */
  | { kind: 'insert'; sectionName: string; index: number; record: EntryRecord }
  /** Detach the entry the table spells `rowId`. */
  | { kind: 'remove'; rowId: string };

/**
 * What an applied op leaves for the views to repaint — one per op, in order.
 *
 * The model change happens once per document; the row repaint happens once per view,
 * so the two are separate steps and this is what passes between them. It names nodes
 * rather than rows because rows are per-view work (each view stamps its own Modified
 * and clipboard marks), and the row ids it does carry are the ones the TABLE spells,
 * which is not always what the model now says (see `entryRowId`).
 */
export type AppliedOp =
  /**
   * Repaint `entry`'s rows over the run the table holds under `entryRowId`. On a
   * rename that id is the entry's OLD one: the rows on screen still carry it.
   */
  | { kind: 'replace'; entryRowId: string; entry: any }
  /** Add `entry`'s rows before `beforeRowId`, or last in its section when absent. */
  | { kind: 'insert'; entry: any; beforeRowId?: string }
  /** Drop the run the table holds under `entryRowId`. */
  | { kind: 'remove'; entryRowId: string };

/**
 * The entry-level ops that restore one pushed edit's two states.
 *
 * What the host hands to its undo stack: `undo` is applied when the user undoes that
 * edit, `redo` when they redo it. Either may be empty, and an edit that could not
 * describe itself supplies no patch at all — the direction then repaints the old way,
 * from a re-parse of the text it just restored.
 */
export interface EntryPatch {
  undo: EntryOp[];
  redo: EntryOp[];
}

/** One forward change and its inverse, collected in the order the changes happen. */
export interface EntryOpPair {
  redo: EntryOp;
  undo: EntryOp;
}

/**
 * Fold ordered forward/inverse pairs into a patch.
 *
 * The undo list comes out REVERSED, which is the whole reason this is a function rather
 * than two array literals per call site: a same-document move is [remove source, insert
 * copy], and undoing it is [remove copy, insert source]. Replaying the inverses in the
 * forward order would insert the source while the copy still holds the name it inherited
 * from it — two entries answering to one name, hence to one id.
 */
export function patchOfPairs(pairs: EntryOpPair[]): EntryPatch {
  return { redo: pairs.map((p) => p.redo), undo: pairs.map((p) => p.undo).reverse() };
}

/**
 * Snapshot one live entry as a record.
 *
 * DEEP-COPIED on purpose. `serialize()` shares sub-objects with the node it came from
 * (the stored value bag is copied one level), and a record captured for the undo stack
 * has to describe the entry as it was at capture time no matter what later edits do to
 * that node — the same reason a paste clones its clipboard payload.
 */
export function entryRecord(entry: any): EntryRecord {
  return JSON.parse(JSON.stringify(entry.serialize())) as EntryRecord;
}

/** The op that restores `entry` as it stands now, over the row id the table shows. */
export function replaceOp(entry: any, rowId: string): EntryOp {
  return { kind: 'replace', rowId, record: entryRecord(entry) };
}

/** The op that puts `entry` back where it stands now — section and position included. */
export function insertOp(entry: any): EntryOp {
  const section = entry.parent;
  return {
    kind: 'insert',
    sectionName: section?.name ?? '',
    index: section ? section.children.indexOf(entry) : -1,
    record: entryRecord(entry),
  };
}

/** The op that takes away the entry the table shows under `rowId`. */
export function removeOp(rowId: string): EntryOp {
  return { kind: 'remove', rowId };
}

/**
 * The row a newly-attached entry's rows go BEFORE — the next entry in its section, or
 * nothing at all when it is that section's last (which is where a paste lands).
 *
 * Exported because two callers need this answer and it has to be the SAME answer: the
 * insert op below, and the host's paste/drop, which attach their new entry themselves
 * (prepareEntryForPaste does it) and so describe the row insert without going through an
 * op. Two copies of the rule is how the narrow insert and the wide rebuild end up
 * disagreeing about where an entry sits.
 */
export function insertAnchorOf(entry: any): string | undefined {
  const siblings = (entry?.parent?.children ?? []) as any[];
  const next = siblings[siblings.indexOf(entry) + 1];
  return next ? next.id : undefined;
}

/**
 * The live entry a clipboard or drag selector means, or nothing.
 *
 * A move deletes its source by NAME (that is all a payload carries across documents), and
 * both providers need the model node behind that name to state the removal as an op. Same
 * rule as the text splices in `deleteEntriesByName`: match on name, and consult the uuid only
 * when more than one entry answers to it — because a .sldd holds several namespaces, so two
 * entries legitimately share a name.
 *
 * Answers null rather than guessing when the name is ambiguous and the uuid cannot settle it.
 * The caller's fallback is the wide repaint, which is slow; moving an entry the user did not
 * touch is wrong.
 */
export function findEntryBySelector(model: any, target: string | EntrySelector): any {
  const selector = toEntrySelector(target);
  const matches: any[] = [];
  for (const section of (model?.children ?? []) as any[]) {
    for (const entry of (section.children ?? []) as any[]) {
      if (entry.name === selector.name) matches.push(entry);
    }
  }
  if (matches.length <= 1) return matches[0] ?? null;
  if (!selector.uuid) return null;
  const byUuid = matches.filter((e) => (e.metadata as any)?.uuid === selector.uuid);
  return byUuid.length === 1 ? byUuid[0] : null;
}

/**
 * The single live entry a section+name pair names, or null.
 *
 * Used where the thing to be found is known by SECTION AND NAME rather than by row id: a
 * clipboard mark travels that way, because it may have been captured in another document and
 * a row id is a path into this one. Which also settles the ambiguity findEntryBySelector has
 * to consult a uuid for — a .sldd holds several namespaces, so two entries legitimately share
 * a name, but only one per section can.
 */
export function findEntryByName(model: any, sectionName: string, entryName: string): any {
  const section = ((model?.children ?? []) as any[]).find((s) => s.name === sectionName);
  return ((section?.children ?? []) as any[]).find((e) => e.name === entryName) ?? null;
}

/**
 * The ops and the repaint for entries a paste has ALREADY attached to `section`.
 *
 * Paste is the one transform that runs ahead of its ops: `prepareEntryForPaste` has to attach
 * the new node before it can ask the section for a unique name, so by the time the caller
 * looks there is nothing left to apply — the model is already right, except for the session
 * index. Hence this shape, which does the two things that are still owed: index each new
 * subtree (a node id is a PATH, so an entry that joined the tree outside an op is in no
 * index, and the row the paste selects would not resolve for the next edit), and describe
 * what happened for the undo stack and the repaint.
 *
 * `addedFrom` is the section's child count read BEFORE the transform. Everything from there
 * on is new, in the order it was pasted, because parseEntry appends.
 *
 * Which is also why every one of these inserts is anchored at the END of the section rather
 * than on its own next sibling. The run is the section's tail, so with N > 1 an entry's next
 * sibling is the NEXT ENTRY OF THE SAME RUN — a row the table does not hold yet, because the
 * rows go out one message per op. `insertEntryRows` answers a place it cannot find with null,
 * and the webview answers null by asking for a full repaint, so a two-item paste would give
 * up the narrow path it had already half-taken. Appended in order, the run lands in order.
 */
export function opsOfPastedEntries(
  section: any,
  addedFrom: number,
): { pairs: EntryOpPair[]; applied: AppliedOp[] } {
  const pairs: EntryOpPair[] = [];
  const applied: AppliedOp[] = [];
  for (const entry of ((section?.children ?? []) as any[]).slice(addedFrom)) {
    DataModel.indexSubtree(entry);
    pairs.push({ redo: insertOp(entry), undo: removeOp(entry.id) });
    applied.push({ kind: 'insert', entry, beforeRowId: undefined });
  }
  return { pairs, applied };
}

/**
 * Apply ops to a model in order, returning what to repaint.
 *
 * Ops are applied left to right, so a caller inverting a list must also REVERSE it:
 * a same-document cut+paste is [remove source, insert copy], and undoing it is
 * [remove copy, insert source]. Order matters for name uniqueness — the copy may hold
 * the name the source is about to get back.
 */
export function applyEntryOps(model: any, ops: EntryOp[]): AppliedOp[] {
  const applied: AppliedOp[] = [];
  for (const op of ops) {
    if (op.kind === 'replace') applied.push(replaceEntry(model, op));
    else if (op.kind === 'insert') applied.push(insertEntry(model, op));
    else applied.push(removeEntry(model, op));
  }
  return applied;
}

// The live entry the table spells `rowId`, or a throw.
//
// The `belongsTo` check guards against a STALE TREE, not against another file. An id is
// a path rooted at the source's srcId, so two open dictionaries can never answer to each
// other's ids — but one dictionary re-parsed is a brand-new object graph registered under
// the same srcId, holding all the same ids. A caller that captured a model, took the wide
// path (which re-registers), and then applied an op would resolve into the new tree while
// repainting rows built from the old one. Checking that the resolved node is still under
// the model the caller named turns that into the wide fallback instead.
function liveEntry(model: any, rowId: string): any {
  const node = DataModel.findNodeById(rowId) as any;
  if (!node) throw new Error(`No entry is indexed under "${rowId}".`);
  if (!node.isEntry) throw new Error(`"${rowId}" is not a top-level entry.`);
  if (!node.parent) throw new Error(`Entry "${rowId}" is detached.`);
  if (!belongsTo(node, model)) throw new Error(`Entry "${rowId}" belongs to another model.`);
  return node;
}

function belongsTo(node: any, model: any): boolean {
  for (let n = node; n; n = n.parent) {
    if (n === model) return true;
  }
  return false;
}

function sectionOf(model: any, name: string): any {
  const found = ((model?.children ?? []) as any[]).find((s) => s.name === name);
  if (!found) throw new Error(`This dictionary has no "${name}" section.`);
  return found;
}

// Build a record into `section`, classified exactly as a re-read would classify it.
//
// The systemComposer catalog is what tells a Simulink.Bus in Architectural Data whether
// it is a StructType or a DataInterface, and SlddNode.parse threads it into every
// parseEntry call. Leaving it out here would make an entry rebuilt by an op carry a
// different Kind from the same entry after a re-parse — the narrow path and the wide
// path disagreeing about the same file.
//
// parseEntry APPENDS the node to the section; both callers below fix the position.
function parseRecord(section: any, record: EntryRecord): any {
  const fresh = section.parseEntry(record, section.parent?.systemComposer ?? null);
  if (!fresh) throw new Error(`Could not rebuild entry "${String(record.name ?? '')}".`);
  return fresh;
}

function replaceEntry(model: any, op: { rowId: string; record: EntryRecord }): AppliedOp {
  const live = liveEntry(model, op.rowId);
  const section = live.parent;
  const index = section.children.indexOf(live);
  // Build first, so a record that will not parse throws before the live entry is
  // touched — the caller's wide fallback then repaints a model that is still intact.
  const fresh = parseRecord(section, op.record);
  section.removeChild(fresh);
  DataModel.unindexSubtree(live, () => section.removeChild(live));
  section.addChild(fresh, index);
  DataModel.indexSubtree(fresh);
  return { kind: 'replace', entryRowId: op.rowId, entry: fresh };
}

function insertEntry(
  model: any,
  op: { sectionName: string; index: number; record: EntryRecord },
): AppliedOp {
  const section = sectionOf(model, op.sectionName);
  const fresh = parseRecord(section, op.record);
  const last = section.children.length - 1;
  const at = op.index < 0 || op.index > last ? last : op.index;
  if (at !== last) {
    section.removeChild(fresh);
    section.addChild(fresh, at);
  }
  DataModel.indexSubtree(fresh);
  // The row anchor is read from the model AFTER the insert, not from the op: the two
  // have to agree about position, and the model is the one the rows are built from.
  return { kind: 'insert', entry: fresh, beforeRowId: insertAnchorOf(fresh) };
}

function removeEntry(model: any, op: { rowId: string }): AppliedOp {
  const live = liveEntry(model, op.rowId);
  const section = live.parent;
  DataModel.unindexSubtree(live, () => section.removeChild(live));
  return { kind: 'remove', entryRowId: op.rowId };
}
