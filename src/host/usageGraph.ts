// Copyright 2026 The MathWorks, Inc.
// The usage graphs behind the Usage column, one per file being viewed: view's `UsageGraphs`, over
// what only this host knows — the files open in its editor tabs, the folder `findFiles` lists, and
// the reads through the window's shared source cache (`UsageInputs`).
//
// Why a graph per VIEWED file rather than one for the folder, why it is kept until the folder
// changes, and why the synchronous path answers only from a graph that finished: all in view's
// usageGraphs.ts. The graph itself is core's (`buildUsageIndexFromSummaries`), its cells are
// view's usageCells.ts, and every navigation link target carries a FULL uriString (not a
// basename), so a click resolves to an exact file even when two same-named files exist.
//
// One instance for the window, beside the one source cache it reads through (sourceReads.ts):
// every editor provider fills its Usage column from it, and extension.ts and the repost watch
// (usageRepostWatch.ts) drop it when the folder changes.
import * as vscode from 'vscode';
import { isGraphPath, type SourceFile } from 'data-explorer-core';
import { UsageGraphs, type BlockLink, type ParamLink, type UsageGraph, type UsageInputs } from 'data-explorer-view/model';
import { GRAPH_GLOB } from '../common/fileTypes.js';
import { readerFor, sourceCache, sourceFilesOf } from './sourceReads.js';

export type { BlockLink, ParamLink } from 'data-explorer-view/model';

// Sorted, so the same tabs in a different order — a split, a drag, a tab going dirty —
// are the same inputs. Only the tabs the scan would actually read are in it (isGraphPath).
function tabKey(tabs: vscode.Uri[]): string {
  return tabs
    .map((u) => u.toString())
    .sort()
    .join('\n');
}

// Supported files currently open in an editor tab. Custom-editor and text tab
// inputs both expose `.uri`. Included in the candidates so a single file opened via
// Cmd+O (no workspace folder → findFiles returns nothing) still resolves its own
// intra-model usage (blocks referencing the model's own workspace variables).
function openTabUris(): vscode.Uri[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .map((t) => (t.input as { uri?: vscode.Uri } | undefined)?.uri)
    .filter((u): u is vscode.Uri => !!u && isGraphPath(u.path));
}

/**
 * What this window's usage graphs are built from: the workspace files plus the open tabs.
 *
 * The inputs are the TABS, and a graph is dropped when the tabs it was built from are not the
 * tabs open now — which `UsageGraphs` decides from `inputsKey`, rather than an event handler
 * guessing from a tab-change event: `onDidChangeTabs` fires for a tab going DIRTY as loudly as
 * for one opening, and invalidating on it threw the graph away after every edit, undo and redo,
 * to rebuild it byte for byte.
 */
function tabInputs(): UsageInputs {
  // The Uris of each candidate list, by the list `UsageGraphs` hands back to `readerFor`: a
  // build reads through the Uris it unioned, not ones rebuilt from their strings.
  const listed = new WeakMap<readonly SourceFile[], readonly vscode.Uri[]>();
  return {
    inputsKey: () => tabKey(openTabUris()),
    async candidates() {
      // ONE reading of the tabs, both recorded and built from: `UsageGraphs` asks `inputsKey`
      // and then this in the same task, and the tabs are read here before the first await, so
      // the list built from is the list the key describes.
      const tabs = openTabUris();
      let found: vscode.Uri[] = [];
      try {
        found = await vscode.workspace.findFiles(GRAPH_GLOB);
      } catch {
        /* no workspace folder open — fall back to open tabs only */
      }
      // Union workspace files with open tabs, deduped by uriString. The graph keys on full
      // uriStrings, so a file present in both sources contributes once. Order is `found` first:
      // it is folder order, which decides which of two same-named dictionaries a name resolves
      // to, and a tab must not change that by being open.
      const byUri = new Map<string, vscode.Uri>();
      for (const uri of [...found, ...tabs]) byUri.set(uri.toString(), uri);
      const uris = [...byUri.values()];
      const files = sourceFilesOf(uris);
      listed.set(files, uris);
      return files;
    },
    readerFor: (files) => readerFor(listed.get(files) ?? files.map((f) => vscode.Uri.parse(f.uriString))),
  };
}

/** The window's usage graphs. */
export const usageGraphs = new UsageGraphs({ inputs: tabInputs(), cache: sourceCache });

/**
 * Drop every cached graph; the next query rebuilds the ones it needs.
 *
 * Called when the FOLDER changes — a supported file created, deleted, or saved, or a
 * workspace folder added (see extension.ts). NOT on a keystroke: a graph is built from the
 * files on disk, so an unsaved edit cannot move an edge in it. Cheap, because the per-file
 * summaries in the source cache survive it (see `UsageGraphs.invalidate`).
 */
export function invalidateUsageGraph(): void {
  usageGraphs.invalidate();
}

/**
 * The graph that can answer for the file at `forUri`, building it if needed. Every query below
 * reaches this itself, so a caller only needs it to PREBUILD — which is what
 * `annotateDataRowsNow` requires, since it cannot await (see the integration suite).
 */
export function ensureUsageGraph(forUri: string): Promise<UsageGraph> {
  return usageGraphs.ensure(forUri);
}

// --- Queries ----------------------------------------------------------------

// Blocks that use variable `varName` living in the source at `sourceUri` (a
// .sldd/.mat file, or a model uri for that model's workspace vars).
export function blocksUsingVariable(sourceUri: string, varName: string): Promise<BlockLink[]> {
  return usageGraphs.blocksUsingVariable(sourceUri, varName);
}

// Resolved param links for a block (model view Usage cell). `blockKey` is the
// block's SID (its name only for a file written before SIDs existed), never the
// Name label — see `annotateModelRows`.
export function paramLinksForBlock(modelUri: string, blockKey: string): Promise<ParamLink[]> {
  return usageGraphs.paramLinksForBlock(modelUri, blockKey);
}

// --- Row annotation ---------------------------------------------------------
//
// The annotation policy is view's usageCells.ts; these are this window's graphs answering it.

// Data view (.sldd/.mat): set the Usage column on variable rows to the blocks
// that use them (links back to each block's model). `sourceUri` is the open
// file's uriString.
export function annotateDataRows(sourceUri: string, rows: any[]): Promise<boolean> {
  return usageGraphs.annotateDataRows(sourceUri, rows);
}

/**
 * The same annotation, without the await — or false if it cannot be done that way.
 *
 * For the one caller that cannot afford a promise: a repaint posted from a promise callback
 * cannot reach the webview until the extension host next yields, and the JSON table edit path
 * paints ~100 ms of span scan BEFORE its next yield (measured: 1 ms to the renderer against
 * 120 ms). See `UsageGraphs.annotateDataRowsNow`.
 */
export function annotateDataRowsNow(sourceUri: string, rows: any[]): boolean {
  return usageGraphs.annotateDataRowsNow(sourceUri, rows);
}

// Model view (.slx): rewrite block-row Usage cells with resolved param links
// (`Gain=Kp (dict.sldd)`), and set model-workspace variable rows' Usage to the
// blocks that use them. `modelUri` is the open model's uriString.
export function annotateModelRows(modelUri: string, rows: any[]): Promise<boolean> {
  return usageGraphs.annotateModelRows(modelUri, rows);
}
