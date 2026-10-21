// Copyright 2026 The MathWorks, Inc.
// The Status column of the MAT-file editor: which variables differ from the file as last saved,
// kept beside VS Code's edit stack (src/host/saveMarks.ts). Core's own marks outlive a save,
// because they are what make a save write an edit; these are what the column shows.
import { describe, it, expect } from 'vitest';
import { SaveMarks } from '../src/host/saveMarks.js';

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
