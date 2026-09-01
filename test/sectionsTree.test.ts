// Copyright 2026 The MathWorks, Inc.
// The Data Explorer tree is a dictionary reference graph. Its building block is
// extractReferences(): a cheap, regex-only scan of raw .sldd text that returns
// the referenced dictionary names without parsing entries. These tests cover
// that extraction plus basename resolution — the logic the tree depends on.
// (SectionsTreeProvider itself imports `vscode`, unavailable under vitest.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractReferences, normalizeRefNames, refBasename } from '../src/host/slddRefs.js';

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

// normalizeRefNames is the shared normalisation extractReferences runs on the
// parsed array. The COMPRESSED .sldd path (structuralIndex) calls it directly on
// whatever the binary parser produced — no JSON text and no regex in between —
// so it must tolerate a non-array as well as the element shapes above. Both .sldd
// formats route through this one function precisely so they cannot disagree about
// what a dictionary reference is.
describe('normalizeRefNames', () => {
  it('returns [] for anything that is not an array', () => {
    // A dictionary whose "Dictionary References" is a lone string or an object
    // (or absent entirely, as in a compressed file with no references) must read
    // as "no references", not crash the workspace scan that walks every file.
    for (const notAnArray of [undefined, null, 'common.sldd', { file: 'common.sldd' }, 42]) {
      expect(normalizeRefNames(notAnArray)).toEqual([]);
    }
  });

  it('normalises both element shapes and drops the unusable ones', () => {
    expect(
      normalizeRefNames(['a.sldd', { file: 'b.sldd' }, { uuid: 'x' }, '', { file: '' }, 7, null]),
    ).toEqual(['a.sldd', 'b.sldd']);
  });
});

describe('refBasename', () => {
  it('lower-cases and strips directories for workspace matching', () => {
    expect(refBasename('Common.SLDD')).toBe('common.sldd');
    expect(refBasename('sub/dir/Base.sldd')).toBe('base.sldd');
    expect(refBasename('C:\\proj\\Foo.sldd')).toBe('foo.sldd');
  });
});
