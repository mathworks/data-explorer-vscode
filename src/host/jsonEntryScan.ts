// Copyright 2026 The MathWorks, Inc.
//
// Which entry of a JSON .sldd a text change landed in — found by SCANNING the text,
// never by parsing it.
//
// WHY NOT PARSE. Every keystroke in the plain-text view of a `.sldd` repaints the table,
// and that repaint used to mean: JSON.parse the whole file, rebuild the whole model,
// rebuild every row, and post the lot to the webview. On a 46 MB dictionary (64,700
// entries, 317,000 rows) that is ~1.3 s of host work and a ~120 MB postMessage — per
// keystroke. Rebuilding just the entry that changed costs 0.3 ms, so the only question
// worth answering fast is WHICH entry, and jsonc-parser's parseTree answers it in 483 ms
// on that file (it builds a node for every token in the document, which is most of the
// work we are trying to avoid). A scan of the entries array answers it in 82 ms.
//
// WHAT IT PROMISES. Only two facts, both cheap and both checkable:
//   - how many elements the entries array holds, and
//   - the span of the one element that CONTAINS the change, if any.
// It deliberately does not validate the JSON. That is what makes it fast, and it is safe
// because the caller checks the count against the model it already has and re-parses the
// one element it is told about — see jsonEntrySync.ts, which turns "no" into the ordinary
// full repaint.

/** One element of the entries array, as text. */
export interface EntryElementSpan {
  offset: number;
  length: number;
  /** Position in the entries array, counting from 0. */
  index: number;
}

/** What the scan found. `hit` is null when the change fell outside every element. */
export interface EntryScan {
  /** Elements in the entries array — ALL of them, not just up to the hit. */
  count: number;
  hit: EntryElementSpan | null;
}

/** The half-open text range a single content change occupies in the NEW text. */
export interface ChangeRegion {
  start: number;
  end: number;
}

const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \
const LBRACE = 0x7b; // {
const RBRACE = 0x7d; // }
const LBRACKET = 0x5b; // [
const RBRACKET = 0x5d; // ]
const COLON = 0x3a; // :

// The fixed path to the entries array, spelled exactly as the writer spells it:
//   root → "__MW_TEXT_PARTS__" → "__MW_TEXT_PART__/data/chunk0"
//        → "__MW_TEXT_content" → "entries"[]
// The same walk entrySplice.ts does with a parse tree — kept in step with it by hand
// because this half cannot afford the parse. All four keys are long and unlikely to
// occur as text elsewhere; a false anchor would still have to survive the caller's
// element-count check.
const PATH_KEYS = ['__MW_TEXT_PARTS__', '__MW_TEXT_PART__/data/chunk0', '__MW_TEXT_content'];

// The index just past the closing quote of the string starting at `open`, or -1.
//
// The quote is found with indexOf so the bytes are walked by the engine rather than by this
// loop, which then only has to settle whether the quote it landed on was escaped: a quote
// preceded by an ODD number of backslashes is, an even number is not (`"a\\"` ends).
function afterString(text: string, open: number): number {
  for (let from = open + 1; ; ) {
    const quote = text.indexOf('"', from);
    if (quote < 0) return -1; // unterminated string: mid-edit text
    let back = quote - 1;
    let slashes = 0;
    while (back > open && text.charCodeAt(back) === BACKSLASH) {
      slashes++;
      back--;
    }
    if (slashes % 2 === 0) return quote + 1;
    from = quote + 1;
  }
}

/** The index of the first non-whitespace character at or after `from`. */
function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && text.charCodeAt(i) <= 0x20) i++;
  return i;
}

// The index just past `"key":`, searching from `from`, or -1. The colon is required so a
// key-shaped string in a VALUE cannot anchor the walk.
function afterKey(text: string, key: string, from: number): number {
  const quoted = `"${key}"`;
  for (let at = text.indexOf(quoted, from); at >= 0; at = text.indexOf(quoted, at + 1)) {
    const colon = skipWhitespace(text, at + quoted.length);
    if (text.charCodeAt(colon) === COLON) return colon + 1;
  }
  return -1;
}

