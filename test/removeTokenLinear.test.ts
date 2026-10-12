// Copyright 2026 The MathWorks, Inc.
//
// Removing a filter chip splices its span out of the applied text and closes the gap,
// trimming the whitespace on each side of it. The text before the chip was trimmed with
// `.replace(/\s+$/, '')`, which is anchored at the end only: from every whitespace
// character of a run that is NOT at the end, the engine takes the rest of the run, fails
// on the character after it, and gives the run back one character at a time. So a long
// run of spaces anywhere before the chip cost the square of its length: 160,000 of them
// took 15.7 s in the bare pattern, on the click of a chip's x (or Backspace into the
// chips, or a header popup's Clear), all three of which come here.
//
// The text is the user's: typed or pasted into the filter bar, or a value typed into a
// header popup, which formatToken quotes and keeps whole, inner spaces and all.
import { describe, it, expect } from 'vitest';
import { parseFilterExpression, removeToken } from '../src/webview/rowFilter.js';

const COLUMNS = ['Name', 'Value', 'DataType', 'Class', 'Kind', 'Status'];
const cell = (row: Record<string, string | undefined>, col: string): string => row[col] ?? '';

// 100,000 spaces cost the old trim 8.4 to 9.4 s on the machine this was written on, and
// the new one about a millisecond.
const RUN = ' '.repeat(100_000);

// The bound is the parse and the splice together, which is what a click on the chip
// pays. Far from both costs, so it tests the shape of the cost rather than the machine.
const BOUND_MS = 1000;

function timedRemove(text: string, index: number): { out: string; ms: number } {
  const start = performance.now();
  const { tokens } = parseFilterExpression(text, COLUMNS, cell);
  const out = removeToken(text, tokens[index]);
  return { out, ms: performance.now() - start };
}

describe('removing a chip after a long run of whitespace', () => {
  it('takes linear time when the run is between two earlier words', () => {
    const { out, ms } = timedRemove(`a${RUN}b c`, 2);
    expect(out).toBe(`a${RUN}b`);
    expect(ms, `removed in ${ms.toFixed(1)} ms`).toBeLessThan(BOUND_MS);
  }, 60_000);

  it('takes linear time when the run is inside a quoted value', () => {
    // What a header popup writes for a value with spaces in it: one token, quoted, its
    // inner spacing kept as typed.
    const text = `Name="a${RUN}b" abc`;
    const { out, ms } = timedRemove(text, 1);
    expect(out).toBe(`Name="a${RUN}b"`);
    expect(ms, `removed in ${ms.toFixed(1)} ms`).toBeLessThan(BOUND_MS);
  }, 60_000);

  it('still closes the gap the chip leaves, whatever whitespace it is', () => {
    // Tabs, newlines and the Unicode spaces are all whitespace to the old pattern's `\s`,
    // and trimEnd removes exactly that set; this is the short version of the check over
    // every code point that was run when it changed.
    const ws = ' \t\n\v\f\r\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
    const text = `abc${ws}Name=x`;
    const { tokens } = parseFilterExpression(text, COLUMNS, cell);
    expect(tokens.map((t) => t.raw)).toEqual(['abc', 'Name=x']);
    expect(removeToken(text, tokens[1])).toBe('abc');
    expect(removeToken(text, tokens[0])).toBe('Name=x');
  });
});
