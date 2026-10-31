// Copyright 2026 The MathWorks, Inc.
//
// open-questions 16 B, review169 P1 (design: docs/deep-work/2026-10-28-view-split/bug16-design.md),
// failing today. VS Code cancels a save's token when it starts a newer save of the same document,
// and lets the first one's write finish. When that older write lands last, the file holds the older
// document while VS Code, whose save point the newer save moved, shows the tab clean: closing it
// asks nothing and loses the newer edit. Both byte-backed providers run their save through
// saveSettled, whose round then tells it (the engine's `saved` answers true) that the write landed
// behind one already landed. The fix: write the document once more, as it stands, which is what the
// newer save wrote, so that the file is what VS Code calls saved. Not when the document has moved
// since (VS Code shows it dirty, and the next save writes it all, D44), and without moving the save
// point, which is the newer save's.
import { describe, it, expect } from 'vitest';
import { EditStackCopy, saveSettled, unfinishedSaveMessage, type UnfinishedSave } from '../src/host/settledSave.js';

/**
 * The older of two saves, as VS Code runs it: its round reads the stack, then, on its write's await,
 * the user edits and saves again, which cancels this save's token and lands first, moving the save
 * point (`edits.saved`) to the newer position. The round then lands behind it. `after` is what the
 * user does once the newer save has landed; `duringExtra[i]` what lands on the i-th extra round's
 * write; `behind(i)` whether round i reports it landed behind (by default the first only);
 * `fails(i)` what round i throws, if anything. Each round records the position it read, and what
 * the save does when an extra round fails is heard in `unfinished`.
 */
function olderSave(
  opts: {
    after?: (edits: EditStackCopy) => void;
    duringExtra?: ((edits: EditStackCopy) => void)[];
    behind?: (round: number) => boolean;
    fails?: (round: number) => unknown;
  } = {},
) {
  const edits = new EditStackCopy();
  const token = { isCancellationRequested: false };
  const written: number[] = [];
  let rounds = 0;
  const round = async (): Promise<boolean> => {
    const i = rounds++;
    const at = edits.here();
    await Promise.resolve();
    if (i === 0) {
      edits.pushed();
      token.isCancellationRequested = true;
      edits.saved(edits.here());
      opts.after?.(edits);
    } else {
      opts.duringExtra?.[i - 1]?.(edits);
    }
    const failure = opts.fails?.(i);
    if (failure) throw failure;
    written.push(at);
    return opts.behind ? opts.behind(i) : i === 0;
  };
  edits.pushed();
  const unfinished = heard();
  return { edits, token, written, round, unfinished, save: () => saveSettled(edits, token, round, unfinished) };
}

/** The refusal of a save conflict, as `isConflict` knows it. */
const CONFLICT = new Error('the file changed on disk');

/** An UnfinishedSave that records what the save told VS Code (`changed`) and the user (`told`). */
function heard(): UnfinishedSave & { changes: number; told: string[] } {
  const h = {
    name: 'params.sldd',
    changes: 0,
    told: [] as string[],
    changed: () => void h.changes++,
    tell: (message: string) => void h.told.push(message),
    isConflict: (err: unknown) => err === CONFLICT,
  };
  return h;
}

describe('saveSettled: a save VS Code cancelled whose write lands after the newer save', () => {
  it('writes the document once more, as it stands, and leaves the save point to the newer save', async () => {
    const d = olderSave();
    await d.save();
    expect(d.written, 'the older write, then the document as the newer save wrote it').toEqual([1, 2]);
    expect(d.edits.dirty, 'VS Code shows it clean, and the file now holds that').toBe(false);
  });

  it('writes nothing more when the document moved since the newer save: VS Code shows it dirty', async () => {
    const d = olderSave({ after: (e) => e.pushed() });
    await d.save();
    expect(d.written).toEqual([1]);
    expect(d.edits.dirty, 'the next save writes it all').toBe(true);
  });

  it('loses no edit that lands on the extra write: the save point stays, and the document reads dirty', async () => {
    const d = olderSave({ duringExtra: [(e) => e.pushed()] });
    await d.save();
    expect(d.written, 'the extra round wrote the document as the newer save left it').toEqual([1, 2]);
    expect(d.edits.dirty, 'the edit on its write is not called saved').toBe(true);
    expect(d.edits.here(), 'and is still applied').toBe(3);
  });

  it('runs one extra round per save that landed behind: a round that keeps saying so with nothing moved stops', async () => {
    const d = olderSave({ behind: () => true });
    await d.save();
    expect(d.written, 'the older write and one more, and no further').toEqual([1, 2]);
    expect(d.edits.dirty).toBe(false);
  });

  it('and one more only for an extra round that landed behind a save the user made while it wrote', async () => {
    // On the extra round's write the user edits and saves again, and that save lands first: the
    // extra round then landed behind it, and is written over once in its turn.
    const d = olderSave({
      duringExtra: [
        (e) => {
          e.pushed();
          e.saved(e.here());
        },
      ],
      behind: (i) => i < 2,
    });
    await d.save();
    expect(d.written).toEqual([1, 2, 3]);
    expect(d.edits.dirty).toBe(false);
  });
});

