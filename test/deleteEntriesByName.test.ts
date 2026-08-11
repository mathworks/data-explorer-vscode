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
});
