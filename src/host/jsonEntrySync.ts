// Copyright 2026 The MathWorks, Inc.
//
// Turn one text change in a JSON .sldd into one entry-level model op — or into nothing,
// which means "repaint the old way".
//
// This is the JSON half of the narrow repaint. The binary provider owns its undo stack, so
// it knows what each change was and can describe it as ops directly (entryOps.ts). Here the
// document is a TextDocument the user may be typing into, and the only thing the host is
// handed is a range of text that changed. So the op has to be RECOVERED from the text:
// find the entry the change is inside (jsonEntryScan.ts), re-parse just that element, and
// replace that one entry in the model that is already built.
//
// EVERY DOUBT IS A "NO". A plan is only produced when the text says something narrow
// beyond argument: the change lies in one element, the array still holds exactly as many
// elements as the model has entries, that element parses on its own, and it still names
// the same entry in the same section. Anything else — a structural edit, a mid-edit
// document that is not valid JSON, a change to the file's header, an entry that moved
// namespace — returns null, and the caller falls back to the full parse-and-repaint,
// which is what happens today for all of them. So the failure mode is the old latency,
// never a wrong table.
//
// WHY A WRONG GUESS COULD NOT CORRUPT THE FILE. In this format the TextDocument is the
// truth and the model is only a view of it: saving writes the text, and every structural
// edit re-parses the text before touching it. A plan that resolved the wrong entry would
// mis-paint a row until the next full repaint, not write anything wrong to disk.

import { locateChangedEntry, type ChangeRegion } from './jsonEntryScan.js';
import type { EntryOp, EntryPatch, EntryRecord } from './entryOps.js';

/** The one entry a change touched, and the record the text now spells for it. */
export interface EntrySyncPlan {
  /** The live node in the model the caller passed. */
  entry: any;
  /** Its element re-parsed — exactly what `SectionNode.parseEntry` takes. */
  record: EntryRecord;
}

/** A single `vscode.TextDocumentContentChangeEvent`, as much of it as matters here. */
export interface TextChange {
  /** Offset in the text BEFORE the change. */
  rangeOffset: number;
  /** The text that replaced that range. */
  text: string;
}

/**
 * A whole range replacement — what the host SUBMITS to the document, and what a change event
 * reports back.
 *
 * The plan above needs only where the new text starts and what it says (it reads the entry
 * back out of the document either way). Recognising an edit needs the length too, because
 * that is the difference between "the same text was written here" and "the same text
 * replaced the same bytes".
 */
export interface RangeReplacement extends TextChange {
  /** How many characters of the old text the replacement covered. */
  rangeLength: number;
}

/**
 * Whether a change event is the echo of `submitted` — the edit THIS host just made.
 *
 * The table's edit path mutates the model, serializes the entry, and splices it into the
 * text; the change event that splice fires carries nothing the host does not already know.
 * So it repaints from the node it changed, and the whole recovery the text-view path needs —
 * scan the array, re-parse the element, rebuild the entry a second time — is skipped.
 *
 * What makes that safe is asking the event to prove it is the same edit, byte for byte,
 * rather than trusting a flag set beforehand. A submitted edit whose event never arrives (or
 * arrives changed, e.g. line endings normalized on the way in) leaves the expectation
 * behind; spending it on the NEXT change — a keystroke in the text view, an undo, a save
 * fixup — would repaint one entry and leave stale rows for whatever really changed. Refusing
 * costs the wide repaint the user has always had.
 *
 * A batch is refused outright: only a lone change has an offset that means anything in the
 * text after it, which is the same reason planEntrySync's caller refuses one.
 */
export function isEchoOfEdit(changes: readonly RangeReplacement[], submitted: RangeReplacement): boolean {
  if (changes.length !== 1) return false;
  const change = changes[0];
  return (
    change.rangeOffset === submitted.rangeOffset &&
    change.rangeLength === submitted.rangeLength &&
    change.text === submitted.text
  );
}

