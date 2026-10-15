// Copyright 2026 The MathWorks, Inc.
//
// The pure half of how the writable binary .sldd view follows its file on disk (V-071):
// when the disk counts as changed, whether the setting asks for the check, when a refused
// save asks the user, and the copy of VS Code's dirty flag that decides between "reload"
// and "keep the edits". The VS Code half is exercised end to end in
// test-integration/suite/binarySlddOutsideChange.test.ts.
import { describe, it, expect } from 'vitest';
import {
  changedOnDisk,
  checksSaveConflicts,
  conflictMessage,
  promptsForConflict,
  EditStackMirror,
  OVERWRITE,
  REVERT,
} from '../src/host/diskConflict.js';

describe('changedOnDisk', () => {
  const read = { mtime: 1_700_000_000_000, size: 4096 };

  it('is false for the stamp the view recorded', () => {
    expect(changedOnDisk(read, { ...read })).toBe(false);
  });

  it('is true when the file was rewritten later with a different size: the case VS Code also refuses', () => {
    expect(changedOnDisk(read, { mtime: read.mtime + 2000, size: 4100 })).toBe(true);
  });

  it('is true when only the mtime moved: a same-size rewrite, which VS Code lets through', () => {
    expect(changedOnDisk(read, { mtime: read.mtime + 2000, size: read.size })).toBe(true);
  });

  it('is true when the mtime moved BACK: a restore that kept the archive’s date, which VS Code lets through', () => {
    expect(changedOnDisk(read, { mtime: read.mtime - 60_000, size: 4100 })).toBe(true);
    expect(changedOnDisk(read, { mtime: read.mtime - 60_000, size: read.size })).toBe(true);
  });

  it('is true when only the size moved', () => {
    expect(changedOnDisk(read, { mtime: read.mtime, size: 1 })).toBe(true);
  });

  it('is never a conflict when either side has no answer', () => {
    // The file is gone: VS Code keeps the editor and lets the save recreate the file.
    expect(changedOnDisk(read, undefined)).toBe(false);
    // The view never managed a stat: there is nothing to compare with.
    expect(changedOnDisk(undefined, read)).toBe(false);
    expect(changedOnDisk(undefined, undefined)).toBe(false);
  });
});

describe('checksSaveConflicts', () => {
  it('checks unless the setting is overwriteFileOnDisk, as VS Code’s preventSaveConflicts does', () => {
    expect(checksSaveConflicts('askUser')).toBe(true);
    expect(checksSaveConflicts(undefined)).toBe(true);
    expect(checksSaveConflicts('AskUser')).toBe(true);
    expect(checksSaveConflicts('overwriteFileOnDisk')).toBe(false);
  });
});

describe('conflictMessage', () => {
  it('is VS Code’s own no-Compare wording, with the file name in it', () => {
    expect(conflictMessage('params.sldd')).toBe(
      "Failed to save 'params.sldd': The content of the file is newer. Do you want to overwrite the file with your changes?",
    );
    expect([OVERWRITE, REVERT]).toEqual(['Overwrite', 'Revert']);
  });
});

describe('promptsForConflict', () => {
  it('asks the first time a save is refused, whatever auto-save is set to', () => {
    for (const autoSave of ['off', 'afterDelay', 'onFocusChange', 'onWindowChange', undefined]) {
      expect(promptsForConflict({ promptOpen: false, inConflict: false, autoSave }), String(autoSave)).toBe(true);
    }
  });

  it('never shows a second prompt while one is open', () => {
    for (const autoSave of ['off', 'afterDelay']) {
      for (const inConflict of [false, true]) {
        expect(promptsForConflict({ promptOpen: true, inConflict, autoSave })).toBe(false);
      }
    }
  });

  it('with auto-save off, asks again once the prompt was dismissed: every save is the user’s', () => {
    expect(promptsForConflict({ promptOpen: false, inConflict: true, autoSave: 'off' })).toBe(true);
    expect(promptsForConflict({ promptOpen: false, inConflict: true, autoSave: undefined })).toBe(true);
  });

  it('with auto-save on, does not ask again while the conflict stands, so auto-saves never repeat it', () => {
    for (const autoSave of ['afterDelay', 'onFocusChange', 'onWindowChange']) {
      expect(promptsForConflict({ promptOpen: false, inConflict: true, autoSave }), autoSave).toBe(false);
    }
  });
});

describe('EditStackMirror: VS Code’s dirty flag for a custom document', () => {
  it('starts clean, and dirty when restored from a hot-exit backup', () => {
    expect(new EditStackMirror().dirty).toBe(false);
    expect(new EditStackMirror(true).dirty).toBe(true);
  });

  it('an edit dirties; undoing it back to the save point cleans; redo dirties again', () => {
    const m = new EditStackMirror();
    m.pushed();
    expect(m.dirty).toBe(true);
    m.undone();
    expect(m.dirty).toBe(false);
    m.redone();
    expect(m.dirty).toBe(true);
  });

  it('a save moves the save point to where the stack is', () => {
    const m = new EditStackMirror();
    m.pushed();
    m.pushed();
    m.saved();
    expect(m.dirty).toBe(false);
    m.undone();
    expect(m.dirty, 'undo past the save point is unsaved').toBe(true);
    m.redone();
    expect(m.dirty, 'and redo back to it is saved again').toBe(false);
  });

  it('a save clears the backup’s dirtiness, and so does a revert', () => {
    const saved = new EditStackMirror(true);
    saved.saved();
    expect(saved.dirty).toBe(false);
    const reverted = new EditStackMirror(true);
    reverted.reverted();
    expect(reverted.dirty).toBe(false);
  });

  it('a revert is clean wherever the stack was, and the next undo is unsaved', () => {
    const m = new EditStackMirror();
    m.pushed();
    m.saved();
    m.pushed();
    m.pushed();
    m.reverted();
    expect(m.dirty).toBe(false);
    m.undone();
    expect(m.dirty).toBe(true);
  });

  it('an edit after undoing past the save point makes the save point unreachable', () => {
    // Save at 2, undo to 1, edit (2 again, but a different 2), edit (3). VS Code’s index
    // arithmetic would call the stack clean after one more undo, back at index 2. It is not:
    // that text was never saved.
    const m = new EditStackMirror();
    m.pushed();
    m.pushed();
    m.saved();
    m.undone();
    m.pushed();
    expect(m.dirty).toBe(true);
    m.pushed();
    m.undone();
    expect(m.dirty, 'same depth as the save, different text').toBe(true);
    m.undone();
    m.undone();
    expect(m.dirty, 'not even back at the start, which was never saved either').toBe(true);
    m.saved();
    expect(m.dirty, 'until the next save').toBe(false);
  });

  it('an edit that lands while a save is writing stays unsaved', () => {
    const m = new EditStackMirror();
    m.pushed();
    const at = m.here();
    m.pushed(); // arrives on the save's await
    m.saved(at);
    expect(m.dirty, 'the file has the first edit, not the second').toBe(true);
    m.undone();
    expect(m.dirty).toBe(false);
  });

  it('an edit after an undo that stayed at or above the save point keeps it reachable', () => {
    const m = new EditStackMirror();
    m.pushed();
    m.saved();
    m.pushed();
    m.undone();
    m.pushed();
    expect(m.dirty).toBe(true);
    m.undone();
    expect(m.dirty, 'the save point was not in the discarded tail').toBe(false);
  });
});
