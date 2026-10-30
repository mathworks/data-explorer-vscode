// Copyright 2026 The MathWorks, Inc.
//
// A save of a writable byte-backed document (the binary .sldd and the MAT-file) that resolves
// only once the file holds the document as it stands, for both providers' saveCustomDocument.
//
// VS Code's custom-editor model moves its save point to its CURRENT edit index when the
// provider's save resolves (`_savePoint = this._currentEditIndex`, after it awaits the save),
// not to the index the save was asked at. Each provider serializes the document before its
// first await, and then awaits a stat, the conflict check and the write: an edit, undo or redo
// that lands on those awaits is not in the bytes, yet VS Code counts it saved. The tab shows
// clean over a file that lacks it, and closing the tab drops it without asking.
//
// So a save the stack moved under is run again, from the document as it now stands, and only a
// round that ran with the stack still resolves: the file then holds what VS Code is about to
// call saved. Measured against VS Code 1.143's workbench, which is where those lines are.
//
//  - It cannot loop. A round is run again only because the stack moved while the round before
//    it ran, and nothing moves the stack but the user (an edit, an undo, a redo, a revert):
//    with none, the next round is the last. Each round writes the latest document, so a run of
//    them loses nothing either.
//  - A round that fails fails the save VS Code is waiting on: VS Code keeps the document dirty
//    and says why (core's refusal of the newer edit, the conflict prompt). The rounds before it
//    did write, and the provider has recorded that (the stamp, the Status column), but VS Code's
//    save point has not moved, so the dirty-flag copy (an EditIndex) does not move either.
//    That is why `saved` is called here, once, at the end, and not by a provider's round.
//  - A cancelled save stops. VS Code cancels a save's token when it starts another save of the
//    same document, and from then on ignores the first one's result: the save point is the
//    newer save's to move, and so is the copy's.
//  - But VS Code lets the cancelled save's write finish, and when it lands after the newer save's,
//    the file holds the OLDER document while VS Code shows the tab clean: closing it asks nothing
//    and loses the newer edit (open-questions 16 B). The round says so (the engine's `saved`
//    answers true), and the document is then written once more, as it stands, which is what the
//    newer save wrote: the file is then what VS Code calls saved. Two rules keep that safe:
//      - Not when the document reads dirty: an edit made after the newer save is VS Code's to
//        save (the tab shows it dirty, and the next save writes it all, D44). And never the save
//        point: it is the newer save's, and an edit that lands on the extra round's write leaves
//        the document dirty, as it must.
//      - One extra round per save that landed behind. Another follows only if that round landed
//        behind too, which needs the user to have edited and saved again while it was writing
//        (the stack moved). With nothing moved there is nothing a newer save could have written,
//        and it stops: a round that keeps saying it landed behind cannot loop.
//
// A follow-up `vscode.workspace.save` after a plain save was the other way to do it. It leaves
// a window in which VS Code shows clean what is not on disk (close the tab in it, and the edit is
// gone), and a follow-up that fails leaves VS Code showing clean for good.
//
// What is left is a race of one message between the two processes: an undo VS Code has made
// but not yet sent, or an edit sent just behind the save's answer, and VS Code's own model
// decides it. No extension can see it.
//
// vscode-free, so the rule is unit-tested (test/settledSave.test.ts).
import type { EditIndex } from 'data-explorer-view/host';

/** The one thing a save asks of VS Code's cancellation token. */
export interface SaveCancellation {
  readonly isCancellationRequested: boolean;
}

/**
 * Run `round` (one save: serialize the document before its first await, then write it) until
 * one runs with the stack still, then move the dirty-flag copy's save point to where it ran.
 * `round` resolves true when its write landed behind a newer save's that had already landed.
 */
export async function saveSettled(
  edits: EditIndex,
  token: SaveCancellation | undefined,
  round: () => Promise<boolean | void>,
): Promise<void> {
  for (;;) {
    // Read where the round reads the document, before its first await.
    const at = edits.here();
    const moves = edits.moves;
    const behind = (await round()) === true;
    if (token?.isCancellationRequested) {
      await writeOverWhileBehind(edits, moves, behind, round);
      return;
    }
    if (edits.moves === moves) {
      edits.saved(at);
      return;
    }
  }
}

/**
 * A save VS Code cancelled whose write landed behind the newer save's (`behind`): the document
 * written once more as it stands, while it reads clean, and again only for a round that landed
 * behind with the stack moved under it (`moves`, where it was when that round began). The save
 * point is not moved.
 */
async function writeOverWhileBehind(edits: EditIndex, moves: number, behind: boolean, round: () => Promise<boolean | void>): Promise<void> {
  while (behind && !edits.dirty && edits.moves !== moves) {
    moves = edits.moves;
    behind = (await round()) === true;
  }
}
