// Copyright 2026 The MathWorks, Inc.
//
// The smallest way to say "this document now reads like that".
//
// The structural transforms report the one region they changed, and the host writes that
// region. Two paths cannot: a same-document move (delete the sources, paste the copies) and a
// cross-document source delete both hand back whole text. They used to be written as a
// full-document replace, which on a 47.8 MB dictionary is VS Code rewriting every byte — and
// storing that rewrite, so its undo costs the same again.
//
// What this pins is the only property that matters for correctness: whatever region is
// written, the document afterwards is EXACTLY the new text. Everything else here is about it
// being small, and about the two ways a naive prefix/suffix trim breaks a document — cutting
// a surrogate pair in half.
import { describe, it, expect } from 'vitest';
import { minimalReplacement } from '../src/host/minimalEdit.js';
import { applyTextPatch } from '../src/host/structuralEdit.js';

describe('minimalReplacement', () => {
  const roundTrips = (from: string, to: string) =>
    expect(applyTextPatch(from, minimalReplacement(from, to))).toBe(to);

  it('reproduces the new text for every shape of change', () => {
    const cases: Array<[string, string]> = [
      ['abcdef', 'abXdef'], // one byte in the middle
      ['abcdef', 'abcdefgh'], // appended
      ['abcdef', 'XXabcdef'], // prepended
      ['abcdef', 'abdef'], // removed in the middle
      ['abcdef', ''], // emptied
      ['', 'abcdef'], // filled from empty
      ['aaaa', 'aa'], // repeated bytes, shortened
      ['aa', 'aaaa'], // repeated bytes, lengthened
      ['abcabc', 'abc'], // the removed run repeats the kept one
    ];
    for (const [from, to] of cases) roundTrips(from, to);
  });

  it('writes only the region that differs', () => {
    const patch = minimalReplacement('prefix-OLD-suffix', 'prefix-NEW-suffix');
    expect(patch.offset).toBe('prefix-'.length);
    expect(patch.length).toBe('OLD'.length);
    expect(patch.text).toBe('NEW');
  });

  it('states a pure insertion as one, replacing nothing', () => {
    const patch = minimalReplacement('[a,b]', '[a,b,c]');
    expect(patch.length).toBe(0);
    expect(patch.text).toBe(',c');
  });

  it('states a pure deletion as one, writing nothing', () => {
    const patch = minimalReplacement('[a,b,c]', '[a,b]');
    expect(patch.text).toBe('');
    expect(patch.length).toBe(',c'.length);
  });

  it('never splits a surrogate pair', () => {
    // An emoji is two UTF-16 code units. A trim that stops between them names an offset
    // that is not a character boundary — which VS Code's positionAt does not honour, so the
    // range would be written at the wrong place and the document left with half a
    // character. A real dictionary carries these in Description strings.
    const from = 'x😀y😀z';
    const to = 'x😀Y😀z';
    const patch = minimalReplacement(from, to);
    roundTrips(from, to);
    const isLow = (c: string) => c.charCodeAt(0) >= 0xdc00 && c.charCodeAt(0) <= 0xdfff;
    expect(isLow(from[patch.offset] ?? 'a'), 'the region does not start on a low surrogate').toBe(false);
    const end = patch.offset + patch.length;
    expect(isLow(from[end] ?? 'a'), 'the region does not end between a pair').toBe(false);
  });

  it('trims a shared emoji prefix without cutting into it', () => {
    const from = '😀😀A';
    const to = '😀😀B';
    roundTrips(from, to);
    expect(minimalReplacement(from, to).text).toBe('B');
  });

  it('says identical text the way a full replace does, so nothing about the write changes', () => {
    // Unreachable from the paths that use this — every one of them changed something — but
    // the answer must still be the edit that was made before this existed, or the one case
    // where a caller writes text equal to what is there would stop marking the document
    // dirty.
    const patch = minimalReplacement('same', 'same');
    expect(patch).toEqual({ offset: 0, length: 4, text: 'same' });
  });
});
