// Copyright 2026 The MathWorks, Inc.
// The Data Explorer tree is a dictionary reference graph. Its building block is the reference
// list a `.sldd` carries, read for a TEXTUAL dictionary here — core's `scanSldd` behind this
// host's refusal policy (slddContent.ts), which is the one extraction the cheap tier runs for
// either on-disk format. These tests cover that reading plus basename resolution: the logic the
// tree depends on. (SectionsTreeProvider itself imports `vscode`, unavailable under vitest.)
//
// It used to cover `extractReferences`, a regex over the raw text
// (`/"Dictionary References"\s*:\s*(\[[^\]]*\])/`) that this host ran instead of `JSON.parse` on
// the textual half. That function is gone (slddRefs.ts says why), so these are the same
// properties asserted over the reader that ships. Two of them CHANGED answer with the route and
// are written out as such below: text that will not parse now throws rather than reading as a
// dictionary with no references, and a reference array holding a nested array is now read
// instead of truncated at the first `]`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toArrayBuffer } from '../src/common/bytes.js';
import { scanSldd } from '../src/host/slddContent.js';
import { normalizeRefNames, refBasename } from '../src/host/slddRefs.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

const bytes = (text: string): ArrayBuffer => toArrayBuffer(new TextEncoder().encode(text));

/**
 * A textual dictionary carrying `refs`, in the shape MATLAB writes one.
 *
 * The three-key wrapper (`__MW_TEXT_PARTS__` -> `__MW_TEXT_PART__/data/chunk0` ->
 * `__MW_TEXT_content`) is where core's reader looks for `entries` and `Dictionary References`,
 * and every textual fixture in `test/fixtures` has it. The retired regex found the key wherever
 * it sat in the text, so tests for it could hand over a bare object; reading a dictionary the way
 * production reads one means the input has to be a dictionary.
 */
const textSldd = (refs: unknown): ArrayBuffer =>
  bytes(
    JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: { entries: [], 'Dictionary References': refs },
        },
      },
    }),
  );

const refsOf = (dictionary: ArrayBuffer): string[] => scanSldd(dictionary).refs;

describe('a textual dictionary’s references, through the reader that ships', () => {
  it('returns [] for a dictionary with an empty reference list', () => {
    const real = readFileSync(fixturePath('numeric_json.sldd'));
    expect(refsOf(toArrayBuffer(new Uint8Array(real)))).toEqual([]);
  });

  it('extracts bare-string references', () => {
    expect(refsOf(textSldd(['common.sldd', 'base.sldd']))).toEqual(['common.sldd', 'base.sldd']);
  });

  it('extracts references stored as objects with a file field', () => {
    expect(refsOf(textSldd([{ file: 'common.sldd', uuid: 'x' }]))).toEqual(['common.sldd']);
  });

  it('returns [] when the key is absent', () => {
    expect(refsOf(textSldd(undefined))).toEqual([]);
  });

  it('returns [] for a dictionary carrying no content part at all', () => {
    // Valid JSON with no `__MW_TEXT_PARTS__`: MATLAB writes this for a file that was never
    // completed, and `slddChunkContent` answers null for it rather than failing. So it is a
    // dictionary with no references and not an unreadable one — the tree lists it with no edges.
    expect(refsOf(bytes('{ "entries": [] }'))).toEqual([]);
  });

  it('THROWS on text that will not parse, where the regex answered []', () => {
    // The one place the answer changed with the route, and it changed in the safe direction: a
    // truncated dictionary is a file the read could not recover, which this host treats as a
    // failure rather than as an empty dictionary (slddContent.ts). Every workspace-wide caller
    // catches — the cheap tier answers an empty artifact for it, so the tree still lists the file
    // with no edges (structuralIndex.test.ts pins that over a folder pass) — and the one caller
    // that shows a single file turns it into the "Failed to parse" banner instead of a table with
    // no rows.
    expect(() => refsOf(bytes('{ "Dictionary References": [oops }'))).toThrow();
    expect(() => refsOf(bytes('{ "Dictionary References": [oops] }'))).toThrow();
  });

  it('reads a reference array holding a NESTED array, where the regex truncated', () => {
    // The regex's negated class (`\[[^\]]*\]`) stopped at the first `]`, so this array truncated
    // to `[["a.sldd"]` — invalid JSON, caught, and reported as NO references while the usage
    // summary (core's `JSON.parse`) still followed them. The tree drew no edge for a dictionary
    // whose scope did: one rule, two paths, disagreeing. One reader cannot.
    expect(refsOf(textSldd([['nested.sldd'], 'real.sldd']))).toEqual(['real.sldd']);
  });

  it('skips array elements that are neither string nor object', () => {
    expect(refsOf(textSldd([1, true, null, 'keep.sldd']))).toEqual(['keep.sldd']);
  });

  it('skips objects without a string file field', () => {
    expect(refsOf(textSldd([{ uuid: 'x' }, { file: 42 }, { file: '' }, { file: 'ok.sldd' }]))).toEqual([
      'ok.sldd',
    ]);
  });

  it('skips empty-string bare references', () => {
    expect(refsOf(textSldd(['', 'real.sldd']))).toEqual(['real.sldd']);
  });

  it('mixes bare-string and object references in order', () => {
    expect(refsOf(textSldd(['a.sldd', { file: 'b.sldd' }]))).toEqual(['a.sldd', 'b.sldd']);
  });
});

// normalizeRefNames is the shared normalisation both .sldd formats run on the array they found.
// The COMPRESSED path calls it on whatever the binary parser produced and the TEXTUAL path on
// whatever `JSON.parse` produced, so it must tolerate a non-array as well as the element shapes
// above. Both formats route through this one function precisely so they cannot disagree about
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
