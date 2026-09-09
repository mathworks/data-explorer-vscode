// Copyright 2026 The MathWorks, Inc.
//
// The splice finders locate an entry by SCANNING the text, not by parsing it.
//
// There were two answers in this repo to one question — "where in this text is entry X" —
// and they cost 7x apart. The text-view sync path scans (jsonEntryScan.ts, 82 ms on a 46 MB
// dictionary); the TABLE edit path built a full jsonc parse tree (entrySplice.ts, 552 ms on
// the same file), which is a node for every token in the document to answer a question about
// one element. Every table cell edit, delete, add-child and paste paid it.
//
// So entrySplice.ts now asks jsonEntryScan for the one index both paths use. That makes the
// scan's answer load-bearing for text the host WRITES, not just for rows it paints, and
// these tests are what that costs:
//
//  1. THE INDEX IS EXACT. Every element's span and name must be what jsonc-parser's tree
//     says, for every entry of real fixtures — a name read from the wrong place would
//     splice one entry's text over another's.
//  2. IT READS THE ENTRY'S OWN NAME. Only a top-level `"name"` key of the element, never a
//     nested one and never a value that happens to spell it.
//  3. IT REFUSES WHAT IT CANNOT ACCOUNT FOR. An entries array the scan cannot walk yields
//     null, and the callers turn that into "Could not locate…" — no write.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTree, type Node } from 'jsonc-parser';
import { indexEntries } from '../src/host/jsonEntryScan.js';
import { findEntrySpan, findEntryElementSpan, findEntriesArrayInsertion } from '../src/host/entrySplice.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURES: Array<{ label: string; text: string }> = [
  {
    label: 'workspace/data.sldd',
    text: readFileSync(
      fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
      'utf8',
    ),
  },
  {
    label: 'numeric_json.sldd',
    text: readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'),
  },
];

/** Wrap an entries-array body in the nested .sldd structure the finders walk. */
function wrap(entriesBody: string): string {
  return (
    '{"__MW_TEXT_PARTS__":{"__MW_TEXT_PART__/data/chunk0":{"__MW_TEXT_content":{' +
    `"entries": ${entriesBody}}}}}`
  );
}

// ------------------------------------------------------------------- the truth ---

function property(node: Node | null | undefined, key: string): Node | null {
  if (!node || node.type !== 'object' || !node.children) return null;
  for (const prop of node.children) {
    if (prop.type === 'property' && prop.children?.[0]?.value === key) return prop.children[1] ?? null;
  }
  return null;
}

/** Every entries-array element, as jsonc-parser's tree sees it. */
function jsoncElements(text: string): Array<{ offset: number; length: number; index: number; name: string | null }> {
  const root = parseTree(text);
  const parts = property(root, '__MW_TEXT_PARTS__');
  const chunk0 = property(parts, '__MW_TEXT_PART__/data/chunk0');
  const entries = property(property(chunk0, '__MW_TEXT_content'), 'entries');
  return (entries?.children ?? []).map((el, index) => {
    const nameNode = property(el, 'name');
    return {
      offset: el.offset,
      length: el.length,
      index,
      name: nameNode?.type === 'string' && typeof nameNode.value === 'string' ? nameNode.value : null,
    };
  });
}

// ------------------------------------------------------------------ the index ---

