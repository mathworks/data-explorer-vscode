// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  findEntrySpan,
  findEntryElementSpan,
  findEntriesArrayInsertion,
  detectIndent,
} from '../src/host/entrySplice.js';

const fixturePath = fileURLToPath(
  new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url),
);
const fixtureText = readFileSync(fixturePath, 'utf8');

describe('findEntrySpan', () => {
  it('finds a known entry and returns a tight object span', () => {
    const span = findEntrySpan(fixtureText, 'Array');
    expect(span).not.toBeNull();
    const slice = fixtureText.slice(span!.offset, span!.offset + span!.length);
    expect(slice.startsWith('{')).toBe(true);
    expect(slice.endsWith('}')).toBe(true);
    expect(slice).toContain('"name": "Array"');
    // Must not swallow the sibling "Array1" entry.
    expect(slice).not.toContain('"name": "Array1"');
  });

  it('returns null for a non-existent name', () => {
    expect(findEntrySpan(fixtureText, 'NoSuchEntry')).toBeNull();
  });
});

// Wrap an entries-array body in the nested .sldd structure the splice helpers
// walk (__MW_TEXT_PARTS__ → chunk0 → __MW_TEXT_content → entries).
function wrap(entriesBody: string): string {
  return [
    '{',
    '  "__MW_TEXT_PARTS__": {',
    '    "__MW_TEXT_PART__/data/chunk0": {',
    '      "__MW_TEXT_content": {',
    `        "entries": ${entriesBody}`,
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
}

// Parse to the entry names present, to assert the array stays valid after edits.
function entryNames(text: string): string[] {
  const root = JSON.parse(text);
  const entries =
    root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  return entries.map((e: { name: string }) => e.name);
}

describe('findEntryElementSpan', () => {
  it('returns null when the entries array is missing', () => {
    expect(findEntryElementSpan('{ "entries": "not the right shape" }', 'X')).toBeNull();
  });

  it('returns null for a name not present in the array', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" } ]');
    expect(findEntryElementSpan(text, 'Z')).toBeNull();
  });

  it('removing the only element leaves an empty (but valid) array', () => {
    const text = wrap('[ { "name": "solo" } ]');
    const span = findEntryElementSpan(text, 'solo')!;
    expect(span).not.toBeNull();
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual([]);
  });

  it('removing a middle element also removes the joining comma, keeping valid JSON', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" }, { "name": "C" } ]');
    const span = findEntryElementSpan(text, 'B')!;
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual(['A', 'C']);
  });

  it('removing the last element removes the PRECEDING comma, keeping valid JSON', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" } ]');
    const span = findEntryElementSpan(text, 'B')!;
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual(['A']);
  });

  it('removing the first of many removes the FOLLOWING comma, keeping valid JSON', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" } ]');
    const span = findEntryElementSpan(text, 'A')!;
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual(['B']);
  });

  it('locates a real entry in the multiline fixture and its removal stays valid', () => {
    const span = findEntryElementSpan(fixtureText, 'Array')!;
    expect(span).not.toBeNull();
    const after = fixtureText.slice(0, span.offset) + fixtureText.slice(span.offset + span.length);
    expect(entryNames(after)).not.toContain('Array');
    expect(entryNames(after)).toContain('Array1');
  });
});

describe('findEntriesArrayInsertion', () => {
  it('returns null when the entries array is missing', () => {
    expect(findEntriesArrayInsertion('{ "nope": 1 }')).toBeNull();
  });

  it('for a populated array, inserts after the last element and needs a leading comma', () => {
    const text = wrap('[\n          { "name": "A" }\n        ]');
    const ins = findEntriesArrayInsertion(text)!;
    expect(ins.needsLeadingComma).toBe(true);
    // The reported offset sits at the end of the last element's `}`.
    expect(text[ins.offset - 1]).toBe('}');
    // Splicing a comma-joined element in keeps the JSON valid.
    const added = text.slice(0, ins.offset) + ',\n' + ins.elementIndent + '{ "name": "B" }' + text.slice(ins.offset);
    expect(entryNames(added)).toEqual(['A', 'B']);
  });

  it('derives the element indent from the last element\'s line', () => {
    const text = wrap('[\n          { "name": "A" }\n        ]');
    const ins = findEntriesArrayInsertion(text)!;
    expect(ins.elementIndent).toBe('          '); // 10 spaces, matching the fixture depth
  });

  it('for an empty array, inserts just inside `[` with no leading comma', () => {
    const text = wrap('[]');
    const ins = findEntriesArrayInsertion(text)!;
    expect(ins.needsLeadingComma).toBe(false);
    const added = text.slice(0, ins.offset) + '\n' + ins.elementIndent + '{ "name": "first" }\n' + text.slice(ins.offset);
    expect(entryNames(added)).toEqual(['first']);
  });

  it('appending to the real fixture keeps the array valid and preserves existing entries', () => {
    const ins = findEntriesArrayInsertion(fixtureText)!;
    const before = entryNames(fixtureText);
    const added =
      fixtureText.slice(0, ins.offset) +
      ',\n' + ins.elementIndent + '{ "name": "Appended", "metadata": {}, "value": 1 }' +
      fixtureText.slice(ins.offset);
    expect(entryNames(added)).toEqual([...before, 'Appended']);
  });
});

describe('detectIndent', () => {
  it('returns two spaces for the 2-space-indented fixture', () => {
    expect(detectIndent(fixtureText)).toBe('  ');
  });

  it('returns a tab for a tab-indented JSON string', () => {
    const tabbed = '{\n\t"a": 1,\n\t"b": 2\n}';
    expect(detectIndent(tabbed)).toBe('\t');
  });

  it('falls back to two spaces for single-line JSON with no indent', () => {
    expect(detectIndent('{"a":1}')).toBe('  ');
  });
});
