// Copyright 2026 The MathWorks, Inc.
// The Status column of the MAT-file editor: which variables differ from the file as last saved,
// kept beside VS Code's edit stack (src/host/saveMarks.ts). Core's own marks outlive a save,
// because they are what make a save write an edit; these are what the column shows.
import { describe, it, expect } from 'vitest';
import { SaveMarks, replacementsIn, type MarkedEdit, type SaveSnapshot } from '../src/host/saveMarks.js';

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

// The list as it was before it was bounded: every edit ever made, each asked at every answer. The
// bounded one (HOW MUCH IS HELD, in saveMarks.ts) must answer as this does, whatever the history.
class EveryEdit {
  private entries: { touched: Set<object>; added: Set<object>; replaced: Map<object, object>; applied: boolean; atSave: boolean }[] = [];
  push(touched: object[], added: object[], replaced: Map<object, object>) {
    const entry = { touched: new Set(touched), added: new Set(added.filter((n) => !replaced.has(n))), replaced, applied: true, atSave: false };
    this.entries.push(entry);
    return { undone: () => void (entry.applied = false), redone: () => void (entry.applied = true) };
  }
  snapshot() {
    return new Map(this.entries.map((e) => [e, e.applied]));
  }
  commit(snapshot: Map<object, boolean>) {
    for (const entry of this.entries) {
      const applied = snapshot.get(entry);
      if (applied !== undefined) entry.atSave = applied;
    }
  }
  clear() {
    this.entries = [];
  }
  differing(): number {
    return this.entries.filter((e) => e.applied !== e.atSave).length;
  }
  marks(): Map<object, string> {
    const marks = new Map<object, string>();
    for (const e of this.entries) {
      if (e.applied === e.atSave) continue;
      for (const node of e.touched) {
        if (e.applied && e.added.has(node)) marks.set(node, 'New');
        else if (!marks.has(node)) marks.set(node, 'Modified');
      }
    }
    for (const e of this.entries) {
      if (!e.applied || e.atSave) continue;
      for (const [node, was] of e.replaced) if (marks.get(was) === 'New') marks.set(node, 'New');
    }
    return marks;
  }
}

describe('SaveMarks holds only the edits that differ, and answers as every edit would', () => {
  it('after a save, the edits it wrote are let go, and one undone past it is held again', () => {
    const marks = new SaveMarks<object>();
    const edits = Array.from({ length: 1000 }, (_, i) => marks.push([[a, b, c][i % 3]]));
    expect(marks.held).toBe(1000);
    marks.commit(marks.snapshot());
    expect(marks.held, 'nothing differs from the file').toBe(0);
    edits[999].undone();
    expect(marks.held).toBe(1);
    expect([...marks.marks()]).toEqual([[a, 'Modified']]);
    edits[999].redone();
    expect(marks.marks().size).toBe(0);
  });

  it('an edit held again takes its place in the order the edits were made', () => {
    // A chain of replacements is followed in that order (marks); held again out of it, the last
    // would be asked before the one it replaced.
    const marks = new SaveMarks<object>();
    const c2 = { name: 'c2' };
    const c3 = { name: 'c3' };
    const edits = [marks.push([c], [c]), marks.push([c, c2], [c2], new Map([[c2, c]])), marks.push([c2, c3], [c3], new Map([[c3, c2]]))];
    for (const e of [...edits].reverse()) e.undone();
    marks.commit(marks.snapshot());
    expect(marks.held).toBe(0);
    for (const e of [...edits].reverse()) e.redone();
    expect(marks.marks().get(c3)).toBe('New');
  });

  it('a save that fails and is released leaves nothing behind for later saves to tell', () => {
    const marks = new SaveMarks<object>();
    const first = marks.push([a]);
    marks.commit(marks.snapshot());
    const failed = marks.snapshot();
    marks.release(failed);
    first.undone();
    marks.commit(marks.snapshot());
    expect(marks.held).toBe(0);
    // A commit of the released one is no save, and moves nothing.
    marks.commit(failed);
    expect(marks.marks().size).toBe(0);
  });

  it('matches the whole list over random histories, saves overlapping and committing out of order', () => {
    // A small seeded generator, so that a failure names the history that broke it.
    let seed = 0x2f6e2b1;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <X>(xs: readonly X[]): X => xs[Math.floor(random() * xs.length)];
    const pool = Array.from({ length: 6 }, (_, i) => ({ name: `v${i}` }));
    const answer = (m: Map<object, string>) =>
      [...m].map(([n, mark]) => `${(n as { name: string }).name}:${mark}`).sort().join(' ');

    for (let history = 0; history < 400; history++) {
      const bounded = new SaveMarks<object>();
      const whole = new EveryEdit();
      // VS Code's stack: the edits it can undo and redo, and how many of them are applied.
      let stack: { b: MarkedEdit; w: ReturnType<EveryEdit['push']> }[] = [];
      let position = 0;
      const dropped: typeof stack = [];
      const inFlight: { b: SaveSnapshot; w: Map<object, boolean> }[] = [];
      const steps: string[] = [];
      for (let step = 0; step < 120; step++) {
        const r = random();
        if (r < 0.3) {
          const touched = pool.filter(() => random() < 0.3);
          if (touched.length === 0) touched.push(pick(pool));
          const added = touched.filter(() => random() < 0.3);
          const replaced = new Map<object, object>();
          if (random() < 0.2) replaced.set(pick(touched), pick(pool));
          dropped.push(...stack.splice(position));
          stack.push({ b: bounded.push(touched, added, replaced), w: whole.push(touched, added, replaced) });
          position++;
          steps.push('push');
        } else if (r < 0.45) {
          if (position === 0) continue;
          position--;
          stack[position].b.undone();
          stack[position].w.undone();
          steps.push('undo');
        } else if (r < 0.6) {
          if (position === stack.length) continue;
          stack[position].b.redone();
          stack[position].w.redone();
          position++;
          steps.push('redo');
        } else if (r < 0.63) {
          // Out of VS Code's order: an edit it dropped, moved all the same.
          if (dropped.length === 0) continue;
          const edit = pick(dropped);
          if (random() < 0.5) {
            edit.b.undone();
            edit.w.undone();
          } else {
            edit.b.redone();
            edit.w.redone();
          }
          steps.push('stray');
        } else if (r < 0.75) {
          inFlight.push({ b: bounded.snapshot(), w: whole.snapshot() });
          steps.push('snapshot');
        } else if (r < 0.9) {
          if (inFlight.length === 0) continue;
          const [save] = inFlight.splice(Math.floor(random() * inFlight.length), 1);
          bounded.commit(save.b);
          whole.commit(save.w);
          steps.push('commit');
          if (inFlight.length === 0) {
            expect(bounded.held, `history ${history}: ${steps.join(' ')}`).toBe(whole.differing());
          }
        } else if (r < 0.97) {
          if (inFlight.length === 0) continue;
          const [save] = inFlight.splice(Math.floor(random() * inFlight.length), 1);
          bounded.release(save.b);
          steps.push('release');
        } else {
          bounded.clear();
          whole.clear();
          // The stack VS Code holds after a reload is the old tree's: its edits move nothing here.
          dropped.push(...stack);
          stack = [];
          position = 0;
          steps.push('clear');
        }
        expect(answer(bounded.marks()), `history ${history}: ${steps.join(' ')}`).toBe(answer(whole.marks()));
      }
    }
  });
});
