// Copyright 2026 The MathWorks, Inc.
// The Data Explorer tree is a dictionary reference graph. Its building block is
// extractReferences(): a cheap, regex-only scan of raw .sldd text that returns
// the referenced dictionary names without parsing entries. These tests cover
// that extraction plus basename resolution — the logic the tree depends on.
// (SectionsTreeProvider itself imports `vscode`, unavailable under vitest.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractReferences, refBasename } from '../src/host/slddRefs.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe('extractReferences', () => {
  it('returns [] for a dictionary with an empty reference list', () => {
    const text = readFileSync(fixturePath('numeric_json.sldd'), 'utf8');
    expect(extractReferences(text)).toEqual([]);
  });

  it('extracts bare-string references', () => {
    const text = '{ "Dictionary References": ["common.sldd", "base.sldd"] }';
    expect(extractReferences(text)).toEqual(['common.sldd', 'base.sldd']);
  });

  it('extracts references stored as objects with a file field', () => {
    const text =
      '{ "Dictionary References": [{"file": "common.sldd", "uuid": "x"}] }';
    expect(extractReferences(text)).toEqual(['common.sldd']);
  });

  it('returns [] when the key is absent', () => {
    expect(extractReferences('{ "entries": [] }')).toEqual([]);
  });

  it('returns [] on malformed reference JSON without throwing', () => {
    expect(extractReferences('{ "Dictionary References": [oops }')).toEqual([]);
  });

  it('returns [] when the matched array fails to JSON.parse (catch branch)', () => {
    // The regex matches [ ... ] but the contents are not valid JSON.
    expect(extractReferences('{ "Dictionary References": [oops] }')).toEqual([]);
  });

  it('skips array elements that are neither string nor object', () => {
    const text = '{ "Dictionary References": [1, true, null, "keep.sldd"] }';
    expect(extractReferences(text)).toEqual(['keep.sldd']);
  });

  it('skips objects without a string file field', () => {
    const text =
      '{ "Dictionary References": [{"uuid": "x"}, {"file": 42}, {"file": ""}, {"file": "ok.sldd"}] }';
    expect(extractReferences(text)).toEqual(['ok.sldd']);
  });

  it('skips empty-string bare references', () => {
    const text = '{ "Dictionary References": ["", "real.sldd"] }';
    expect(extractReferences(text)).toEqual(['real.sldd']);
  });

  it('mixes bare-string and object references in order', () => {
    const text = '{ "Dictionary References": ["a.sldd", {"file": "b.sldd"}] }';
    expect(extractReferences(text)).toEqual(['a.sldd', 'b.sldd']);
  });
});

describe('refBasename', () => {
  it('lower-cases and strips directories for workspace matching', () => {
    expect(refBasename('Common.SLDD')).toBe('common.sldd');
    expect(refBasename('sub/dir/Base.sldd')).toBe('base.sldd');
    expect(refBasename('C:\\proj\\Foo.sldd')).toBe('foo.sldd');
  });
});
