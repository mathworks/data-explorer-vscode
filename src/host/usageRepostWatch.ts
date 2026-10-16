// Copyright 2026 The MathWorks, Inc.
// The vscode half of usageRepost.ts: the watcher that tells the repost bus a model was created or
// deleted, and the subscription a data tab takes out on it.
//
// The watcher lives here, beside the bus, rather than in extension.ts beside the one that keeps
// the tree in sync. Two reasons. It exists only while a tab that fills a data file's Usage column
// is open — created by the first subscription and disposed with the last, together with any
// repost still pending — so a window with no such tab pays nothing for it. And everything from
// the disk event to the repost is then one module's, so the integration suite (which bundles its
// own copy of each src module, and so cannot see the running extension's state) drives the real
// path end to end: test-integration/suite/usageRepostOnModelCreate.test.ts.
//
// Create and delete only. A model CHANGED on disk can move a usage edge too (MATLAB saving it with
// a new dictionary link, or a block reading a different variable), and does not repost an open
// data tab yet.
import * as vscode from 'vscode';
import { SUPPORTED_GLOB } from '../common/fileTypes.js';
import { invalidateUsageGraph } from './usageGraph.js';
import { createUsageRepostBus, repostsUsageOn, type UsageRepostBus } from './usageRepost.js';

let live: { bus: UsageRepostBus; watcher: vscode.Disposable; tabs: number } | null = null;

function start(): { bus: UsageRepostBus; watcher: vscode.Disposable; tabs: number } {
  const bus = createUsageRepostBus();
  // The same glob as extension.ts's watcher, so the two see the same events, then narrowed to
  // the ones that can change a Usage cell.
  const watcher = vscode.workspace.createFileSystemWatcher(SUPPORTED_GLOB);
  const onModelSetChange = (uri: vscode.Uri): void => {
    if (!repostsUsageOn(uri.path)) return;
    // Dropped here as well as by extension.ts's refreshAll, so that what the repost reads does
    // not depend on another watcher's listener having run first. Cheap: the per-file summaries
    // survive it (see invalidateUsageGraph).
    invalidateUsageGraph();
    bus.schedule();
  };
  const created = watcher.onDidCreate(onModelSetChange);
  const deleted = watcher.onDidDelete(onModelSetChange);
  return {
    bus,
    watcher: vscode.Disposable.from(created, deleted, watcher),
    tabs: 0,
  };
}

/**
 * Call `repost` when a model is created or deleted in the workspace, once per burst.
 *
 * For a tab that fills a DATA file's Usage column — a dictionary or a `.mat`. A model's own tab
 * does not need it: its Usage is its own blocks and its own workspace, which no other model can
 * change (usageScope.ts). `busy`, when given, defers the repost while it answers true; see
 * usageRepost.ts.
 *
 * Dispose it with the tab.
 */
export function subscribeUsageRepost(repost: () => void, busy?: () => boolean): vscode.Disposable {
  if (!live) live = start();
  const owner = live;
  owner.tabs++;
  const sub = owner.bus.subscribe(repost, busy);
  let disposed = false;
  return new vscode.Disposable(() => {
    if (disposed) return;
    disposed = true;
    sub.dispose();
    owner.tabs--;
    if (owner.tabs === 0 && live === owner) {
      owner.bus.dispose();
      owner.watcher.dispose();
      live = null;
    }
  });
}