describe('saveSettled: an extra round that fails', () => {
  // VS Code no longer listens to the cancelled save, so its failure would tell nobody, and the tab
  // would stay clean over a file that may hold the older document. review184 L1.
  const failures: [string, unknown][] = [
    ['a write that fails', new Error('EACCES: permission denied')],
    ['a save the gate refuses', new Error('Refusing to save: entry "gravity" would be written with bytes other than the file\'s')],
  ];
  for (const [what, failure] of failures) {
    it(`${what}: the document reads unsaved, the user is told once, and the save point stays`, async () => {
      const d = olderSave({ fails: (i) => (i === 1 ? failure : undefined) });
      await expect(d.save(), 'VS Code ignores this save, so it does not reject').resolves.toBeUndefined();
      expect(d.written, 'the older write; the extra round wrote nothing').toEqual([1]);
      expect(d.unfinished.changes, 'VS Code told once: it keeps the document dirty until a save or a revert').toBe(1);
      expect(d.unfinished.told).toEqual([unfinishedSaveMessage('params.sldd')]);
      expect(d.edits.dirty, 'closing the tab asks').toBe(true);
      d.edits.undone();
      d.edits.redone();
      expect(d.edits.dirty, 'whatever the stack does').toBe(true);
      d.edits.saved(d.edits.here());
      expect(d.edits.dirty, 'until a save').toBe(false);
    });
  }

  it("a conflict on disk: the document reads unsaved, and the user is not told, the conflict's prompt asking them", async () => {
    const d = olderSave({ fails: (i) => (i === 1 ? CONFLICT : undefined) });
    await d.save();
    expect(d.written).toEqual([1]);
    expect(d.unfinished.changes).toBe(1);
    expect(d.unfinished.told, 'Revert at the prompt is the user’s own choice').toEqual([]);
    expect(d.edits.dirty, 'so the prompt’s Revert and Overwrite have something to act on').toBe(true);
    d.edits.reverted();
    expect(d.edits.dirty, 'until a revert').toBe(false);
  });

  it('a failed round ends the save: no round after it, even one that would have landed behind', async () => {
    const d = olderSave({
      duringExtra: [
        (e) => {
          e.pushed();
          e.saved(e.here());
        },
      ],
      behind: () => true,
      fails: (i) => (i === 1 ? new Error('EIO') : undefined),
    });
    await d.save();
    expect(d.written).toEqual([1]);
    expect(d.unfinished.changes).toBe(1);
    expect(d.unfinished.told).toHaveLength(1);
  });

  it('tells the user in their words', () => {
    expect(unfinishedSaveMessage('params.sldd')).toBe(
      "Couldn't finish saving params.sldd; the file on disk may be older than the editor. Save again.",
    );
  });

  it('the save point is not moved: an undo to the newer save still reads unsaved', async () => {
    const d = olderSave({ fails: (i) => (i === 1 ? new Error('EIO') : undefined) });
    await d.save();
    d.edits.undone();
    expect(d.edits.dirty).toBe(true);
    d.edits.redone();
    expect(d.edits.here(), 'the newer save’s position').toBe(2);
  });

  it("a cancelled save's own write that fails is not an unfinished save: it rejects, and nothing is told", async () => {
    // Its write never landed, so the file holds the newer save's.
    const d = olderSave({ fails: (i) => (i === 0 ? new Error('EIO') : undefined) });
    await expect(d.save()).rejects.toThrow('EIO');
    expect(d.unfinished.changes).toBe(0);
    expect(d.unfinished.told).toEqual([]);
  });
});

describe('EditStackCopy: a change VS Code was told of with no edit on its stack', () => {
  it('is dirty until a save, whatever undo and redo do, and is otherwise view’s EditStackIndex', () => {
    const c = new EditStackCopy();
    expect(c.dirty).toBe(false);
    c.changedWithoutEdit();
    expect(c.dirty).toBe(true);
    c.pushed();
    c.undone();
    expect(c.dirty, 'back at the save point, still dirty').toBe(true);
    c.saved();
    expect(c.dirty).toBe(false);
    c.pushed();
    expect(c.dirty, 'an edit after the save').toBe(true);
    c.undone();
    expect(c.dirty).toBe(false);
  });

  it('or until a revert', () => {
    const c = new EditStackCopy();
    c.changedWithoutEdit();
    const moves = c.moves;
    c.reverted();
    expect(c.dirty).toBe(false);
    expect(c.moves, 'a revert moves the stack, as view’s does').toBe(moves + 1);
  });

  it('a document restored from a backup reads dirty, as before', () => {
    const c = new EditStackCopy(true);
    expect(c.dirty).toBe(true);
    c.saved();
    expect(c.dirty).toBe(false);
  });
});
