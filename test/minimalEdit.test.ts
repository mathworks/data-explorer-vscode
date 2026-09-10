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

  const isHighUnit = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
  const isLowUnit = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

  /** An offset VS Code will honour: never between the two halves of one character. */
  const expectOnCharacterBoundary = (text: string, offset: number, what: string) => {
    const splitsAPair = isHighUnit(text.charCodeAt(offset - 1)) && isLowUnit(text.charCodeAt(offset));
    expect(splitsAPair, `${what} falls on a character boundary`).toBe(false);
  };

  /**
   * Everything one answer has to satisfy, whatever the two texts are.
   *
   * The first is the only correctness property there is: the region written is a region OF
   * THE OLD TEXT, so if it is computed one unit off, the document keeps a character it
   * should have lost or loses one it should have kept — a corrupt .sldd that the model in
   * memory still describes correctly, so nothing else notices until the file is reopened.
   * The rest are the ways the two boundaries can be a position VS Code refuses to write
   * at, which moves the write somewhere the text was never computed for.
   */
  const writesTheNewText = (label: string, from: string, to: string) => {
    const patch = minimalReplacement(from, to);
    expect(applyTextPatch(from, patch), `${label}: the document afterwards is the new text`).toBe(to);
    expect(patch.length, `${label}: the region is not a negative span`).toBeGreaterThanOrEqual(0);
    expect(patch.offset + patch.length, `${label}: the region ends inside the document`).toBeLessThanOrEqual(
      from.length,
    );
    expectOnCharacterBoundary(from, patch.offset, `${label}: the region's start`);
    expectOnCharacterBoundary(from, patch.offset + patch.length, `${label}: the region's end`);
  };

  it('reproduces the new text for every shape of change', () => {
    // Named cases, because the label is what a failure reports: which SHAPE of change the
    // trim got wrong is the whole diagnosis. The last few are the shapes that classically
    // break a prefix/suffix trim — a shared prefix and a shared suffix that want to claim
    // the same characters, and text where one character is two code units.
    const cases: Array<[string, string, string]> = [
      ['one character in the middle', 'abcdef', 'abXdef'],
      ['appended', 'abcdef', 'abcdefgh'],
      ['prepended', 'abcdef', 'XXabcdef'],
      ['removed in the middle', 'abcdef', 'abdef'],
      ['emptied', 'abcdef', ''],
      ['filled from empty', '', 'abcdef'],
      ['identical', 'abcdef', 'abcdef'],
      ['changed at the very first character', 'abcdef', 'Xbcdef'],
      ['changed at the very last character', 'abcdef', 'abcdeX'],
      ['the first character removed', 'abcdef', 'bcdef'],
      ['the last character removed', 'abcdef', 'abcde'],
      ['repeated bytes, shortened', 'aaaa', 'aa'],
      ['repeated bytes, lengthened', 'aa', 'aaaa'],
      ['the removed run repeats the kept one', 'abcabc', 'abc'],
      // The prefix scan matches all of "abcabc" and the suffix scan would match all of it
      // again from the other end: the two overlap, and an unclamped suffix turns a real
      // deletion into a zero-length no-op that leaves the document unchanged.
      ['a shared prefix running into a shared suffix', 'abcabcabc', 'abcabc'],
      ['one repeated token inserted', 'abababab', 'ababababab'],
      // A UTF-16 pair is one character in two code units, and an offset between the two is
      // not a position a document can be written at.
      ['emoji either side of the change', 'x😀OLD😀y', 'x😀NEW😀y'],
      ['emoji removed', '😀😀', ''],
      ['emoji added to plain text', 'note: ', 'note: 😀'],
      ['an emoji replaced by a longer run of them', 'a😀b', 'a😀😀😀b'],
      // A dictionary written on Windows is CRLF throughout, so every span the trim reports
      // has a \r on one side of it.
      ['one CRLF line changed', '{\r\n  "Value": 1\r\n}', '{\r\n  "Value": 2\r\n}'],
      ['a line ending rewritten from LF to CRLF', 'a\nb\nc', 'a\r\nb\r\nc'],
      ['a trailing newline dropped', 'entries\n', 'entries'],
      // The case the module exists for: a one-character change in a document where
      // everything else is identical.
      [
        'one character inside a long unchanged document',
        'x'.repeat(40000) + 'OLD' + 'y'.repeat(40000),
        'x'.repeat(40000) + 'NEW' + 'y'.repeat(40000),
      ],
    ];
    for (const [label, from, to] of cases) writesTheNewText(label, from, to);
  });

  it('writes only the changed characters of a long document, not the whole of it', () => {
    // The reason this module exists: a full-document replace of a 47.8 MB dictionary is
    // every byte rewritten to say a one-cell thing, and stored again for the undo. A trim
    // that stops early is not wrong, it is just as slow as what it replaced.
    const before = 'x'.repeat(40000);
    const after = 'y'.repeat(40000);
    const patch = minimalReplacement(before + '"Value": 1' + after, before + '"Value": 22' + after);
    expect(patch.offset).toBe(before.length + '"Value": '.length);
    expect(patch.length).toBe(1);
    expect(patch.text).toBe('22');
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

  it('backs the region off the START of a pair whose first half both texts share', () => {
    // 😀 (U+1F600) and 🙂 (U+1F642) are two code units each and agree on the FIRST one, so
    // the prefix scan stops BETWEEN the halves of the emoji already in the document. That
    // offset is not a position VS Code writes at: it validates the range out to the pair
    // boundary, so the replacement lands one unit earlier than the text was computed for
    // and the document is left holding a character that is half old and half new. A real
    // dictionary carries emoji in Description strings, which is how this is reached.
    const from = 'Description: x😀y';
    const to = 'Description: x🙂y';
    const patch = minimalReplacement(from, to);
    expect(patch.offset, 'the region starts at the emoji, not one unit into it').toBe(from.indexOf('😀'));
    expect(patch.text.startsWith('🙂'), 'so the whole replacement emoji is written').toBe(true);
    writesTheNewText('one emoji swapped for another', from, to);
  });

  it('backs the region off the END of a pair whose second half both texts share', () => {
    // The mirror case, and the one a prefix-only nudge misses. 🕰 (U+1F570) and 🥰
    // (U+1F970) differ by exactly 0x400, so their UTF-16 pairs agree on the SECOND code
    // unit: the suffix scan matches that half and stops inside the character. Ending the
    // region there writes the new emoji's first half against the old emoji's second — a
    // code point neither text contains, i.e. a replacement character in the saved file.
    const from = '{"n":"A🕰","x":1}';
    const to = '{"n":"B🥰","x":1}';
    expect(from.charCodeAt(8), 'the two emoji really do share their low surrogate').toBe(to.charCodeAt(8));
    const patch = minimalReplacement(from, to);
    expect(patch.offset + patch.length, 'the region ends past the whole emoji').toBe(from.indexOf('🕰') + 2);
    expect(patch.text, 'so the emoji is written as one character').toBe('B🥰');
    writesTheNewText('one emoji swapped for one sharing its low surrogate', from, to);
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
