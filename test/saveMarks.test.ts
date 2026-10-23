// Copyright 2026 The MathWorks, Inc.
// The Status column of the MAT-file editor: which variables differ from the file as last saved,
// kept beside VS Code's edit stack (src/host/saveMarks.ts). Core's own marks outlive a save,
// because they are what make a save write an edit; these are what the column shows.
import { describe, it, expect } from 'vitest';
import { SaveMarks, replacementsIn } from '../src/host/saveMarks.js';

const a = { name: 'a' };
const b = { name: 'b' };
const c = { name: 'c' };

describe('SaveMarks', () => {
  it('marks what an edit touched, and nothing before any edit', () => {
    const marks = new SaveMarks<object>();
    expect([...marks.marks()]).toEqual([]);
    marks.push([a]);
    expect([...marks.marks()]).toEqual([[a, 'Modified']]);
  });

  it('a save clears the marks of what it wrote, and the next edit marks again', () => {
    const marks = new SaveMarks<object>();
    marks.push([a]);
    marks.commit(marks.snapshot());
    expect(marks.marks().size).toBe(0);
    marks.push([b]);
    expect([...marks.marks().keys()]).toEqual([b]);
  });

  it('an edit undone back to the save is no longer marked; one undone past it is', () => {
    const marks = new SaveMarks<object>();
    const first = marks.push([a]);
    marks.commit(marks.snapshot());
    const second = marks.push([b]);
    second.undone();
    expect(marks.marks().size).toBe(0);
    // Past the save: the file holds `a`'s edit and the tree no longer does.
    first.undone();
    expect([...marks.marks()]).toEqual([[a, 'Modified']]);
    first.redone();
    expect(marks.marks().size).toBe(0);
  });

  it('an edit undone and then dropped by a newer one still differs from a save that held it', () => {
    const marks = new SaveMarks<object>();
    const first = marks.push([a]);
    marks.commit(marks.snapshot());
    first.undone();
    // VS Code drops `first` from its stack here; nothing tells this, and nothing needs to.
    marks.push([b]);
    expect([...marks.marks().keys()].sort((x: any, y: any) => x.name.localeCompare(y.name))).toEqual([a, b]);
  });

  it('a variable added since the save is New, and stays New through its edits', () => {
    const marks = new SaveMarks<object>();
    marks.push([c], [c]);
    marks.push([c]);
    expect(marks.marks().get(c)).toBe('New');
    marks.commit(marks.snapshot());
    marks.push([c]);
    expect(marks.marks().get(c)).toBe('Modified');
  });

  it('commits what was applied when the save serialized, not when its write finished', () => {
    const marks = new SaveMarks<object>();
    const first = marks.push([a]);
    const snapshot = marks.snapshot();
    // Both land while the write is in flight: neither is in the bytes on disk.
    first.undone();
    marks.push([b]);
    marks.commit(snapshot);
    const now = marks.marks();
    expect(now.get(a)).toBe('Modified');
    expect(now.get(b)).toBe('Modified');
  });

  it('a variable put in the place of one the file holds is Modified, not New', () => {
    // Core's retype: `a` swapped out, `a2` (a variable of another class, named `a`) swapped in.
    const marks = new SaveMarks<object>();
    const a2 = { name: 'a2' };
    marks.push([a, a2], [a2], new Map([[a2, a]]));
    expect(marks.marks().get(a2)).toBe('Modified');
  });

  it('a variable put in the place of one added since the save is New, however many times over', () => {
    const marks = new SaveMarks<object>();
    const c2 = { name: 'c2' };
    const c3 = { name: 'c3' };
    marks.push([c], [c]);
    marks.push([c, c2], [c2], new Map([[c2, c]]));
    marks.push([c2, c3], [c3], new Map([[c3, c2]]));
    expect(marks.marks().get(c2)).toBe('New');
    expect(marks.marks().get(c3), 'typed over twice, still not in the file').toBe('New');
    // Once the file is saved with `c`, a replacement of it is an edit of what the file holds.
    const saved = new SaveMarks<object>();
    saved.push([c], [c]);
    saved.commit(saved.snapshot());
    saved.push([c, c2], [c2], new Map([[c2, c]]));
    expect(saved.marks().get(c2)).toBe('Modified');
  });

  it('a replacement undone past the save that wrote it marks the variable it put back', () => {
    const marks = new SaveMarks<object>();
    const a2 = { name: 'a2' };
    const retype = marks.push([a, a2], [a2], new Map([[a2, a]]));
    marks.commit(marks.snapshot());
    expect(marks.marks().size).toBe(0);
    retype.undone();
    expect(marks.marks().get(a), 'the file holds `a2` where the tree holds `a`').toBe('Modified');
  });

  it('a reload from disk forgets every edit before it', () => {
    const marks = new SaveMarks<object>();
    const first = marks.push([a]);
    marks.clear();
    expect(marks.marks().size).toBe(0);
    // The closures VS Code still holds for it move nothing that is measured.
    first.undone();
    expect(marks.marks().size).toBe(0);
  });
});

describe('replacementsIn', () => {
  const id = (n: { name: string }) => 'f/' + n.name.replace(/2$/, '');
  it('pairs a variable added with one of its id the same gesture took out of the file', () => {
    const a2 = { name: 'a2' };
    const before = new Map<{ name: string }, string>([
      [a, 'f/a'],
      [b, 'f/b'],
    ]);
    const inFile = new Set([b, a2]);
    expect([...replacementsIn(before, [a2], id, (n) => inFile.has(n))]).toEqual([[a2, a]]);
  });

  it('pairs nothing with a variable still in the file, or with one of another id', () => {
    const a2 = { name: 'a2' };
    const before = new Map<{ name: string }, string>([
      [a, 'f/a'],
      [b, 'f/b'],
    ]);
    expect(replacementsIn(before, [a2], id, () => true).size, 'nothing left the file').toBe(0);
    const inFile = new Set([a, a2]);
    expect(replacementsIn(before, [a2], id, (n) => inFile.has(n)).size, '`b` left, which is not of its id').toBe(0);
    expect(replacementsIn(before, [c], id, () => false).size, 'an add alone').toBe(0);
  });
});
