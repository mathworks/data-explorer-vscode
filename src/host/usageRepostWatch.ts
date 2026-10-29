// Copyright 2026 The MathWorks, Inc.
// The vscode half of the Usage repost: the watcher that tells view's repost hub a model was created
// or deleted, and the subscription a data tab takes out on it.
//
// The bus (one repost per tab per burst of model changes, 300 ms trailing, a busy tab waited for)
// and its lifecycle (the watch created by the first subscription and disposed with the last,
// together with any repost still pending, so a window with no such tab pays nothing for it) are
// view's `createUsageRepostHub`. What is VS Code's is the watch: a `FileSystemWatcher` on the
// supported files, whose creates and deletes the hub narrows to models.
//
// The watcher lives here rather than in extension.ts beside the one that keeps the tree in sync,
// so everything from the disk event to the repost is one module's, and the integration suite
// (which bundles its own copy of each src module, and so cannot see the running extension's
// state) drives the real path end to end: test-integration/suite/usageRepostOnModelCreate.test.ts.
//
// Create and delete only. A model CHANGED on disk can move a usage edge too (MATLAB saving it with
// a new dictionary link, or a block reading a different variable), and does not repost an open
// data tab yet.
import * as vscode from 'vscode';
import { createUsageRepostHub, type WatchModelSet } from 'data-explorer-view/model';
import { SUPPORTED_GLOB } from '../common/fileTypes.js';
import { usageGraphs } from './usageGraph.js';

// The same glob as extension.ts's watcher, so the two see the same events; the hub keeps the
// ones that can change a Usage cell.
const watchModelSet: WatchModelSet = (changed) => {
  const watcher = vscode.workspace.createFileSystemWatcher(SUPPORTED_GLOB);
  const onCreateOrDelete = (uri: vscode.Uri): void => changed(uri.path);
  return vscode.Disposable.from(watcher.onDidCreate(onCreateOrDelete), watcher.onDidDelete(onCreateOrDelete), watcher);
};

// The window's hub. A change drops the window's usage graphs before the reposts read them — here
// as well as in extension.ts's refreshAll, so that what a repost reads does not depend on another
// watcher's listener having run first.
const hub = createUsageRepostHub({ watch: watchModelSet, graphs: usageGraphs });

/**
 * Call `repost` when a model is created or deleted in the workspace, once per burst.
 *
 * For a tab that fills a DATA file's Usage column — a dictionary or a `.mat`. A model's own tab
 * does not need it: its Usage is its own blocks and its own workspace, which no other model can
 * change (core's `usageScope`). `busy`, when given, defers the repost while it answers true; see
 * view's usageRepost.ts.
 *
 * Dispose it with the tab.
 */
export function subscribeUsageRepost(repost: () => void, busy?: () => boolean): vscode.Disposable {
  const sub = hub.subscribe(repost, busy);
  return new vscode.Disposable(() => sub.dispose());
}
