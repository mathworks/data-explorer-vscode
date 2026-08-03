// Copyright 2026 The MathWorks, Inc.
import { parseTree, type Node } from 'jsonc-parser';

/**
 * Read the value node of a named property from an object node.
 * Returns null if the node is not an object or the property is absent.
 */
function getProperty(objectNode: Node | undefined, key: string): Node | null {
  if (!objectNode || objectNode.type !== 'object' || !objectNode.children) {
    return null;
  }
  for (const prop of objectNode.children) {
    if (prop.type !== 'property' || !prop.children || prop.children.length < 2) {
      continue;
    }
    const keyNode = prop.children[0];
    if (keyNode.type === 'string' && keyNode.value === key) {
      return prop.children[1] ?? null;
    }
  }
  return null;
}

/** Read a string property value from an object node, or null. */
function getStringProperty(objectNode: Node | undefined, key: string): string | null {
  const valueNode = getProperty(objectNode, key);
  if (valueNode && valueNode.type === 'string' && typeof valueNode.value === 'string') {
    return valueNode.value;
  }
  return null;
}

/**
 * Locate the `{...}` span of the entry object whose "name" equals `entryName`.
 *
 * Walks the .sldd structure:
 *   root → "__MW_TEXT_PARTS__" → "__MW_TEXT_PART__/data/chunk0"
 *        → "__MW_TEXT_content" → "entries"[] → element with matching name.
 *
 * Returns the element object node's offset/length, or null if the path is
 * missing or no element matches. Never throws.
 */
export function findEntrySpan(
  text: string,
  entryName: string,
): { offset: number; length: number } | null {
  const root = parseTree(text);
  if (!root || root.type !== 'object') {
    return null;
  }

  const parts = getProperty(root, '__MW_TEXT_PARTS__');
  const chunk0 = getProperty(parts ?? undefined, '__MW_TEXT_PART__/data/chunk0');
  const content = getProperty(chunk0 ?? undefined, '__MW_TEXT_content');
  const entries = getProperty(content ?? undefined, 'entries');

  if (!entries || entries.type !== 'array' || !entries.children) {
    return null;
  }

  for (const element of entries.children) {
    if (element.type !== 'object') {
      continue;
    }
    if (getStringProperty(element, 'name') === entryName) {
      return { offset: element.offset, length: element.length };
    }
  }
  return null;
}

/** Walk the .sldd structure to the `entries` array node, or null. */
function findEntriesArray(text: string): Node | null {
  const root = parseTree(text);
  if (!root || root.type !== 'object') return null;
  const parts = getProperty(root, '__MW_TEXT_PARTS__');
  const chunk0 = getProperty(parts ?? undefined, '__MW_TEXT_PART__/data/chunk0');
  const content = getProperty(chunk0 ?? undefined, '__MW_TEXT_content');
  const entries = getProperty(content ?? undefined, 'entries');
  if (!entries || entries.type !== 'array' || !entries.children) return null;
  return entries;
}

/**
 * Locate the text span to REMOVE to delete the entry named `entryName` from the
 * entries array — the element object plus the one comma that joins it to its
 * siblings (the preceding comma when it's the last element, otherwise the
 * following comma), and the whitespace between. Removing this span leaves valid
 * JSON. Returns null if the array or element is not found.
 */
export function findEntryElementSpan(
  text: string,
  entryName: string,
): { offset: number; length: number } | null {
  const entries = findEntriesArray(text);
  if (!entries || !entries.children) return null;
  const elements = entries.children;
  const idx = elements.findIndex(
    (el) => el.type === 'object' && getStringProperty(el, 'name') === entryName,
  );
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
  const whitespace = match[1];
  if (whitespace[0] === '\t') {
    return '\t';
  }
  return whitespace;
}
