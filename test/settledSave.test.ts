// Copyright 2026 The MathWorks, Inc.
// A save of the binary .sldd or the MAT-file editor resolves only once the file holds the
// document as it stands (src/host/settledSave.ts): VS Code calls saved whatever the document
// holds when the save resolves, so an edit that lands on the save's awaits is written again
// before it does, and the dirty-flag copy moves only as VS Code's save point does.
import { describe, it, expect } from 'vitest';
import { EditStackMirror } from '../src/host/diskConflict.js';
import { saveSettled } from '../src/host/settledSave.js';

/**
 * A document whose save rounds each read the stack's position before their first await, as both
 * providers' do, and run `during[i]` on the await of round i (what lands while it writes).
 */
function document(during: ((edits: EditStackMirror) => void)[] = [], fail: Set<number> = new Set()) {
  const edits = new EditStackMirror();
  const written: number[] = [];
  const round = async () => {
    const i = written.length;
    const at = edits.here();
    await Promise.resolve();
    during[i]?.(edits);
    if (fail.has(i)) {
      written.push(-1);
      throw new Error(`round ${i} refused`);
    }
    written.push(at);
  };
  return { edits, written, round };
}

describe('saveSettled', () => {
  it('a save nothing lands on writes once, and the document is clean', async () => {
    const d = document();
    d.edits.pushed();
    await saveSettled(d.edits, undefined, d.round);
    expect(d.written).toEqual([1]);
    expect(d.edits.dirty).toBe(false);
  });

  it('an edit that lands while the save writes is written by a second round before it resolves', async () => {
    const d = document([(e) => e.pushed()]);
    d.edits.pushed();
    await saveSettled(d.edits, undefined, d.round);
    expect(d.written, 'the edit, then the edit that landed').toEqual([1, 2]);
    expect(d.edits.dirty, 'what VS Code now calls saved is on disk').toBe(false);
  });

  it('an undo and a new edit that put the stack back where it was still write again', async () => {
    // The position the save read is the position now, over another document.
    const d = document([
      (e) => {
        e.undone();
        e.pushed();
      },
    ]);
    d.edits.pushed();
    await saveSettled(d.edits, undefined, d.round);
    expect(d.written).toEqual([1, 1]);
    expect(d.edits.dirty).toBe(false);
  });

  it('an undo, a redo and a revert that land on the write each write again', async () => {
    for (const move of [(e: EditStackMirror) => e.undone(), (e: EditStackMirror) => e.redone(), (e: EditStackMirror) => e.reverted()]) {
      const d = document([move]);
      d.edits.pushed();
      d.edits.pushed();
      d.edits.undone();
      await saveSettled(d.edits, undefined, d.round);
      expect(d.written.length).toBe(2);
      expect(d.edits.dirty).toBe(false);
    }
  });

  it('rounds run until one runs with the stack still, and no further', async () => {
    const d = document([(e) => e.pushed(), (e) => e.pushed()]);
    d.edits.pushed();
    await saveSettled(d.edits, undefined, d.round);
    expect(d.written).toEqual([1, 2, 3]);
    expect(d.edits.dirty).toBe(false);
  });

  it('a later round that fails fails the save, and leaves the save point where VS Code keeps it', async () => {
    // The first round wrote; VS Code moves no save point for a save that rejects.
    const d = document([(e) => e.pushed()], new Set([1]));
    d.edits.pushed();
    await expect(saveSettled(d.edits, undefined, d.round)).rejects.toThrow('round 1 refused');
    expect(d.written).toEqual([1, -1]);
    expect(d.edits.dirty).toBe(true);
    d.edits.undone();
    expect(d.edits.dirty, 'not even at the first round’s position: VS Code was never told it saved').toBe(true);
    d.edits.undone();
    expect(d.edits.dirty, 'the save point VS Code holds').toBe(false);
  });

  it('a first round that fails writes nothing, moves nothing, and runs no other', async () => {
    const d = document([(e) => e.pushed()], new Set([0]));
    d.edits.pushed();
    await expect(saveSettled(d.edits, undefined, d.round)).rejects.toThrow('round 0 refused');
    expect(d.written).toEqual([-1]);
    expect(d.edits.dirty).toBe(true);
  });

  it('a save VS Code cancelled for a newer one is not run again, and leaves the save point to it', async () => {
    const token = { isCancellationRequested: false };
    const d = document([
      (e) => {
        e.pushed();
        token.isCancellationRequested = true;
      },
    ]);
    d.edits.pushed();
    await saveSettled(d.edits, token, d.round);
    expect(d.written).toEqual([1]);
    d.edits.undone();
    expect(d.edits.dirty, 'not moved to the cancelled save’s position').toBe(true);
  });
});
