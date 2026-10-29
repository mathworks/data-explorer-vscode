// Copyright 2026 The MathWorks, Inc.
// What the workspace watcher does when a file's CONTENT changes: forget the shared source cache's
// entries for it if the write is one the version key cannot see, then drop the file's table model,
// re-index its names, and rebuild the tree.
//
// In a module of its own rather than inline in `activate`, so that the integration suite can attach
// this same handler to a real watcher. `activate` returns no API, so a test cannot reach the
// extension's own watcher (see test-integration/suite/forgetOnDiskChange.test.ts).
import * as vscode from 'vscode';
import { reindexFile } from './nameIndex.js';
import { invalidate } from 'data-explorer-view/host';
import { forgetUnseenChange } from './sourceReads.js';

/** Follow `watcher`'s change events; `refreshAll` rebuilds what is drawn from the folder. */
export function followContentChanges(watcher: vscode.FileSystemWatcher, refreshAll: () => void): vscode.Disposable {
  return watcher.onDidChange((uri) => void contentChanged(uri, refreshAll));
}

async function contentChanged(uri: vscode.Uri, refreshAll: () => void): Promise<void> {
  // The forget comes FIRST, before the re-index and the rebuild. Both read through the shared
  // cache, so either one started earlier would find the old entry, show it, and keep it: a forget
  // landing after them only stops their stores, and no further event comes to rebuild again.
  try {
    await forgetUnseenChange(uri);
  } catch {
    /* A failed check forgets nothing. The re-index and the rebuild below still run. */
  }
  invalidate(uri.toString());
  void reindexFile(uri);
  refreshAll();
}
