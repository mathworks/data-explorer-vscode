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
import { EditStackMirror } from '../src/host/diskConflict.js';
import { saveSettled } from '../src/host/settledSave.js';

/**
 * The older of two saves, as VS Code runs it: its round reads the stack, then, on its write's await,
 * the user edits and saves again, which cancels this save's token and lands first, moving the save
 * point (`edits.saved`) to the newer position. The round then lands behind it. `after` is what the
 * user does once the newer save has landed. Each later round records the position it wrote.
 */
function olderSave(after?: (edits: EditStackMirror) => void) {
  const edits = new EditStackMirror();
  const token = { isCancellationRequested: false };
  const written: number[] = [];
  let rounds = 0;
  const round = async (): Promise<boolean> => {
    const first = rounds++ === 0;
    const at = edits.here();
    await Promise.resolve();
    if (first) {
      edits.pushed();
      token.isCancellationRequested = true;
      edits.saved(edits.here());
      after?.(edits);
    }
    written.push(at);
    // The engine's answer: the first round's write landed behind the newer save's.
    return first;
  };
  edits.pushed();
  return { edits, token, written, round };
}

describe('saveSettled: a save VS Code cancelled whose write lands after the newer save', () => {
  it('writes the document once more, as it stands, and leaves the save point to the newer save', async () => {
    const d = olderSave();
    await saveSettled(d.edits, d.token, d.round);
    expect(d.written, 'the older write, then the document as the newer save wrote it').toEqual([1, 2]);
    expect(d.edits.dirty, 'VS Code shows it clean, and the file now holds that').toBe(false);
  });

  it('writes nothing more when the document moved since the newer save: VS Code shows it dirty', async () => {
    const d = olderSave((e) => e.pushed());
    await saveSettled(d.edits, d.token, d.round);
    expect(d.written).toEqual([1]);
    expect(d.edits.dirty, 'the next save writes it all').toBe(true);
  });
});