/**
 * An edit the host wrote, kept AFTER its own event has come and gone — because VS Code can
 * hand it back again, in either direction, whenever the user asks.
 *
 * An undo of a range replacement writes the replaced bytes back over the replacement, at the
 * same offset; a redo writes the replacement again. So the pair is all it takes to recognise
 * either one, and recognising it is what turns an undo from a stranger's change (find the
 * entry: `getText()` + a full structural walk, 35 ms + 138 ms on a 47.8 MB dictionary) into an
 * element already in hand.
 */
export interface KnownEdit {
  /** The range replacement handed to the document. */
  submitted: RangeReplacement;
  /** The text it wrote over — what an undo of it writes back. */
  replaced: string;
  /**
   * The model ops that restore either side of it, for a STRUCTURAL edit — one whose meaning
   * cannot be read back out of the bytes it writes (see planKnownOps). A cell edit needs none:
   * the bytes it writes are one element, and re-parsing that element says everything.
   */
  patch?: EntryPatch;
}

/**
 * What the host remembers about the edit it just submitted, until the change event arrives.
 *
 * Set immediately before the WorkspaceEdit and spent by the very next change event, once.
 */
export interface HostEdit {
  /** The edited entry as the MODEL now spells it — a rename has already happened. */
  entryId: string;
  /** The id the ROWS ON SCREEN carry for it — before that rename. */
  rowId: string;
  /** The range replacement handed to the document. */
  submitted: RangeReplacement;
}

/** The op the host's own edit amounts to, and the run of rows to paint it over. */
export interface OwnEditPlan {
  op: EntryOp;
  /** The row id the table is holding the entry under (see HostEdit.rowId). */
  entryRowId: string;
}

/**
 * The entry op the host's OWN edit amounts to — no scanning, no re-parse of the document.
 *
 * The table's edit path mutates the model, serializes the entry, and splices it into the text.
 * The change event that splice fires carries nothing the host does not already know, so the
 * whole recovery the text-view path needs — scan the array, find the element the change is in,
 * re-parse it, check the entry count still matches — is skipped: the changed element IS the
 * text that was submitted.
 *
 * WHY THE ENTRY IS REBUILT FROM THAT TEXT rather than repainted from the node the edit mutated,
 * which is what the binary provider does and is cheaper still. A mutation is not a re-parse, and
 * where the two disagree the repaint would show something the next wide repaint takes away. The
 * three disagreements this path was written around have since been fixed at the model layer — a
 * rename now moves the systemComposer catalog with it, and the two cells whose text serialize()
 * dropped (a Description a node has nowhere to write, the Name of an object's Value row) are
 * refused instead of accepted. Reading the bytes back is what made this path correct BEFORE they
 * were, and what keeps it from depending on the next one being found: "the table says what the
 * file says" holds by construction, and still costs a fraction of finding the entry again (7 ms
 * against 290 ms on a 46 MB dictionary).
 *
 * A change that does not prove itself to be the echo is refused (see isEchoOfEdit), and the
 * caller falls back to the recovery path, which reads the same bytes the slow way.
 */
