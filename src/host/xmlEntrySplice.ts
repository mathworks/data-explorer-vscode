// Copyright 2026 The MathWorks, Inc.
//
// Pure, offset-aware location of entry spans in a data/chunk0.xml string — the XML
// analog of entrySplice.ts. No value parsing. Relies on the verified invariant that
// an <Object Class="DD.ENTRY">…</Object> fragment never contains a nested <Object>
// (nested objects serialize as <Element Class="...">), so a linear scan of the
// entry open/close tags is unambiguous. Never throws; returns null when not found.

import { toEntrySelector, type EntrySelector } from './entrySelector.js';

const ENTRY_OPEN = '<Object Class="DD.ENTRY">';
const OBJECT_CLOSE = '</Object>';
const DICT_OPEN = '<Object Class="DD.Dictionary">';
const DICTREF_OPEN = '<Object Class="DD.DICTIONARYREFERENCE">';

export interface XmlSpan {
  offset: number;
  length: number;
}

// Read the entry Name from a fragment via its Name P-node. Attribute-agnostic
// between `Name="Name"` and the closing `>`, because the PARSER is: it matches a
// P-node on its Name attribute alone and never requires `Class="char"`. Demanding
// that attribute here made the two layers disagree about what an entry is — a
// writer that omits it still produced a visible table row, but every structural
// edit on that row failed with "Could not locate entry" because the splicer could
// not find the text the parser had just modelled. A Name P-node with no text
// (`<P Name="Name" Class="char"/>`, how MATLAB writes an empty char) still yields
// null, so such a fragment is SKIPPED rather than matched — otherwise a search
// for a real entry name could land on it and splice over the wrong <Object>.
function entryNameOf(fragment: string): string | null {
  const m = fragment.match(/<P Name="Name"[^>]*>([^<]*)<\/P>/);
  return m ? m[1] : null;
}

// The entry's UUID P-node, or null when the fragment declares none. Attribute-
// agnostic for the same reason entryNameOf is: BinarySlddParser matches a P-node
// on its Name attribute alone.
function entryUuidOf(fragment: string): string | null {
  const m = fragment.match(/<P Name="UUID"[^>]*>([^<]*)<\/P>/);
  return m ? m[1] : null;
}

/**
 * Byte span of the <Object Class="DD.ENTRY">…</Object> the selector identifies
 * (a bare string means "whichever entry has this name").
 *
 * Names are matched first and the UUID breaks a tie, exactly as on the JSON side
 * — a binary .sldd has the same per-namespace name scoping, so `Kp` in Design and
 * `Kp` in Other Data are two entries the name alone cannot tell apart. Without
 * the tiebreak the linear scan returned the FIRST `Kp`, so deleting the second
 * spliced out the first. A selector with no uuid, or one no candidate matches,
 * keeps the historical first-match behaviour.
 */
export function findEntryObjectSpan(xml: string, target: string | EntrySelector): XmlSpan | null {
  const selector = toEntrySelector(target);
  let firstMatch: XmlSpan | null = null;
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(ENTRY_OPEN, pos);
    if (start < 0) return firstMatch;
    const end = xml.indexOf(OBJECT_CLOSE, start);
    if (end < 0) return firstMatch;
    const endExclusive = end + OBJECT_CLOSE.length;
    const fragment = xml.slice(start, endExclusive);
    if (entryNameOf(fragment) === selector.name) {
      const span = { offset: start, length: endExclusive - start };
      // No uuid to discriminate on: first name match wins, as before.
      if (!selector.uuid) return span;
      if (entryUuidOf(fragment) === selector.uuid) return span;
      firstMatch ??= span;
    }
    pos = endExclusive;
  }
}

/**
 * Span to REMOVE to delete an entry: its <Object> plus the leading whitespace of
 * its line (so the line is removed cleanly) through the newline after </Object>.
 * Removing this leaves the surrounding entries/dictionary well-formed.
 */
export function findEntryElementSpan(xml: string, target: string | EntrySelector): XmlSpan | null {
  const span = findEntryObjectSpan(xml, target);
  if (!span) return null;
  // Extend start back to the beginning of the line (indentation).
  let start = span.offset;
  const lineStart = xml.lastIndexOf('\n', start - 1) + 1;
  if (xml.slice(lineStart, start).trim() === '') start = lineStart;
  // Extend end past the trailing newline.
  let end = span.offset + span.length;
  if (xml[end] === '\n') end += 1;
  return { offset: start, length: end - start };
}

/**
 * Offset just before the trailing structural objects (DD.DICTIONARYREFERENCE, then
 * DD.Dictionary) where a new entry should be inserted. Falls back to the
 * DD.Dictionary if no reference object is present. Returns null if neither is found.
 */
export function findEntryInsertionPoint(xml: string): number | null {
  const refIdx = xml.indexOf(DICTREF_OPEN);
  const dictIdx = xml.indexOf(DICT_OPEN);
  const candidates = [refIdx, dictIdx].filter((i) => i >= 0);
  if (candidates.length === 0) return null;
  const target = Math.min(...candidates);
  // Back up to the start of that object's line so the inserted entry aligns —
  // but ONLY when that line holds nothing but the object's indentation. In a
  // single-line document (a real writer shape: two of the .sldd fixtures put the
  // whole chunk on one line) there is no preceding newline, so the line start is
  // offset 0 and backing up put the new entry BEFORE the `<?xml` prolog, writing
  // a file that no longer opens. Same guard findEntryElementSpan already applies
  // to its own line-start extension.
  const lineStart = xml.lastIndexOf('\n', target - 1) + 1;
  return xml.slice(lineStart, target).trim() === '' ? lineStart : target;
}
