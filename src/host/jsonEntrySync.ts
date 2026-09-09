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
import type { EntryOp, EntryRecord } from './entryOps.js';

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
 * which is what the binary provider does and is cheaper still. A mutation is not a re-parse.
 * Where the two disagree — a rename the systemComposer catalog does not follow, a nested rename
 * the format cannot express, a Description a node accepts and never serializes — the repaint
 * would show something the next wide repaint takes away. Parsing the bytes that were just
 * written makes "the table says what the file says" true by construction, and still costs a
 * fraction of finding the entry again (7 ms against 290 ms on a 46 MB dictionary).
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

  let record: unknown;
  try {
    record = JSON.parse(newText.slice(scan.hit.offset, scan.hit.offset + scan.hit.length));
  } catch {
    return null; // mid-edit element: the full repaint reports it as the parse error it is
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const entryRecord = record as EntryRecord;
  const name = entryRecord.name;
  if (typeof name !== 'string' || name.length === 0) return null;

  const { count, entry } = resolve(model, metaString(entryRecord.metadata, 'uuid'), name);
  // THE structural guard, and the reason nothing here has to reason about what the change
  // did to the array: one element is one entry (SectionNode.parseEntry always adds exactly
  // one child), so a count that still matches the model proves no element was added,
  // removed, or split. A change that restructured the array fails this and goes wide.
  if (count !== scan.count) return null;
  if (!entry) return null;

  // The section an entry lands in is derived from these two metadata fields alone
  // (SlddNode.getSectionKey). A change to either MOVES the entry to another section, which
  // is not a replacement in place, so it is not this path's business.
  const from = entry.metadata;
  if (metaString(entryRecord.metadata, 'namespace') !== metaString(from, 'namespace')) return null;
  if (metaString(entryRecord.metadata, 'isderived') !== metaString(from, 'isderived')) return null;

  return { entry, record: entryRecord };
}
