// Copyright 2026 The MathWorks, Inc.
import { parseTree, type Node } from 'jsonc-parser';
import { toEntrySelector, type EntrySelector } from './entrySelector.js';

/**
 * Read the value node of a named property from an object node.
 * Returns null if the node is not an object or the property is absent.
 */
function getProperty(objectNode: Node | null | undefined, key: string): Node | null {
  if (!objectNode || objectNode.type !== 'object' || !objectNode.children) {
    return null;
  }
  for (const prop of objectNode.children) {
    if (prop.type !== 'property' || !prop.children || prop.children.length < 2) {
      continue;
    }
    const keyNode = prop.children[0];
    // PRECONDITION (untested) for the `type === 'string'` half: jsonc-parser only
    // emits a `property` node when its key is a quoted string (an unquoted or
    // numeric key parses to no property at all), so the type check never rejects.
    // Kept so the value comparison cannot be reached with a non-string key.
    if (keyNode.type === 'string' && keyNode.value === key) {
      return prop.children[1] ?? null;
    }
  }
  return null;
}

/** Read a string property value from an object node, or null. */
function getStringProperty(objectNode: Node | null | undefined, key: string): string | null {
  const valueNode = getProperty(objectNode, key);
  if (valueNode && valueNode.type === 'string' && typeof valueNode.value === 'string') {
    return valueNode.value;
  }
  return null;
}

/**
 * Walk the .sldd structure to the `entries` array node, or null.
 *
 *   root → "__MW_TEXT_PARTS__" → "__MW_TEXT_PART__/data/chunk0"
 *        → "__MW_TEXT_content" → "entries"[]
 *
 * Returns null if any step of the path is missing or `entries` is not an array.
 * Never throws.
 */
function findEntriesArray(text: string): Node | null {
  const root = parseTree(text);
  if (!root || root.type !== 'object') return null;
  const parts = getProperty(root, '__MW_TEXT_PARTS__');
  const chunk0 = getProperty(parts, '__MW_TEXT_PART__/data/chunk0');
  const content = getProperty(chunk0, '__MW_TEXT_content');
  const entries = getProperty(content, 'entries');
  if (!entries || entries.type !== 'array' || !entries.children) return null;
  return entries;
}

/** The metadata uuid of an entry element, or null when it declares none. */
function elementUuid(el: Node): string | null {
  return getStringProperty(getProperty(el, 'metadata'), 'uuid');
}

// Index within the entries array of the element the selector names, or -1.
// Non-object elements can never match, so they are skipped.
//
// Names are matched first, and the uuid is consulted ONLY to break a tie: entry
// names are unique per namespace, not per file, so `Array` in Design and `Array`
// in Other Data are two entries with one name. Keying on the name alone made a
// same-named pair resolve to whichever came first in the array, so deleting the
// SECOND one spliced out the first — the user watched the row they had not
// touched disappear while the one they deleted stayed. When the selector carries
// no uuid (a bare-name caller), or no candidate matches it, the first name match
// stands, which is what a file with no duplicate always yields.
function indexOfEntryElement(elements: Node[], selector: EntrySelector): number {
  const matches: number[] = [];
  elements.forEach((el, i) => {
    if (el.type === 'object' && getStringProperty(el, 'name') === selector.name) matches.push(i);
  });
  if (matches.length === 0) return -1;
  if (matches.length === 1 || !selector.uuid) return matches[0];
  const exact = matches.find((i) => elementUuid(elements[i]) === selector.uuid);
  return exact ?? matches[0];
}

/**
 * Locate the `{...}` span of the entry object the selector identifies (see
 * entrySelector.ts — a bare string means "whichever entry has this name").
 *
 * Returns the element object node's offset/length, or null if the entries array
 * is missing or no element matches. Never throws.
 */
export function findEntrySpan(
  text: string,
  target: string | EntrySelector,
): { offset: number; length: number } | null {
  const elements = findEntriesArray(text)?.children ?? [];
  const idx = indexOfEntryElement(elements, toEntrySelector(target));
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
  const elements = findEntriesArray(text)?.children ?? [];
  const idx = indexOfEntryElement(elements, toEntrySelector(target));
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
 * Compute where to INSERT a new element in the entries array and how the array
 * is indented, so paste can append a uniquely-named entry. Returns:
 *  - `offset`: text offset to insert at (just after the last element, or just
 *    inside `[` for an empty array),
 *  - `needsLeadingComma`: whether a `,` must precede the inserted element,
 *  - `elementIndent`: the leading whitespace of existing elements (for lining
 *    the new element up), or a best-effort default for an empty array.
 * Returns null if the entries array can't be found.
 */
export function findEntriesArrayInsertion(
  text: string,
): { offset: number; needsLeadingComma: boolean; elementIndent: string } | null {
  const entries = findEntriesArray(text);
  if (!entries) return null;
  // PRECONDITION (untested) for `?? []`: findEntriesArray already rejects a node
  // without `children`, and jsonc-parser always gives an array node one anyway —
  // `[]` and even an unterminated `[` both yield an empty array. The fallback
  // keeps the empty-array insert path below correct for a parser change.
  const elements = entries.children ?? [];
  if (elements.length > 0) {
    const last = elements[elements.length - 1];
    // Indent = whitespace on the line where the last element begins.
    const lineStart = text.lastIndexOf('\n', last.offset - 1) + 1;
    const elementIndent = text.slice(lineStart, last.offset);
    return { offset: last.offset + last.length, needsLeadingComma: true, elementIndent };
  }
  // Empty array `[]` or `[ ]`: insert just after the `[`.
  const open = text.indexOf('[', entries.offset);
  const baseIndent = detectIndent(text);
  return { offset: open + 1, needsLeadingComma: false, elementIndent: baseIndent.repeat(5) };
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
