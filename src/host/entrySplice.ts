// Copyright 2026 The MathWorks, Inc.
//
// Where in a JSON .sldd's text a given entry lives — the finders every write to that text
// goes through (a table cell edit, a delete, an add-child, a paste, a drop).
//
// These used to answer by building a jsonc parse tree of the whole document, which is a node
// for every token in the file to settle a question about one element: 552 ms on a 46 MB
// customer dictionary, paid on every single edit. The answer now comes from
// jsonEntryScan.indexEntries — the same scan the text-view repaint already used, at 82 ms —
// so the two halves of this file's editing story share ONE account of where the entries are
// instead of holding two that can drift. See entrySpliceScan.test.ts, which pins that index
// against jsonc-parser's tree element for element.
import { indexEntries, type EntryElementSpan } from './jsonEntryScan.js';
import { toEntrySelector, type EntrySelector } from 'data-explorer-core';

// The metadata uuid an element's text declares, or null. Parsing the element is affordable
// here because this is only reached to break a tie between same-named candidates, of which a
// real file has at most a handful — never once per element.
function elementUuid(text: string, el: EntryElementSpan): string | null {
  try {
    const parsed: unknown = JSON.parse(text.slice(el.offset, el.offset + el.length));
    const metadata = ((parsed ?? {}) as { metadata?: unknown }).metadata;
    const uuid = ((metadata ?? {}) as { uuid?: unknown }).uuid;
    return typeof uuid === 'string' ? uuid : null;
  } catch {
    return null;
  }
}

// Index within the entries array of the element the selector names, or -1. An element with no
// string name of its own can never match: the scan reports that as a null name, and no
// selector's name is ever null (core's entrySelector.ts always yields a string), so a numeric or
// missing name is unfindable without a guard for it here.
//
// Names are matched first, and the uuid is consulted ONLY to break a tie: entry
// names are unique per namespace, not per file, so `Array` in Design and `Array`
// in Other Data are two entries with one name. Keying on the name alone made a
// same-named pair resolve to whichever came first in the array, so deleting the
// SECOND one spliced out the first — the user watched the row they had not
// touched disappear while the one they deleted stayed. When the selector carries
// no uuid (a bare-name caller), or no candidate matches it, the first name match
// stands, which is what a file with no duplicate always yields.
function indexOfEntryElement(text: string, elements: EntryElementSpan[], selector: EntrySelector): number {
  const matches: number[] = [];
  elements.forEach((el, i) => {
    if (el.name === selector.name) matches.push(i);
  });
  if (matches.length === 0) return -1;
  if (matches.length === 1 || !selector.uuid) return matches[0];
  const exact = matches.find((i) => elementUuid(text, elements[i]) === selector.uuid);
  return exact ?? matches[0];
}

/**
 * Locate the `{...}` span of the entry object the selector identifies (see
 * core's entrySelector.ts — a bare string means "whichever entry has this name").
 *
 * Returns the element's offset/length, or null if the entries array cannot be
 * scanned or no element matches. Never throws.
 */
export function findEntrySpan(
  text: string,
  target: string | EntrySelector,
): { offset: number; length: number } | null {
  const elements = indexEntries(text)?.elements ?? [];
  const idx = indexOfEntryElement(text, elements, toEntrySelector(target));
  if (idx < 0) return null;
  const { offset, length } = elements[idx];
  return { offset, length };
}

/**
 * Locate the text span to REMOVE to delete the entry the selector identifies
 * from the entries array — the element object plus the one comma that joins it
 * to its siblings (the preceding comma when it's the last element, otherwise the
 * following comma), and the whitespace between. Removing this span leaves valid
 * JSON. Returns null if the array or element is not found.
 */
