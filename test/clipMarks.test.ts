// Copyright 2026 The MathWorks, Inc.
//
// The clipboard mark every editable table paints (clipMarks.ts): which of a document's entries
// carry it, and which of them a clipboard broadcast moves. One module for the JSON and binary
// dictionary views and the MAT-file view, so these are the rules of all three.
import { describe, it, expect, beforeEach } from 'vitest';
import { clearClipboard, setClipboard, type ClipboardItem } from '../src/host/clipboard.js';
import { clipMarkChange, clipMarkOfDoc, sameClipMark } from '../src/host/clipMarks.js';
import { clipMarkKey, type ClipMark } from '../src/view/model/rows/rowStamp.js';

const item = (name: unknown, sourceSection: string): ClipboardItem => ({
  payload: { name },
  sourceSection,
  className: 'double',
  arrayClass: '',
  kind: 'MATLAB Variable',
  isMatlabVariable: true,
  isScalarNumeric: true,
});

const mark = (mode: 'cut' | 'copy', ...keys: [string, string][]): ClipMark => ({
  mode,
  keys: new Set(keys.map(([section, name]) => clipMarkKey(section, name))),
});

describe('clipMarkOfDoc', () => {
  beforeEach(() => clearClipboard());

  it('is undefined with nothing on the clipboard, or entries from another document', () => {
    expect(clipMarkOfDoc('file:///a.sldd')).toBeUndefined();
    setClipboard([item('A', 'design')], 'cut', 'file:///b.sldd');
    expect(clipMarkOfDoc('file:///a.sldd')).toBeUndefined();
  });

  it("keys every entry by its own section and name, in the clipboard's mode", () => {
    setClipboard([item('A', 'design'), item('A', 'other'), item('B', 'arch')], 'cut', 'file:///a.sldd');
    expect(clipMarkOfDoc('file:///a.sldd')).toEqual(mark('cut', ['design', 'A'], ['other', 'A'], ['arch', 'B']));
  });

  it("keys a MAT-file's variables under its one section, ''", () => {
    setClipboard([item('kp', '')], 'copy', 'file:///gains.mat');
    expect(clipMarkOfDoc('file:///gains.mat')).toEqual(mark('copy', ['', 'kp']));
  });

  it('skips an item with no name, and is undefined when none has one', () => {
    setClipboard([item('', 'design'), item(42, 'design'), item('B', 'design')], 'copy', 'file:///a.sldd');
    expect(clipMarkOfDoc('file:///a.sldd')).toEqual(mark('copy', ['design', 'B']));
    setClipboard([item('', 'design')], 'copy', 'file:///a.sldd');
    expect(clipMarkOfDoc('file:///a.sldd')).toBeUndefined();
  });
});

describe('sameClipMark', () => {
  it('ignores the order the entries were marked in', () => {
    expect(sameClipMark(mark('cut', ['d', 'A'], ['d', 'B']), mark('cut', ['d', 'B'], ['d', 'A']))).toBe(true);
    expect(sameClipMark(undefined, undefined)).toBe(true);
  });

  it('tells a cut from a copy of the same entries, and a mark from none', () => {
    expect(sameClipMark(mark('cut', ['d', 'A']), mark('copy', ['d', 'A']))).toBe(false);
    expect(sameClipMark(mark('cut', ['d', 'A']), undefined)).toBe(false);
    expect(sameClipMark(mark('cut', ['d', 'A']), mark('cut', ['a', 'A']))).toBe(false);
  });
});

describe('clipMarkChange', () => {
  it('is null where the mark did not move: nothing to repaint', () => {
    expect(clipMarkChange(undefined, undefined)).toBeNull();
    expect(clipMarkChange(mark('copy', ['', 'x'], ['', 'y']), mark('copy', ['', 'y'], ['', 'x']))).toBeNull();
  });

  it('names every entry either mark names, once', () => {
    const change = clipMarkChange(mark('copy', ['design', 'A'], ['design', 'B']), mark('copy', ['design', 'B'], ['arch', 'C']));
    expect(change).toEqual([
      { section: 'design', name: 'A' },
      { section: 'design', name: 'B' },
      { section: 'arch', name: 'C' },
    ]);
  });

  it('names the entries of a copy re-taken as a cut, which changes their affordance', () => {
    expect(clipMarkChange(mark('copy', ['', 'x']), mark('cut', ['', 'x']))).toEqual([{ section: '', name: 'x' }]);
  });

  it('names what loses the mark when the clipboard empties, and what gains it on the first copy', () => {
    expect(clipMarkChange(mark('cut', ['', 'x']), undefined)).toEqual([{ section: '', name: 'x' }]);
    expect(clipMarkChange(undefined, mark('cut', ['design', 'A']))).toEqual([{ section: 'design', name: 'A' }]);
  });
});
