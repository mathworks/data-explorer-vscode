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
// WHAT IT PROMISES. Three facts about the entries array, all cheap and all checkable:
//   - how many elements it holds,
//   - the span of each, and the entry name each one spells, and
//   - which one CONTAINS a given change, if any.
// It deliberately does not validate the JSON. That is what makes it fast, and it is safe
// because the caller checks the count against the model it already has and re-parses the
// one element it is told about — see jsonEntrySync.ts, which turns "no" into the ordinary
// full repaint.
//
// WHO ELSE ASKS. entrySplice.ts — the finders every table edit, delete, add-child and
// paste use to locate the text they REWRITE. It built a jsonc parse tree for that (552 ms
// on the 46 MB dictionary, per edit) until it was pointed here instead. So the names below
// are load-bearing for text the host writes, not only for rows it paints; the invariant
// that they agree with jsonc-parser's tree element for element is pinned in
// entrySpliceScan.test.ts.

/** One element of the entries array, as text. */
export interface EntryElementSpan {
  offset: number;
  length: number;
  /** Position in the entries array, counting from 0. */
  index: number;
  /**
   * The element's OWN top-level `"name"` value, or null when it declares none or one
   * that is not a string (which no selector can match — see entrySelector.ts).
   */
  name: string | null;
}

/** Every element of the entries array, and where the array opens. */
export interface EntriesIndex {
  /** Offset of the `[` that opens the entries array — where an insert into an empty one goes. */
  arrayStart: number;
  /** The elements, in array order. */
  elements: EntryElementSpan[];
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
const COMMA = 0x2c; // ,
const NAME_KEY = '"name"';

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

// A string at depth 2 is one of the element's own KEYS when the nearest non-whitespace
// character before it opens the object or separates its properties; a VALUE is the one that
// follows the `:`. This is the whole reason the name reported for an element is the ENTRY's
// own — never one nested in its properties, and never a value that happens to spell "name".
function isKeyPosition(text: string, quote: number): boolean {
  let back = quote - 1;
  while (back >= 0 && text.charCodeAt(back) <= 0x20) back--;
  const ch = back >= 0 ? text.charCodeAt(back) : 0;
  return ch === LBRACE || ch === COMMA;
}

// The string a `"..."` slice spells, or null when it does not spell one. Almost every entry
// name is plain text, so the common case is a slice; JSON.parse is paid only for a name that
// carries an escape.
function decodeString(raw: string): string | null {
  if (!raw.includes('\\')) return raw.slice(1, -1);
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

// What may sit between two elements of the array: whitespace, and the one comma that joins
// them (none before the first element, none after the last).
//
// This is checked because a SCALAR element — `[ {…}, 1, {…} ]` — opens no brace and so is
// invisible to the walk below, and an element the walk cannot see is worse than one it
// refuses: deleting an entry removes the span from its own start to the NEXT element's start
// (entrySplice.findEntryElementSpan, which is how the joining comma goes with it), so an
// unseen neighbour in between would be deleted along with it. Refusing costs a "Could not
// locate…" on a file no writer of ours produces; answering would lose data.
function isElementGap(text: string, from: number, to: number, expectComma: boolean): boolean {
  let commas = 0;
  for (let i = from; i < to; i++) {
    const ch = text.charCodeAt(i);
    if (ch <= 0x20) continue;
    if (ch !== COMMA) return false;
    commas++;
  }
  return commas === (expectComma ? 1 : 0);
}

/**
 * Walk the entries array, reporting every element's span and name — or null when the array
 * cannot be walked to its end (a truncated or malformed document, or one mid-edit).
 *
 * Every caller's answer is derived from this ONE walk, so there is a single account of where
 * the entries are: what the repaint locates a change in and what the splice rewrites cannot
 * disagree.
 */
function walkElements(text: string, arrayStart: number): EntryElementSpan[] | null {
  const elements: EntryElementSpan[] = [];
  let depth = 0;
  let elementStart = -1;
  let name: string | null = null;
  let nameSeen = false;
  // Where the run of text between elements begins: just inside the `[`, then just after each
  // element's `}`. See isElementGap.
  let gapFrom = -1;

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
      // The element's own `"name"`, taken from the FIRST such key exactly as a parse tree's
      // property lookup does — including when its value is not a string, which leaves the
      // name null so that nothing the model spells can match this element.
      if (depth === 2 && !nameSeen && after - i === NAME_KEY.length && text.startsWith(NAME_KEY, i) && isKeyPosition(text, i)) {
        const colon = skipWhitespace(text, after);
        if (text.charCodeAt(colon) === COLON) {
          nameSeen = true;
          const valueAt = skipWhitespace(text, colon + 1);
          if (text.charCodeAt(valueAt) === QUOTE) {
            const valueEnd = afterString(text, valueAt);
            if (valueEnd < 0) return null; // unterminated name: mid-edit text
            name = decodeString(text.slice(valueAt, valueEnd));
            // Resuming past the value keeps the walk from reading its bytes twice; it holds
            // no structure this walk cares about.
            structural.lastIndex = valueEnd;
          }
        }
      }
      continue;
    }
    if (ch === LBRACE || ch === LBRACKET) {
      depth++;
      if (depth === 1) gapFrom = i + 1; // just inside the `[` that opens the array
      if (depth === 2) {
        // An element that is not an object cannot be an entry; refuse the whole scan
        // rather than count it, so the caller never trusts a count it should not.
        if (ch !== LBRACE) return null;
        if (!isElementGap(text, gapFrom, i, elements.length > 0)) return null;
        elementStart = i;
        name = null;
        nameSeen = false;
      }
      continue;
    }
    // What is left is a closer, `}` or `]` — the regex matches nothing else.
    depth--;
    if (depth === 1) {
      if (ch !== RBRACE || elementStart < 0) return null;
      elements.push({ offset: elementStart, length: i + 1 - elementStart, index: elements.length, name });
      elementStart = -1;
      gapFrom = i + 1;
      continue;
    }
    if (depth === 0) {
      // The array closed. Anything else closing here is not the shape we scanned for, and
      // anything but whitespace after the last element is an element this walk never saw.
      return ch === RBRACKET && isElementGap(text, gapFrom, i, false) ? elements : null;
    }
    if (depth < 0) return null;
  }
  // Ran off the end without closing the array.
  return null;
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
  const elements = walkElements(text, arrayStart);
  if (!elements) return null;
  const hit =
    elements.find((el) => {
      const end = el.offset + el.length;
      return region.start >= el.offset && region.end <= end && region.start < end && region.end > el.offset;
    }) ?? null;
  return { count: elements.length, hit };
}

/**
 * Every element of the entries array, and where the array opens — or null when the text does
 * not spell the path to it, or the array cannot be walked to its end.
 *
 * This is the index the splice finders (entrySplice.ts) resolve a selector against, and the
 * one a repaint locates a change in. Callers that hold it hold the whole account of the
 * array's shape; nobody has to walk the document twice to ask a second question about it.
 */
export function indexEntries(text: string): EntriesIndex | null {
  const arrayStart = findEntriesArrayStart(text);
  if (arrayStart < 0) return null;
  const elements = walkElements(text, arrayStart);
  return elements ? { arrayStart, elements } : null;
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
