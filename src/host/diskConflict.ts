// Copyright 2026 The MathWorks, Inc.
//
// How the writable binary .sldd view tells that its file changed on disk, and whether it
// is holding unsaved edits when that happens. The VS Code half — the watcher, the save that
// refuses, the prompt — is in BinarySlddEditorProvider. This half has no `vscode` import, so
// vitest can test it (test/diskConflict.test.ts).
//
// The rule is "follow VS Code", meaning what VS Code does for a text file (V-071, decided
// 2026-10-15). The JSON .sldd view gets that for free: it is a CustomTextEditorProvider,
// backed by VS Code's own TextDocument. The binary view is a plain CustomEditorProvider,
// and VS Code does neither half for one of those. It never tells a custom editor that its
// file moved, and it never checks the disk before the custom editor's save writes. So:
//
//   - outside change, no unsaved edits: reload from disk, silently;
//   - outside change, unsaved edits: do nothing, and keep the edits;
//   - save after an outside change: refuse, and ask Overwrite / Revert;
//   - the view's own saves are not outside changes;
//   - `files.saveConflictResolution: overwriteFileOnDisk` turns the check off.

/**
 * What the view knows about the file it last read or wrote: the two numbers VS Code keeps
 * for the same purpose. VS Code builds its etag from them (`mtime.toString(29) +
 * size.toString(31)`). `mtime` is milliseconds, as `vscode.FileStat` gives it.
 */
export interface DiskStamp {
  readonly mtime: number;
  readonly size: number;
}

/**
 * Whether the file on disk is no longer the one this view last loaded, reverted to, or wrote.
 *
 * `undefined` on either side means "no answer", and no answer is never a conflict:
 *
 *  - `now` undefined: the file is gone. VS Code keeps a text editor open on a deleted file,
 *    and its next save recreates the file. Its write check stats the target, and when the
 *    stat fails the write goes ahead.
 *  - `recorded` undefined: the view never managed to stat the file, so there is nothing to
 *    compare with. Refusing every save forever would be the only other answer.
 *
 * Either number moving counts as a change. That is the ruling's own wording ("mtime+size
 * differ"), and it is STRICTER than VS Code. VS Code's `validateWriteFile` refuses only when
 * the mtime on disk is LATER and the size differs, and then still writes if the bytes on disk
 * equal the bytes it is about to write. So VS Code misses a rewrite to the same size and a
 * rewrite with an older mtime (`tar -xp`). This check catches both. It refuses in every case
 * VS Code refuses, so following the ruling never lets through a write VS Code would block.
 *
 * Neither check can see a rewrite that keeps both numbers (`unzip -o` of the same revision, or
 * two writes of equal size in one tick on a coarse-mtime mount). VS Code has the same blind
 * spot. The read-only view gets around it by treating any watcher event as a change
 * (BinaryEditorProvider). This view cannot do that: one of those events is its own save.
 */
export function changedOnDisk(recorded: DiskStamp | undefined, now: DiskStamp | undefined): boolean {
  if (!recorded || !now) return false;
  return recorded.mtime !== now.mtime || recorded.size !== now.size;
}

/**
 * Whether `files.saveConflictResolution` asks for the check. Anything but
 * `overwriteFileOnDisk` does, which is what VS Code's own `preventSaveConflicts` returns:
 * `getValue('files.saveConflictResolution', …) !== 'overwriteFileOnDisk'`. An unset or
 * misspelled value keeps the check on.
 */
export function checksSaveConflicts(setting: unknown): boolean {
  return setting !== 'overwriteFileOnDisk';
}

/** The two answers the conflict prompt offers, worded as VS Code words them. */
export const OVERWRITE = 'Overwrite';
export const REVERT = 'Revert';

/**
 * The prompt, in VS Code's wording. This is the variant without Compare: VS Code's stored file
 * working copy shows it for a file that has no text model (nls key `staleSaveError`), with
 * the same two answers. A binary .sldd has no text diff to compare, so there is no Compare.
 */
export function conflictMessage(name: string): string {
  return `Failed to save '${name}': The content of the file is newer. Do you want to overwrite the file with your changes?`;
}

