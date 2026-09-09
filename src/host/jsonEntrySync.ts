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
import type { EntryRecord } from './entryOps.js';

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