/**
 * The offset of the `[` that opens the entries array, or -1 when the text does not spell
 * the path to it (a file of another shape, or one mid-edit).
 */
export function findEntriesArrayStart(text: string): number {
  let at = 0;
  for (const key of PATH_KEYS) {
    at = afterKey(text, key, at);
    if (at < 0) return -1;
    // Each of these keys holds an object; requiring the brace keeps the walk on the
    // structure rather than letting it drift into a following key of the same name.
    at = skipWhitespace(text, at);
    if (text.charCodeAt(at) !== LBRACE) return -1;
    at += 1;
  }
  at = afterKey(text, 'entries', at);
  if (at < 0) return -1;
  at = skipWhitespace(text, at);
  return text.charCodeAt(at) === LBRACKET ? at : -1;
}

/**
 * Count the entries array's elements and find the one containing `region`.
 *
 * Returns null when the array cannot be walked to its end — a truncated or malformed
 * document, which the caller answers with the full repaint that reports the parse error.
 *
 * CONTAINMENT. The region must lie within one element's `{...}` span AND touch its
 * interior. Both halves matter:
 *   - Within, inclusive of the braces, because a table cell edit arrives as a range
 *     replace of the whole element (see SlddTextEditorProvider.applyEdit) and is exactly
 *     as safe as a change inside it: everything outside the span is byte-identical, so
 *     the array's structure is whatever it was, and the element itself is re-parsed.
 *   - Touching the interior, so that a zero-width change AT a brace — the caret left
 *     after deleting the comma that separates two elements — is refused. That deletion
 *     is outside every element, and calling it "inside this one" would report an
 *     unchanged entry while the document silently stopped being valid JSON.
 */
export function scanEntries(text: string, arrayStart: number, region: ChangeRegion): EntryScan | null {
  let depth = 0;
  let count = 0;
  let elementStart = -1;
  let hit: EntryElementSpan | null = null;

  // Only five characters can change what this walk knows, so the walk HOPS between them
  // with a sticky regex instead of looking at every character itself. The engine's search is
  // native; the 46 MB dictionary measures 82 ms this way against 152 ms for a per-character
  // loop, which is most of what a keystroke on that file now costs.
  const structural = /["{}[\]]/g;
  structural.lastIndex = arrayStart;
  for (;;) {
    const next = structural.exec(text);
    if (next === null) break; // no structure left: the array never closed
    const i = next.index;
    const ch = text.charCodeAt(i);
    if (ch === QUOTE) {
      const after = afterString(text, i);
      if (after < 0) return null; // unterminated string: mid-edit text
      structural.lastIndex = after;
      continue;
    }
    if (ch === LBRACE || ch === LBRACKET) {
      depth++;
      if (depth === 2) {
        // An element that is not an object cannot be an entry; refuse the whole scan
        // rather than count it, so the caller never trusts a count it should not.
        if (ch !== LBRACE) return null;
        elementStart = i;
      }
      continue;
    }
    // What is left is a closer, `}` or `]` — the regex matches nothing else.
    depth--;
    if (depth === 1) {
      if (ch !== RBRACE || elementStart < 0) return null;
      const length = i + 1 - elementStart;
      const end = elementStart + length;
      if (region.start >= elementStart && region.end <= end && region.start < end && region.end > elementStart) {
        hit = { offset: elementStart, length, index: count };
      }
      count++;
      elementStart = -1;
      continue;
    }
    if (depth === 0) {
      // The array closed. Anything else closing here is not the shape we scanned for.
      return ch === RBRACKET ? { count, hit } : null;
    }
    if (depth < 0) return null;
  }
  // Ran off the end without closing the array.
  return null;
}

/**
 * The entries array element a single content change landed in, and how many elements the
 * array holds — or null when the text does not answer both.
 */
export function locateChangedEntry(text: string, region: ChangeRegion): EntryScan | null {
  const start = findEntriesArrayStart(text);
  if (start < 0) return null;
  return scanEntries(text, start, region);
}