/**
 * Whether a save that has just been refused should show the prompt.
 *
 * VS Code puts a text model that failed this way into a conflict state, and while it is in
 * that state it ignores AUTOMATIC saves (after a delay, on focus change, on window change).
 * An explicit save still goes through and asks again. Auto-save therefore never repeats the
 * question. A custom editor cannot copy that rule exactly: VS Code does not tell
 * `saveCustomDocument` why it was called. So:
 *
 *  - a prompt that is still open is never shown a second time;
 *  - with auto-save off, every save comes from the user, so a save made after the prompt was
 *    dismissed asks again. That is what VS Code does;
 *  - with auto-save on, any save could be automatic, so once the document is in conflict no
 *    save shows the prompt again until the conflict is resolved. The cost is that an
 *    explicit save made after the prompt was dismissed does not ask again either. File:
 *    Revert File still resolves the conflict, and Save As still writes elsewhere.
 *
 * `autoSave` is the `files.autoSave` setting as read for the file. Only `'off'` means off,
 * and that is VS Code's default.
 */
export function promptsForConflict(state: {
  readonly promptOpen: boolean;
  readonly inConflict: boolean;
  readonly autoSave: unknown;
}): boolean {
  if (state.promptOpen) return false;
  if (!state.inConflict) return true;
  return state.autoSave === undefined || state.autoSave === 'off';
}

/**
 * A copy of the dirty flag VS Code computes for a custom document from its own edit stack.
 *
 * The provider needs it because "reload when there are no unsaved edits" asks VS Code's
 * question, and the API has no getter for the answer. VS Code's MainThreadCustomEditorModel
 * keeps a current index and a save point in its list of edits. A document is dirty when the
 * two differ, or when it was restored from a hot-exit backup and has not been saved or
 * reverted since. This class moves the same way, driven by the same events: an edit pushed,
 * an undo or redo VS Code asked for, a save, and a revert.
 *
 * One case is deliberately different, in the safe direction. A new edit discards the redo
 * tail, and the save point can be inside that tail (save, undo, then edit). VS Code leaves its
 * save-point index where it was, so enough further edits bring the current index back to it,
 * and VS Code then calls the document clean although its text has never been saved. Here
 * the save point becomes unreachable instead: the document stays dirty until it is saved or
 * reverted. When the two disagree, this copy says dirty. The only consequence is that a
 * reload waits, so unsaved edits are never discarded.
 */
export class EditStackMirror {
  /** How many edits are applied: VS Code's `_currentEditIndex + 1`. */
  private position = 0;
  /** The position that matches the file on disk, or `null` once that state is unreachable. */
  private savedAt: number | null = 0;
  private fromBackup: boolean;

  constructor(fromBackup = false) {
    this.fromBackup = fromBackup;
  }

  get dirty(): boolean {
    return this.fromBackup || this.savedAt !== this.position;
  }

  /** A new edit, which discards any redo tail. */
  pushed(): void {
    if (this.savedAt !== null && this.savedAt > this.position) this.savedAt = null;
    this.position++;
  }

  undone(): void {
    this.position--;
  }

  redone(): void {
    this.position++;
  }

  /** Where the stack is now, for a save to hand back to `saved` once its write lands. */
  here(): number {
    return this.position;
  }

  /**
   * What was applied at `at` is what is on disk: a save succeeded.
   *
   * `at` is the position when the save READ the document, not when its write finished. An
   * edit can land while the write is in flight, and the file does not have it. VS Code moves
   * its save point when the save resolves, so it counts that edit as saved. Here it stays
   * unsaved, which is the safe direction.
   */
  saved(at: number = this.position): void {
    this.savedAt = at;
    this.fromBackup = false;
  }

  /**
   * The document now holds what is on disk: a revert, or a reload. VS Code moves its current
   * index to the save point and drops the edits after it, so the next undo starts one step
   * before the save point. Only the distance between the two matters, so the save point moves
   * to the current position instead.
   */
  reverted(): void {
    this.saved();
  }
}
