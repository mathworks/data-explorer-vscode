// Copyright 2026 The MathWorks, Inc.
//
// deleteEntriesByName is the source-side of a MOVE drop: after the payloads are
// pasted into the target, the dragged entries are removed from the SOURCE
// document by name. It must work purely on text (the source may be a different
// document than the target), remove each named top-level entry, and leave the
// rest byte-valid — deleting several at once without offset drift.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { deleteEntriesByName } from '../src/host/structuralEdit.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

// Entry names in DOCUMENT order (read straight from the text, so "the last
// entry" means the last array element — which is what the splice math turns on).
function entryNames(text: string): string[] {
  const entries = JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0']
    .__MW_TEXT_content.entries;
  return entries.map((e: { name: string }) => e.name);
}

describe('deleteEntriesByName', () => {
  it('removes a single named entry, leaving valid JSON without it', () => {
    const uri = 'test://del-one.sldd';
    invalidate(uri);
    const before = getModel(uri, 'arch.sldd', archText);
    const archBefore = before.children.find((s: any) => s.name === 'arch').children.map((c: any) => c.name);
    expect(archBefore).toContain('DataInterface');

    const newText = deleteEntriesByName(archText, ['DataInterface']);
    expect(() => JSON.parse(newText)).not.toThrow();

    invalidate(uri);
    const after = getModel(uri, 'arch.sldd', newText);
    const archAfter = after.children.find((s: any) => s.name === 'arch').children.map((c: any) => c.name);
    expect(archAfter).not.toContain('DataInterface');
  });

  it('removes multiple named entries in one pass without offset drift', () => {
    const uri = 'test://del-many.sldd';
    const newText = deleteEntriesByName(archText, ['DataInterface', 'NumericType', 'ValueType']);
    expect(() => JSON.parse(newText)).not.toThrow();

    invalidate(uri);
    const after = getModel(uri, 'arch.sldd', newText);
    const allNames = after.children.flatMap((s: any) => s.children.map((c: any) => c.name));
    expect(allNames).not.toContain('DataInterface');
    expect(allNames).not.toContain('NumericType');
    expect(allNames).not.toContain('ValueType');
  });

  it('ignores names that are not present (no throw, no change to others)', () => {
    const newText = deleteEntriesByName(archText, ['DoesNotExist']);
    expect(() => JSON.parse(newText)).not.toThrow();
    // Nothing removed → text unchanged.
    expect(newText).toBe(archText);
  });

  // REGRESSION. Element spans OVERLAP: the last element's removal span starts at
  // the END of its predecessor (to absorb the comma before it), while the
  // predecessor's own span runs forward to the next element's start — so the
  // comma between them belongs to both spans. Computing every span against the
  // ORIGINAL text and then splicing them all removed that overlap twice, which
  // ate the array's closing `]`. Multi-selecting the last two entries and
  // dragging them to another section wrote unparseable JSON into the user's
  // dictionary; the editor then refused to reopen it ("Failed to parse").
  it('removes the last two entries at once, leaving valid JSON', () => {
    const uri = 'test://del-tail-pair.sldd';
    const docOrder = entryNames(archText);
    const lastTwo = docOrder.slice(-2);

    const newText = deleteEntriesByName(archText, lastTwo);
    expect(() => JSON.parse(newText)).not.toThrow();

    invalidate(uri);
    const after = getModel(uri, 'arch.sldd', newText);
    const remaining = after.children.flatMap((s: any) => s.children.map((c: any) => c.name));
    for (const name of lastTwo) expect(remaining).not.toContain(name);
    // Only the two named entries went — the neighbour above them is untouched.
    expect(remaining).toEqual(docOrder.slice(0, -2));
  });

  it('empties the array when every entry is moved out at once', () => {
    // Selecting all rows and dragging them to another document is a legitimate
    // gesture; it must leave a valid empty dictionary, not a truncated file.
    const newText = deleteEntriesByName(archText, entryNames(archText));
    expect(() => JSON.parse(newText)).not.toThrow();
    expect(entryNames(newText)).toEqual([]);
  });

  // REGRESSION. One entry can reach the move list under the same name twice (the
  // drag register is deduped by node identity, but a name is not an identity).
  // The second splice used an offset computed before the first removal, so it cut
  // a span that now belonged to the FOLLOWING entry — silently destroying an
  // entry the user never dragged.
  it('a name listed twice removes that entry once and no neighbour', () => {
    const uri = 'test://del-dup-name.sldd';
    const newText = deleteEntriesByName(archText, ['DataInterface', 'DataInterface']);
    expect(() => JSON.parse(newText)).not.toThrow();

    invalidate(uri);
    const after = getModel(uri, 'arch.sldd', newText);
    const remaining = after.children.flatMap((s: any) => s.children.map((c: any) => c.name));
    expect(remaining).not.toContain('DataInterface');
    // EnumType directly follows DataInterface in the document and must survive.
    expect(remaining).toContain('EnumType');
    expect(remaining).toEqual(entryNames(archText).filter((n) => n !== 'DataInterface'));
  });
});
