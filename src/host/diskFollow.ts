// Copyright 2026 The MathWorks, Inc.
//
// Following the file behind a writable byte-backed document, the way VS Code follows a text
// file it has open, for the two editors whose documents are not TextDocuments: the
// compressed-binary .sldd and the MAT-file. The rules are diskConflict.ts's, which is
// vscode-free and unit-tested; this is the vscode half both providers share, so that a MAT-file
// and a dictionary answer an outside write, and a save over one, the same way:
//
//   - no unsaved edits: reload from disk, silently;
//   - unsaved edits: nothing happens at the change, and the edits stay;
//   - save after an outside change: refused, with VS Code's prompt (Overwrite / Revert);
//   - the view's own saves are not outside changes;
//   - `files.saveConflictResolution: overwriteFileOnDisk` turns the check off.
//
// What each format reads off the disk, and how it replaces its document with it, stays in its
// provider: the two are handed in as `read` and `apply`.
import * as vscode from 'vscode';
import { basename } from '../common/pathUtil.js';
import { writeAndStamp } from './safeWrite.js';
import {
  changedOnDisk,
  checksSaveConflicts,
  conflictMessage,
  promptsForConflict,
  OVERWRITE,
  REVERT,
  type DiskStamp,
  type EditStackMirror,
} from './diskConflict.js';

/** The file's mtime+size as VS Code reports them, or `undefined` if it cannot be stat'd (gone). */
export async function stampOf(uri: vscode.Uri): Promise<DiskStamp | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return { mtime: stat.mtime, size: stat.size };
  } catch {
    return undefined;
  }
}

/**
 * Write the user's file, replaced whole where the file system lets us (safeWrite.ts), and answer
 * the stamp the write left, which a save records as the document's `stamp`. Every write either
 * byte-backed editor (the binary .sldd and the MAT-file) makes of the user's own file, a save and
 * a Save As, goes through here.
 */
export function writeUserFile(uri: vscode.Uri, bytes: Uint8Array): Promise<DiskStamp | undefined> {
  return writeAndStamp(uri, bytes, { write: () => vscode.workspace.fs.writeFile(uri, bytes), stat: () => stampOf(uri) });
}

/** What a document keeps to follow its file. Both writable byte-backed documents are one. */
export interface FollowedDocument {
  readonly uri: vscode.Uri;
  /** The file's name, as the conflict prompt quotes it. */
  readonly metaPath: string;
  /**
   * This document's copy of the dirty flag VS Code keeps, which the API gives no way to
   * read. The watcher uses it to choose between reloading and keeping unsaved edits.
   */
  readonly edits: EditStackMirror;
  /**
   * The file's mtime+size as this view last loaded, reverted to, or wrote it. A save compares
   * the disk with this, and the watcher ignores any event that leaves the disk matching it.
   * That is how the view's own saves are kept from counting as outside changes.
   */
  stamp: DiskStamp | undefined;
  /**
   * A save was refused because the file changed on disk, and nothing has resolved that yet.
   * This mirrors VS Code's conflict state for a text file: a later save, auto-save included,
   * does not ask again unless `promptsForConflict` says so. Cleared by a save that writes
   * and by a revert.
   */
  inConflict: boolean;
  /** The Overwrite / Revert prompt is showing. */
  conflictPromptOpen: boolean;
  /**
   * The outside version the user answered Overwrite for. A save writes over that version
   * without asking. A later outside change has a different stamp, so it is asked about
   * again. Cleared by any save that writes and by a revert.
   */
  overwriteStamp: DiskStamp | undefined;
  /** A save is in flight. The watcher waits, so it never reloads in the middle of one. */
  saving: boolean;
  disposed: boolean;
}

/**
 * How long the watcher waits for a burst of events to stop. One outside save can raise
 * several (write a temporary file and rename it over, or truncate and then write), and each
 * reload re-parses the whole file.
 */
const DISK_EVENT_SETTLE_MS = 100;

/**
 * Follow the file on disk. One watcher per DOCUMENT, not per view, because what it changes is
 * the document.
 *
 * The pattern is the read-only view's (BinaryEditorProvider): the file's own name in its own
 * directory. That also works for a file outside every workspace folder, which a
 * workspace-wide watcher would not see. `onDidCreate` as well as `onDidChange`, because a
 * writer that saves through a temporary file and renames it over this one shows up as a
 * create. `onDidDelete` is left out on purpose: VS Code keeps a text editor open on a deleted
 * file, with its contents, and a save recreates the file.
 *
 * `follow` is the provider's `followDisk` with its format's read and apply; it is not called
 * while a save or another follow is running.
 */
export function watchDisk(document: FollowedDocument, follow: () => Promise<void>): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), basename(document.uri.path)),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let following = false;
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void settled(), DISK_EVENT_SETTLE_MS);
  };
  const settled = async () => {
    timer = undefined;
    // A save in flight is about to record the stamp of its own write. Reading the disk
    // before then would take the view's own write for an outside one, so wait it out.
    // The same goes for a reload that is still running.
    if (document.saving || following) return schedule();
    following = true;
    try {
      await follow();
    } catch {
      // Nothing that failed here changed the document. The stamp has not moved either, so
      // if the disk really did change, the next save asks.
    } finally {
      following = false;
    }
  };
  const subs = [watcher, watcher.onDidChange(schedule), watcher.onDidCreate(schedule)];
  return {
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const s of subs) s.dispose();
    },
  };
}