describe('indexEntries — every entry element, found by scanning', () => {
  // INVARIANT 1. The scan is now what the splice writes against, so an index that
  // disagrees with the parser anywhere is a corrupted file, not a mispainted row.
  for (const { label, text } of FIXTURES) {
    it(`matches jsonc-parser element for element on ${label}`, () => {
      const expected = jsoncElements(text);
      expect(expected.length).toBeGreaterThan(3);
      const index = indexEntries(text);
      expect(index).not.toBeNull();
      expect(index!.elements).toEqual(expected);
      // And it reports where the array opens, which is what an insert needs.
      expect(text[index!.arrayStart]).toBe('[');
    });
  }

  it('reports elements in array order, with their spans', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" } ]');
    const index = indexEntries(text)!;
    expect(index.elements.map((e) => e.name)).toEqual(['A', 'B']);
    expect(index.elements.map((e) => e.index)).toEqual([0, 1]);
    for (const el of index.elements) {
      const slice = text.slice(el.offset, el.offset + el.length);
      expect(slice.startsWith('{')).toBe(true);
      expect(slice.endsWith('}')).toBe(true);
      expect(JSON.parse(slice).name).toBe(el.name);
    }
  });

  it('finds an empty array, reporting no elements', () => {
    const index = indexEntries(wrap('[]'))!;
    expect(index.elements).toEqual([]);
    expect(wrap('[]')[index.arrayStart]).toBe('[');
  });

  // INVARIANT 2. The name is the element's OWN, which is the only thing a selector
  // can be matched against.
  it('reads only the element’s top-level name, not a nested one', () => {
    const text = wrap('[ { "properties": { "name": "inner" }, "name": "outer" } ]');
    expect(indexEntries(text)!.elements[0].name).toBe('outer');
  });

  it('does not read a nested name when the element declares none of its own', () => {
    const text = wrap('[ { "metadata": { "name": "inner" } } ]');
    expect(indexEntries(text)!.elements[0].name).toBeNull();
  });

  it('does not mistake a VALUE that spells "name" for the key', () => {
    const text = wrap('[ { "class": "name", "name": "real" } ]');
    expect(indexEntries(text)!.elements[0].name).toBe('real');
  });

  it('still reads the entry’s own name when a stray colon follows a value', () => {
    // The scan deliberately does not validate JSON — the text-view repaint runs it on every
    // keystroke, so it sees half-typed documents. A colon typed after a value is the state
    // where telling a key from a value by the colon ALONE would read the wrong string as
    // the name; what settles it is that a key follows the `{` or a `,`, never the `:`.
    const text = wrap('[ { "class": "name": "wrong", "name": "real" } ]');
    expect(() => JSON.parse(text), 'this really is mid-edit text').toThrow();
    expect(indexEntries(text)!.elements[0].name).toBe('real');
  });

  it('reports a non-string name as none, so nothing can match it', () => {
    // A generated dictionary can carry a numeric name; coercing it would let a
    // delete of the entry named "999" splice out an element the model never named.
    const text = wrap('[ { "name": 999 }, { "name": "real" } ]');
    expect(indexEntries(text)!.elements.map((e) => e.name)).toEqual([null, 'real']);
  });

  it('decodes an escaped name', () => {
    const text = wrap('[ { "name": "a\\"b\\\\c" } ]');
    expect(indexEntries(text)!.elements[0].name).toBe('a"b\\c');
  });

  it('takes the FIRST of a repeated name key, as the parse tree does', () => {
    const text = wrap('[ { "name": "first", "name": "second" } ]');
    expect(indexEntries(text)!.elements[0].name).toBe(jsoncElements(text)[0].name);
    expect(indexEntries(text)!.elements[0].name).toBe('first');
  });

  it('does not fall through from a repeated name key whose first value is not a string', () => {
    // Still the FIRST key, even when reading it yields no usable name: a property
    // lookup would stop there too, so this element stays unfindable rather than
    // answering to a name a second key spells.
    const text = wrap('[ { "name": 999, "name": "second" } ]');
    expect(indexEntries(text)!.elements[0].name).toBe(jsoncElements(text)[0].name);
    expect(indexEntries(text)!.elements[0].name).toBeNull();
  });

  it('is not confused by braces, brackets or quotes inside a value', () => {
    const text = wrap(
      '[ { "name": "A", "v": "} ] not structure" },' +
        ' { "name": "B", "v": "a quote \\" then }" },' +
        ' { "name": "C", "v": "ends with \\\\" } ]',
    );
    expect(indexEntries(text)!.elements.map((e) => e.name)).toEqual(['A', 'B', 'C']);
    expect(indexEntries(text)!.elements).toEqual(jsoncElements(text));
  });

  // INVARIANT 3.
  it('returns null when the text does not spell the path to the array', () => {
    expect(indexEntries('{}')).toBeNull();
    expect(indexEntries('[1, 2, 3]')).toBeNull();
    expect(indexEntries('{ "entries": [] }')).toBeNull();
  });

  it('returns null when the array cannot be walked to its end', () => {
    expect(indexEntries(wrap('[ { "name": "A" }'))).toBeNull();
    expect(indexEntries(wrap('[ { "name": "A }, { "name": "B" } ]'))).toBeNull();
  });

  it('returns null when an element is not an object', () => {
    expect(indexEntries(wrap('[ [ { "name": "A" } ] ]'))).toBeNull();
  });

  // A scalar element opens no brace, so the walk cannot see it at all — it is caught by
  // what sits BETWEEN the elements it can see. All three positions must be covered,
  // because an unseen neighbour is the one a delete's comma span would swallow.
  it('returns null when a scalar element hides between the braces it can see', () => {
    expect(indexEntries(wrap('[ 1, { "name": "A" } ]')), 'before the first').toBeNull();
    expect(indexEntries(wrap('[ { "name": "A" }, 1, { "name": "B" } ]')), 'in the middle').toBeNull();
    expect(indexEntries(wrap('[ { "name": "A" }, null ]')), 'after the last').toBeNull();
  });

  it('returns null when the comma joining two elements is missing', () => {
    expect(indexEntries(wrap('[ { "name": "A" } { "name": "B" } ]'))).toBeNull();
    expect(indexEntries(wrap('[ , { "name": "A" } ]'))).toBeNull();
  });
});

// ------------------------------------------------------------- the finders ---

describe('the splice finders on the scanned index', () => {
  for (const { label, text } of FIXTURES) {
    it(`finds the span jsonc-parser finds, for every entry of ${label}`, () => {
      for (const el of jsoncElements(text)) {
        if (el.name === null) continue;
        expect(findEntrySpan(text, el.name), `span of "${el.name}"`).toEqual({
          offset: el.offset,
          length: el.length,
        });
      }
    });
  }

  it('appends after the last element, at the offset the tree reports', () => {
    for (const { text } of FIXTURES) {
      const elements = jsoncElements(text);
      const last = elements[elements.length - 1];
      expect(findEntriesArrayInsertion(text)!.offset).toBe(last.offset + last.length);
      expect(findEntriesArrayInsertion(text)!.needsLeadingComma).toBe(true);
    }
  });

  // The conservative half of INVARIANT 3, and a deliberate change from the parse tree:
  // it would skip a non-object element and still answer, leaving the comma arithmetic
  // of a delete counting elements this module never saw. Refusing costs the user a
  // "Could not locate…" on a file no writer of ours produces; answering could splice
  // the wrong bytes.
  it('refuses an entries array holding a non-object element, rather than answering', () => {
    const text = wrap('[ 1, { "name": "A" } ]');
    expect(jsoncElements(text).some((e) => e.name === 'A')).toBe(true);
    expect(findEntrySpan(text, 'A')).toBeNull();
    expect(findEntryElementSpan(text, 'A')).toBeNull();
    expect(findEntriesArrayInsertion(text)).toBeNull();
  });
});
