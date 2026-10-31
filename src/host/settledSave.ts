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
//    save point has not moved, so the dirty-flag copy (an EditStackCopy) does not move either.
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
//    An extra round that fails (the write, the save gate, a conflict on disk) would fail a save
//    VS Code no longer listens to: nobody would be told, and the tab would stay clean over a file
//    that may hold the older document. So the document is marked unsaved instead, in VS Code and
//    in the copy, until it is saved or reverted (closing the tab then asks), the save point left
//    where it is, and the user is told to save again (`UnfinishedSave`); not after a conflict,
//    whose prompt is already asking them, and whose Revert is their own choice.
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
import { EditStackIndex } from 'data-explorer-view/host';

/**
 * View's EditStackIndex, with the one more way VS Code's custom-editor model has to be dirty: a
 * change event with no undo and redo (a CustomDocumentContentChangeEvent) leaves the document dirty
 * until it is saved or reverted, whatever its stack does meanwhile (`_isDirtyFromContentChange`,
 * measured against VS Code 1.144's workbench). The copy each byte-backed document keeps.
 *
 * It is also where VS Code is told of the cases its own flag gets wrong, each on a move of the stack,
 * which then also calls `lost`, for the document to send VS Code that change event: it keeps the tab
 * dirty until the next save or revert, as the copy is.
 *  - VS Code's save point is an index into its edit list, and a new edit takes the place of the
 *    undone ones: save, undo past the save, make a different edit, and the new edit sits at the saved
 *    index, so VS Code reads the tab clean over a file that lacks it (`isDirty` is `_savePoint !==
 *    _currentEditIndex`; `pushEdit` splices the list at the current index). EditStackIndex calls that
 *    save point unreachable.
 *  - A document restored from a hot-exit backup is dirty in VS Code only while its edit list is empty
 *    (`isDirty` reads `_fromBackup` only then): one edit and its undo put the index back at the save
 *    point, and VS Code reads clean over a file that never held the restored document. EditStackIndex
 *    keeps it dirty until it is saved or reverted. The first push tells VS Code.
 *  - Once a push has discarded a save point, VS Code's index stays unreliable: its revert puts the
 *    index at that stale save point and keeps the edits before it, whose undo and redo no longer
 *    lead to the file, and a later save sets the save point over them. From then on, the first move
 *    after every save or revert tells VS Code too. VS Code then reads clean only from a save or a
 *    revert to the next move, while the document is the file. It errs dirty: such a document's tab
 *    can stay dirty after an undo back to a save.
 */
export class EditStackCopy extends EditStackIndex {
  private changedOffStack = false;
  /** Where the save point is, as this copy last set it, or null once a push discarded it. */
  private savePoint: number | null = 0;
  /** Restored from a backup, with VS Code not yet told: until a push, a save or a revert. */
  private restored: boolean;
  /** A push has discarded a save point, so VS Code's index is unreliable from then on (see above). */
  private indexStale = false;
  /** Set by a save or a revert while `indexStale`: the next move tells VS Code. */
  private armed = false;

  /** `lost`: a move VS Code would read as reaching the save point (see above). */
  constructor(
    fromBackup = false,
    private readonly lost: () => void = () => {},
  ) {
    super(fromBackup);
    this.restored = fromBackup;
  }

  override get dirty(): boolean {
    return this.changedOffStack || super.dirty;
  }

  /** VS Code was told the document changed with no edit on its stack. */
  changedWithoutEdit(): void {
    this.changedOffStack = true;
  }

  override pushed(): void {
    // The save point is among the undone edits this push discards (EditStackIndex's own test).
    const discards = this.savePoint !== null && this.savePoint > this.here();
    const tell = discards || this.restored || this.armed;
    super.pushed();
    if (discards) {
      this.savePoint = null;
      this.indexStale = true;
    }
    if (tell) this.tell();
  }

  override undone(): void {
    super.undone();
    if (this.armed) this.tell();
  }

  override redone(): void {
    super.redone();
    if (this.armed) this.tell();
  }

  override saved(at?: number): void {
    this.changedOffStack = false;
    this.restored = false;
    super.saved(at);
    this.savePoint = at ?? this.here();
    this.armed = this.indexStale;
  }

  override reverted(): void {
    this.changedOffStack = false;
    // Its save point moves, and the next move is armed, through `saved`, which EditStackIndex.reverted calls.
    super.reverted();
  }

  /** VS Code is told the document changed with no edit, as the copy now reads it. */
  private tell(): void {
    this.restored = false;
    this.armed = false;
    this.changedWithoutEdit();
    this.lost();
  }
}

/**
 * What a save does when VS Code has cancelled it and the extra round that was writing over the newer
 * save fails (writeOverWhileBehind): the file may then hold the older document.
 */
export interface UnfinishedSave {
  /** The file's name, as the notice says it. */
  readonly name: string;
  /** Tell VS Code the document changed, with no edit on its stack: it stays dirty until a save or a revert. */
  changed(): void;
  /** Show the user an error. */
  tell(message: string): void;
  /** Whether `err` is a save conflict's refusal (diskFollow.refuseIfChangedOnDisk), whose prompt asks the user. */
  isConflict(err: unknown): boolean;
}

/** What the user is told when an extra round fails. */
export const unfinishedSaveMessage = (name: string): string =>
  `Couldn't finish saving ${name}; the file on disk may be older than the editor. Save again.`;

/** The one thing a save asks of VS Code's cancellation token. */
export interface SaveCancellation {
  readonly isCancellationRequested: boolean;
}

/**
 * Run `round` (one save: serialize the document before its first await, then write it) until
 * one runs with the stack still, then move the dirty-flag copy's save point to where it ran.
 * `round` resolves true when its write landed behind a newer save's that had already landed;
 * `unfinished` is what an extra round written over that newer save does if it fails.
 */
export async function saveSettled(
  edits: EditStackCopy,
  token: SaveCancellation | undefined,
  round: () => Promise<boolean | void>,
  unfinished: UnfinishedSave,
): Promise<void> {
  for (;;) {
    // Read where the round reads the document, before its first await.
    const at = edits.here();
    const moves = edits.moves;
    const behind = (await round()) === true;
    if (token?.isCancellationRequested) {
      await writeOverWhileBehind(edits, moves, behind, round, unfinished);
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
 * point is not moved. A round that fails ends it, the document marked unsaved.
 */
async function writeOverWhileBehind(
  edits: EditStackCopy,
  moves: number,
  behind: boolean,
  round: () => Promise<boolean | void>,
  unfinished: UnfinishedSave,
): Promise<void> {
  while (behind && !edits.dirty && edits.moves !== moves) {
    moves = edits.moves;
    try {
      behind = (await round()) === true;
    } catch (err) {
      // VS Code ignores this save's answer, so a rejection would tell nobody. The save point stays.
      edits.changedWithoutEdit();
      unfinished.changed();
      // A conflict on disk: its prompt is asking the user (diskFollow.refuseIfChangedOnDisk), and
      // Revert there is their own choice, not a save that failed.
      if (!unfinished.isConflict(err)) unfinished.tell(unfinishedSaveMessage(unfinished.name));
      return;
    }
  }
}