/**
 * An event said the file may have changed. Do what VS Code does for a text file.
 *
 *  - The disk still matches the stamp: nothing changed. This is also how the view's own
 *    save is ignored: it recorded the stamp of what it wrote. A file that is gone is
 *    treated the same way (see `changedOnDisk`).
 *  - Changed, unsaved edits: nothing. The edits stay, and the next save asks.
 *  - Changed, no unsaved edits: reload, silently, through `apply`, which a revert uses too.
 *
 * Dirtiness is checked again after the read, because an edit can land while the file is
 * being read. Reloading over it would discard an edit VS Code already counts as unsaved.
 */
export async function followDisk<R>(
  document: FollowedDocument,
  read: () => Promise<R>,
  apply: (read: R) => void,
): Promise<void> {
  if (document.disposed) return;
  if (!changedOnDisk(document.stamp, await stampOf(document.uri))) return;
  if (document.edits.dirty) return;
  const got = await read();
  if (document.disposed || document.saving || document.edits.dirty) return;
  apply(got);
}

/**
 * The disk check a save makes before it writes, run between the serialization and the write.
 *
 * If the file's mtime+size are no longer the ones this view last loaded, reverted to or
 * wrote, the save fails, as VS Code's does for a text file. The rejection is a
 * CancellationError on purpose. VS Code's save command shows its own "Failed to save" for
 * any other error, with Retry and Revert, and Retry would only fail again. It shows nothing
 * for a cancellation. The prompt shown instead is VS Code's own wording, with VS Code's two
 * answers. VS Code keeps the document dirty, so the edits stay.
 *
 * No check when `files.saveConflictResolution` is `overwriteFileOnDisk`, read for this
 * file as VS Code reads it. No check either when the user has already answered Overwrite
 * for exactly this version of the outside file.
 *
 * `viewType` is the editor this document is open in, for the Revert answer; `ask` shows the
 * prompt and resolves with the button chosen (a provider's property, so that the integration
 * suite, which cannot click a notification, can answer for the user).
 */
export async function refuseIfChangedOnDisk(
  document: FollowedDocument,
  viewType: string,
  ask: (message: string) => Thenable<string | undefined>,
): Promise<void> {
  const files = vscode.workspace.getConfiguration('files', document.uri);
  if (!checksSaveConflicts(files.get('saveConflictResolution'))) return;
  const now = await stampOf(document.uri);
  if (!changedOnDisk(document.stamp, now)) return;
  if (document.overwriteStamp && !changedOnDisk(document.overwriteStamp, now)) return;
  const prompt = promptsForConflict({
    promptOpen: document.conflictPromptOpen,
    inConflict: document.inConflict,
    autoSave: files.get('autoSave'),
  });
  document.inConflict = true;
  if (prompt) void askAboutConflict(document, now, viewType, ask);
  throw new vscode.CancellationError();
}

/**
 * Show the prompt, and carry out the answer.
 *
 *  - Overwrite: save again, through VS Code (`workspace.save`), so that VS Code clears the
 *    dirty flag. The save writes without asking because the user has accepted overwriting
 *    `seen`, the version they were asked about. If the file has changed again since then,
 *    the save asks about the new version.
 *  - Revert: VS Code's own revert, which discards the edits from VS Code's stack and marks
 *    the document clean, then calls the provider's `revertCustomDocument` to reload. Calling
 *    that method directly would reload the content and leave VS Code showing the document as
 *    dirty.
 *  - Dismissed: nothing. The conflict stands until a save or a revert resolves it.
 *
 * An answer that arrives after the conflict was already resolved some other way (a revert
 * from the menu, or a reload) is ignored.
 */
async function askAboutConflict(
  document: FollowedDocument,
  seen: DiskStamp | undefined,
  viewType: string,
  ask: (message: string) => Thenable<string | undefined>,
): Promise<void> {
  document.conflictPromptOpen = true;
  let answer: string | undefined;
  try {
    answer = await ask(conflictMessage(document.metaPath));
  } finally {
    document.conflictPromptOpen = false;
  }
  if (document.disposed || !document.inConflict) return;
  if (answer === OVERWRITE) {
    document.overwriteStamp = seen;
    await vscode.workspace.save(document.uri);
  } else if (answer === REVERT) {
    await revertInVsCode(document, viewType);
  }
}

/**
 * Run VS Code's revert on this document. `workbench.action.files.revert` reverts the
 * active editor and takes no resource, so this document's tab is made active first, in
 * the group it is already in. Without that, `openWith` would open a second tab in the
 * active group. VS Code's revert covers the whole document whichever of its tabs is
 * active.
 */
async function revertInVsCode(document: FollowedDocument, viewType: string): Promise<void> {
  const uri = document.uri.toString();
  for (const group of vscode.window.tabGroups.all) {
    const tab = group.tabs.find(
      (t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === viewType && t.input.uri.toString() === uri,
    );
    if (!tab) continue;
    await vscode.commands.executeCommand('vscode.openWith', document.uri, viewType, {
      viewColumn: group.viewColumn,
      preserveFocus: false,
      preview: tab.isPreview,
    });
    await vscode.commands.executeCommand('workbench.action.files.revert');
    return;
  }
}
