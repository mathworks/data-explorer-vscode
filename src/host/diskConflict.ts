// Copyright 2026 The MathWorks, Inc.
//
// How the writable byte-backed views (the binary .sldd and the MAT-file) tell that their
// file changed on disk, and whether they are holding unsaved edits when that happens. The
// VS Code half — the watcher, the save that refuses, the prompt — is in diskFollow.ts. This
// half has no `vscode` import, so vitest can test it (test/diskConflict.test.ts).
//
// The rule is "follow VS Code", meaning what VS Code does for a text file. The JSON .sldd
// view gets that for free: it is a CustomTextEditorProvider, backed by VS Code's own
// TextDocument. The byte-backed views are plain CustomEditorProviders, and VS Code does
// neither half for one of those. It never tells a custom editor that its
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
 * Either number moving counts as a change, which is STRICTER than VS Code. VS Code's `validateWriteFile` refuses only when
 * the mtime on disk is LATER and the size differs, and then still writes if the bytes on disk
 * equal the bytes it is about to write. So VS Code misses a rewrite to the same size and a
 * rewrite with an older mtime (`tar -xp`). This check catches both. It refuses in every case
 * VS Code refuses, so it never lets through a write VS Code would block.
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
 * A copy of the dirty flag VS Code computes for a custom document from its own edit stack: view's
 * EditStackIndex, which the editors on view's engines are given as their EditIndex, and which is
 * this class as it was here, line for line. The name stays for this module's tests until the
 * suites are rebalanced onto view's (step 6b, V6).
 */
export { EditStackIndex as EditStackMirror } from 'data-explorer-view/host';