export function planOwnEdit(
  changes: readonly RangeReplacement[],
  hint: HostEdit,
): OwnEditPlan | null {
  if (!isEchoOfEdit(changes, hint.submitted)) return null;
  let record: unknown;
  try {
    record = JSON.parse(hint.submitted.text);
  } catch {
    return null;
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  // The op resolves the entry as the MODEL spells it (the mutation renamed it already); the
  // repaint lands on the id the TABLE still shows. Neither substitutes for the other.
  return {
    op: { kind: 'replace', rowId: hint.entryId, record: record as EntryRecord },
    entryRowId: hint.rowId,
  };
}

function metaString(metadata: unknown, key: string): string {
  const bag = (metadata ?? {}) as Record<string, unknown>;
  const value = bag[key];
  return typeof value === 'string' ? value : '';
}

// The live entry a record names, and the model's total entry count, in one walk.
//
// Resolution is by uuid FIRST because it is the rename-stable half of an entry's identity:
// a rename typed into the text view changes `name` and nothing else, so the entry the
// model holds still answers to the old one. The name is the fallback for a record that
// carries no uuid. Either way an ambiguous answer is no answer — a file with two entries
// of one uuid, or of one name across two namespaces, is exactly where guessing would paint
// the row the user did not touch.
function resolve(model: any, uuid: string, name: string): { count: number; entry: any } {
  let count = 0;
  let byUuid: any = null;
  let uuidHits = 0;
  let byName: any = null;
  let nameHits = 0;
  for (const section of (model?.children ?? []) as any[]) {
    for (const entry of (section?.children ?? []) as any[]) {
      count++;
      if (uuid && metaString(entry.metadata, 'uuid') === uuid) {
        byUuid = entry;
        uuidHits++;
      }
      if (entry.name === name) {
        byName = entry;
        nameHits++;
      }
    }
  }
  if (uuidHits === 1) return { count, entry: byUuid };
  if (uuidHits === 0 && nameHits === 1) return { count, entry: byName };
  return { count, entry: null };
}

/**
 * The entry one element's text spells, resolved in the model that is already built.
 *
 * The half both paths share: where the element text CAME from is the only thing they disagree
 * about (a scan of the document, or an edit the host recognises), and everything after it —
 * does it parse, does it name an entry this model holds, does it still belong in the same
 * section — is the same question asked of the same bytes.
 *
 * `arrayCount` is the number of elements the array was found to hold, for the caller that
 * scanned for them: one element is one entry, so a count that still matches the model proves
 * the change restructured nothing. The caller that recognised its own edit passes none, and
 * needs none — a range replacement of one element by one element (which is what the parse
 * below proves the text to be) cannot add or remove an element.
 */
function planFromElementText(model: any, elementText: string, arrayCount?: number): EntrySyncPlan | null {
  let record: unknown;
  try {
    record = JSON.parse(elementText);
  } catch {
    return null; // mid-edit element: the full repaint reports it as the parse error it is
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const entryRecord = record as EntryRecord;
  const name = entryRecord.name;
  if (typeof name !== 'string' || name.length === 0) return null;

  const { count, entry } = resolve(model, metaString(entryRecord.metadata, 'uuid'), name);
  if (arrayCount !== undefined && count !== arrayCount) return null;
  if (!entry) return null;

  // The section an entry lands in is derived from these two metadata fields alone
  // (SlddNode.getSectionKey). A change to either MOVES the entry to another section, which
  // is not a replacement in place, so it is not this path's business.
  const from = entry.metadata;
  if (metaString(entryRecord.metadata, 'namespace') !== metaString(from, 'namespace')) return null;
  if (metaString(entryRecord.metadata, 'isderived') !== metaString(from, 'isderived')) return null;

  return { entry, record: entryRecord };
}

/**
 * Whether a change event is `known` being UNDONE — the mirror of isEchoOfEdit.
 *
 * VS Code states an undo the way it states any other change: these bytes replaced those. What
 * makes this one recognisable is that the host wrote the bytes being replaced, so it knows all
 * three numbers in advance — same offset, a range as long as what it wrote, and the text it
 * wrote over coming back verbatim.
 */
function isUndoOfEdit(changes: readonly RangeReplacement[], known: KnownEdit): boolean {
  if (changes.length !== 1) return false;
  const change = changes[0];
  return (
    change.rangeOffset === known.submitted.rangeOffset &&
    change.rangeLength === known.submitted.text.length &&
    change.text === known.replaced
  );
}

/**
 * The entry op an undo or a redo of one of the host's OWN edits amounts to — no
 * `document.getText()`, no scan.
 *
 * This is the third and last of the "table → text → table" round trip. A cell edit paints from
 * the model immediately (applyEdit) and its echo is recognised (planOwnEdit); the undo of that
 * same edit used to arrive as a stranger and pay the full recovery — pull the whole document
 * out as a string (35 ms on 47.8 MB) and walk it structurally to find the element the change
 * is in (138 ms) — to learn something the host wrote down when it made the edit.
 *
 * `known` is the ring of edits the host still remembers, newest last; it is searched
 * newest-first because that is the order undo works in. The plan is built from the CHANGE's
 * own text, not from the remembered copy: the match has just proved the two are the same
 * bytes, and planning from what the document actually now says is the version of that
 * statement that cannot drift.
 *
 * Every guard that matters is inherited: recognition is byte-exact at an exact offset (an edit
 * elsewhere shifts the offset and the match simply fails), a batch is refused because its
 * later offsets are stated against the text before it, and the element still has to parse and
 * still has to name an entry this model holds in the same section. A miss costs the scan,
 * which is what every undo used to cost.
 */
export function planKnownChange(
  model: any,
  changes: readonly RangeReplacement[],
  known: readonly KnownEdit[],
): EntrySyncPlan | null {
  if (changes.length !== 1) return null;
  for (let i = known.length - 1; i >= 0; i--) {
    const past = known[i];
    if (isEchoOfEdit(changes, past.submitted) || isUndoOfEdit(changes, past)) {
      return planFromElementText(model, changes[0].text);
    }
  }
  return null;
}

/**
 * The model ops an undo or a redo of one of the host's own STRUCTURAL edits amounts to.
 *
 * planKnownChange above recovers a cell edit's undo by re-parsing the bytes that came back,
 * which works because those bytes are one element and an element says everything about the
 * entry it names. A structural edit's bytes do not. A delete writes back an element AND the
 * comma that separated it; a paste's undo writes back nothing at all; a move's write spans two
 * places at once. There is no element to read, so what the change MEANS is not in its text — it
 * is in what the host knew when it made the edit, which is why the ops are remembered with it.
 *
 * Recognition is the same byte-exact test in both directions (isEchoOfEdit for a redo,
 * isUndoOfEdit for an undo), against the same newest-first ring, and inherits the same guards:
 * an edit anywhere else shifts the offset and the match fails, and a batch is refused because
 * its later offsets are stated against the text before it. An edit remembered without ops
 * answers null and is left to the paths that read bytes.
 *
 * A miss costs the wide repaint, which is what every structural undo used to cost.
 */
export function planKnownOps(
  changes: readonly RangeReplacement[],
  known: readonly KnownEdit[],
): EntryOp[] | null {
  if (changes.length !== 1) return null;
  for (let i = known.length - 1; i >= 0; i--) {
    const past = known[i];
    if (!past.patch) continue;
    if (isEchoOfEdit(changes, past.submitted)) return past.patch.redo;
    if (isUndoOfEdit(changes, past)) return past.patch.undo;
  }
  return null;
}

/**
 * The entry op one text change amounts to, or null when it does not amount to one.
 *
 * `model` is the tree already built for this document, in the state the text was in
 * BEFORE the change; `newText` is the document as it now reads.
 */
export function planEntrySync(model: any, newText: string, change: TextChange): EntrySyncPlan | null {
  // A multi-change event is refused by the caller, not here: only a lone change has
  // offsets that mean anything in the new text (see SlddTextEditorProvider).
  const region: ChangeRegion = {
    start: change.rangeOffset,
    end: change.rangeOffset + change.text.length,
  };
  const scan = locateChangedEntry(newText, region);
  if (!scan || !scan.hit) return null;

  // The element the change landed in, and THE structural guard with it — the reason nothing
  // here has to reason about what the change did to the array: one element is one entry
  // (SectionNode.parseEntry always adds exactly one child), so a count that still matches the
  // model proves no element was added, removed, or split. A change that restructured the array
  // fails it and goes wide.
  return planFromElementText(
    model,
    newText.slice(scan.hit.offset, scan.hit.offset + scan.hit.length),
    scan.count,
  );
}
