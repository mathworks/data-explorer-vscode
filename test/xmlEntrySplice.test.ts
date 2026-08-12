// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  findEntryObjectSpan,
  findEntryElementSpan,
  findEntryInsertionPoint,
} from '../src/host/xmlEntrySplice.js';

function chunkXml(fixture: string): string {
  const p = fileURLToPath(new URL('./' + fixture, import.meta.url));
  const z = unzipSync(new Uint8Array(readFileSync(p)));
  return new TextDecoder().decode(z['data/chunk0.xml']);
}
const nested = chunkXml('fixtures/nested_objects.sldd');

describe('findEntryObjectSpan', () => {
  it('finds an entry and returns a tight <Object>…</Object> span', () => {
    const span = findEntryObjectSpan(nested, 'StructWithParam');
    expect(span).not.toBeNull();
    const slice = nested.slice(span!.offset, span!.offset + span!.length);
    expect(slice.startsWith('<Object Class="DD.ENTRY">')).toBe(true);
    expect(slice.endsWith('</Object>')).toBe(true);
    expect(slice).toContain('<P Name="Name" Class="char">StructWithParam</P>');
    // Must not swallow the sibling entry.
    expect(slice).not.toContain('CellWithParam');
  });

  it('the fragment for a nested-object entry contains NO nested <Object> (invariant)', () => {
    for (const name of ['StructWithParam', 'CellWithParam']) {
      const span = findEntryObjectSpan(nested, name)!;
      const slice = nested.slice(span.offset, span.offset + span.length);
      const inner = slice.slice('<Object Class="DD.ENTRY">'.length, -'</Object>'.length);
      expect(inner).not.toContain('<Object');
    }
  });

  it('returns null for an unknown name', () => {
    expect(findEntryObjectSpan(nested, 'NoSuchEntry')).toBeNull();
  });
});

describe('findEntryInsertionPoint', () => {
  it('returns an offset just before the trailing DD.Dictionary object', () => {
    const off = findEntryInsertionPoint(nested);
    expect(off).not.toBeNull();
    expect(nested.slice(off!)).toContain('<Object Class="DD.Dictionary">');
    expect(nested.slice(0, off!)).toContain('<Object Class="DD.ENTRY">');
  });
});

describe('findEntryElementSpan', () => {
  it('span removal leaves the other entry and the dictionary intact', () => {
    const span = findEntryElementSpan(nested, 'StructWithParam')!;
    const after = nested.slice(0, span.offset) + nested.slice(span.offset + span.length);
    expect(after).not.toContain('StructWithParam');
    expect(after).toContain('CellWithParam');
    expect(after).toContain('<Object Class="DD.Dictionary">');
  });
});
