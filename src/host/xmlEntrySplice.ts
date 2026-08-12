// Copyright 2026 The MathWorks, Inc.
//
// Pure, offset-aware location of entry spans in a data/chunk0.xml string — the XML
// analog of entrySplice.ts. No value parsing. Relies on the verified invariant that
// an <Object Class="DD.ENTRY">…</Object> fragment never contains a nested <Object>
// (nested objects serialize as <Element Class="...">), so a linear scan of the
// entry open/close tags is unambiguous. Never throws; returns null when not found.

const ENTRY_OPEN = '<Object Class="DD.ENTRY">';
const OBJECT_CLOSE = '</Object>';
const DICT_OPEN = '<Object Class="DD.Dictionary">';
const DICTREF_OPEN = '<Object Class="DD.DICTIONARYREFERENCE">';

export interface XmlSpan {
  offset: number;
  length: number;
}

// Read the entry Name from a fragment via its Name P-node.
function entryNameOf(fragment: string): string | null {
  const m = fragment.match(/<P Name="Name" Class="char">([^<]*)<\/P>/);
  return m ? m[1] : null;
}

/** Byte span of the <Object Class="DD.ENTRY">…</Object> whose Name equals entryName. */
export function findEntryObjectSpan(xml: string, entryName: string): XmlSpan | null {
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(ENTRY_OPEN, pos);
    if (start < 0) return null;
    const end = xml.indexOf(OBJECT_CLOSE, start);
    if (end < 0) return null;
    const endExclusive = end + OBJECT_CLOSE.length;
    const fragment = xml.slice(start, endExclusive);
    if (entryNameOf(fragment) === entryName) {
      return { offset: start, length: endExclusive - start };
    }
    pos = endExclusive;
  }
}

/**
 * Span to REMOVE to delete an entry: its <Object> plus the leading whitespace of
 * its line (so the line is removed cleanly) through the newline after </Object>.
 * Removing this leaves the surrounding entries/dictionary well-formed.
 */
export function findEntryElementSpan(xml: string, entryName: string): XmlSpan | null {
  const span = findEntryObjectSpan(xml, entryName);
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
  // Back up to the start of that object's line so the inserted entry aligns.
  const lineStart = xml.lastIndexOf('\n', target - 1) + 1;
  return lineStart;
}
