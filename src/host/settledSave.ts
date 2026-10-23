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
//    save point has not moved, so the dirty-flag copy (EditStackMirror) does not move either.
//    That is why `saved` is called here, once, at the end, and not by a provider's round.
//  - A cancelled save stops. VS Code cancels a save's token when it starts another save of the
//    same document, and from then on ignores the first one's result: the save point is the
//    newer save's to move, and so is the copy's.
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
import type { EditStackMirror } from './diskConflict.js';

/** The one thing a save asks of VS Code's cancellation token. */
export interface SaveCancellation {
  readonly isCancellationRequested: boolean;
}

/**
 * Run `round` (one save: serialize the document before its first await, then write it) until
 * one runs with the stack still, then move the dirty-flag copy's save point to where it ran.
 */
export async function saveSettled(
  edits: EditStackMirror,
  token: SaveCancellation | undefined,
  round: () => Promise<void>,
): Promise<void> {
  for (;;) {
    // Read where the round reads the document, before its first await.
    const at = edits.here();
    const moves = edits.moves;
    await round();
    if (token?.isCancellationRequested) return;
    if (edits.moves === moves) {
      edits.saved(at);
      return;
    }
  }
}