export function findEntryElementSpan(
  text: string,
  target: string | EntrySelector,
): { offset: number; length: number } | null {
  const elements = indexEntries(text)?.elements ?? [];
  const idx = indexOfEntryElement(text, elements, toEntrySelector(target));
  if (idx < 0) return null;
  const el = elements[idx];

  if (elements.length === 1) {
    // Only element: remove just it, leaving `[ ]`.
    return { offset: el.offset, length: el.length };
  }
  if (idx < elements.length - 1) {
    // Not last: remove from this element's start up to the next element's start
    // (covers the trailing comma + whitespace before the next element).
    const next = elements[idx + 1];
    return { offset: el.offset, length: next.offset - el.offset };
  }
  // Last element: remove from the previous element's end (covers the preceding
  // comma + whitespace) through the end of this element.
  const prev = elements[idx - 1];
  const start = prev.offset + prev.length;
  return { offset: start, length: el.offset + el.length - start };
}

/**
 * The whitespace immediately before `offset` — for normally formatted text, the indent of
 * the line `offset` sits on.
 *
 * Deliberately NOT "everything between the line start and `offset`". An entries element is
 * not guaranteed to begin its line: a minified dictionary puts every element on one line,
 * and our own insert into an EMPTY array used to leave the first element on the `[` line.
 * Slicing the whole line prefix then treated `"entries": [` as indentation and copied it
 * into the file verbatim, producing a document that no longer parsed as JSON — so the
 * second add to a freshly emptied dictionary corrupted it. Taking only the whitespace run
 * degrades to `''` on a minified file instead, which is the right answer there.
 */
export function indentBefore(text: string, offset: number): string {
  let i = offset;
  while (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) i--;
  return text.slice(i, offset);
}

/**
 * Compute where to INSERT a new element in the entries array and how the array
 * is indented, so paste and add can append a uniquely-named entry. Returns:
 *  - `offset`: text offset to insert at (just after the last element, or just
 *    inside `[` for an empty array),
 *  - `needsLeadingComma`: whether a `,` must precede the inserted element,
 *  - `elementIndent`: the whitespace the new element's `{` should sit behind,
 *  - `trailingBreak`: text that must follow the element — the line break and array
 *    indent that put the closing `]` back on its own line when the array was empty,
 *    and `''` when an existing element already established that layout.
 * Returns null if the entries array can't be found.
 */
export function findEntriesArrayInsertion(text: string): {
  offset: number;
  needsLeadingComma: boolean;
  elementIndent: string;
  trailingBreak: string;
} | null {
  const index = indexEntries(text);
  if (!index) return null;
  const elements = index.elements;
  if (elements.length > 0) {
    const last = elements[elements.length - 1];
    return {
      offset: last.offset + last.length,
      needsLeadingComma: true,
      elementIndent: indentBefore(text, last.offset),
      trailingBreak: '',
    };
  }
  // Empty array `[]` or `[ ]`: insert just after the `[`, which is where the scan anchored.
  //
  // The depth is DERIVED from the array's own line rather than assumed: `entries` sits five
  // levels deep in every dictionary MATLAB writes, but hardcoding that made the one case
  // with nothing to copy from the only case that could be wrong, and it is the case a brand
  // new dictionary hits first.
  const arrayLineStart = text.lastIndexOf('\n', index.arrayStart) + 1;
  const arrayIndent = /^[ \t]*/.exec(text.slice(arrayLineStart, index.arrayStart))![0];
  return {
    offset: index.arrayStart + 1,
    needsLeadingComma: false,
    elementIndent: arrayIndent + detectIndent(text),
    trailingBreak: '\n' + arrayIndent,
  };
}

/**
 * Detect the indent unit used by the source text.
 *
 * Returns the leading whitespace of the first indented line: "\t" for tabs, or
 * the run of spaces for a space-indented file. Falls back to two spaces when no
 * indented line is found.
 */
export function detectIndent(text: string): string {
  const match = /^(\t+| +)\S/m.exec(text);
  if (!match) {
    return '  ';
  }
  // A tab-indented file's unit is ONE tab however deep that first line sits; a
  // space-indented file's unit is the whole run of spaces on it.
  const whitespace = match[1];
  return whitespace[0] === '\t' ? '\t' : whitespace;
}
