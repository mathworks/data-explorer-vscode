// Copyright 2026 The MathWorks, Inc.
// The usage graph behind the Usage column, per file being viewed.
//
// Resolving "which source does a block's parameter come from" is inherently cross-file: a
// param name is looked up model-workspace -> linked .sldd(s) -> linked .mat(s), first found
// wins (a workspace var SHADOWS a same-named dictionary/MAT var). So a single file cannot
// answer it.
//
// It does not take the whole FOLDER to answer it either, and assuming it did was a
// performance bug: one graph was built over every supported file in the workspace, and
// `summarizeFiles` full-parses every model in what it is given. Opening a 27 KB dictionary
// beside one 13.8 MB model therefore cost 654 ms, and nothing survived the next
// invalidation, so it cost it again. Only a MODEL can originate a usage edge, and a model
// resolves through its own chain — so the files that can change one dictionary's answers are
// the models whose chain reaches it, plus those models' chains. usageScope.ts picks that set
// and usageSources.ts reads it, cheaply and once per version.
//
// So there is one graph per file being VIEWED rather than one for the window. The graphs
// differ in which files they were built over, never in what they say about a file: the scope
// is chosen to give the same answers the whole folder gives, which is what makes it safe and
// is pinned end to end in usageScopeEquality.test.ts.
//
// This module does the vscode-facing bookkeeping and NOTHING else. The reading and caching
// is usageSources.ts, the graph itself is core's (`buildUsageIndexFromSummaries`, tested
// there against real MATLAB-written files), and the cell shaping is usageCells.ts. All
// navigation link targets carry FULL uriStrings (not basenames), so a click resolves to an
// exact file even when two same-named files exist.
import * as vscode from 'vscode';
import { GRAPH_GLOB, isGraphPath } from '../common/fileTypes.js';
import { scopedSummaries } from './usageSources.js';
import {
  annotateModelViewRows,
  annotateVariableRows,
  buildUsageGraphFromSummaries,
  type BlockLink,
  type ParamLink,
  type UsageGraph,
} from './usageCells.js';

export type { BlockLink, ParamLink } from './usageCells.js';

// One graph per file queried, in flight...
const graphs = new Map<string, Promise<UsageGraph>>();
// ...and the same graphs once they exist, reachable WITHOUT an await — see
// annotateDataRowsNow. Two maps rather than one of pairs because that IS the distinction:
// a key in `graphs` alone means a build is running, and the synchronous path must not
// mistake one for an answer. Cleared together.
const ready = new Map<string, UsageGraph>();
// The open tabs the cached graphs were built from, as one comparable string.
let builtFrom: string | null = null;

/**
 * Drop every cached graph; the next query rebuilds the ones it needs.
 *
 * Called when the FOLDER changes — a supported file created, deleted, or saved, or a
 * workspace folder added (see extension.ts). NOT on a keystroke: a graph is built from the
 * files on disk, so an unsaved edit cannot move an edge in it.
 *
 * This is now much cheaper than the name suggests, and deliberately so. The per-file
 * summaries in usageSources.ts are keyed by content version and SURVIVE this, so a rebuild
 * re-stats the candidates, re-reads only the file that actually changed, and refills the
 * edge maps — it does not re-parse the folder. Which is what makes throwing all the graphs
 * away on any change the right trade instead of an incremental-merge problem.
 */
export function invalidateUsageGraph(): void {
  graphs.clear();
  ready.clear();
  builtFrom = null;
}

// Sorted, so the same tabs in a different order — a split, a drag, a tab going dirty —
// are the same inputs. Only the tabs the scan would actually read are in it (isGraphPath).
function tabKey(tabs: vscode.Uri[]): string {
  return tabs
    .map((u) => u.toString())
    .sort()
    .join('\n');
}

/**
 * Drop the graphs if the tabs they read are not the tabs open now.
 *
 * The graphs' inputs are the workspace files plus the open tabs, and this module is the only
 * thing that knows which tabs those were — so it decides this, rather than an event handler
 * guessing from a tab-change event. `onDidChangeTabs` fires for a tab going DIRTY as loudly
 * as for one opening, and invalidating on it threw the graph away after every edit, undo and
 * redo, to rebuild it byte for byte.
 *
 * ALL of them, because a tab that just opened is a file that may be in any other file's
 * scope. That is only worth doing because the summaries outlive it (see above): with a
 * folder open the union is usually a no-op anyway, since `findFiles` already returned those
 * files, and the rebuild is then a map refill over summaries already in hand.
 */
function dropIfTabsChanged(): void {
  if (graphs.size > 0 && builtFrom !== tabKey(openTabUris())) invalidateUsageGraph();
}

/**
 * The graph that can answer for the file at `forUri`, building it if needed.
 *
 * Keyed by that uri because the SCOPE is: a graph built for one dictionary read the models
 * that reach that dictionary, and is not entitled to answer for a file it therefore never
 * summarised.
 *
 * Every query below reaches this itself, so a caller only needs it to PREBUILD — which is
 * what `annotateDataRowsNow` requires, since it cannot await (see the integration suite).
 */
export function ensureUsageGraph(forUri: string): Promise<UsageGraph> {
  dropIfTabsChanged();
  const hit = graphs.get(forUri);
  if (hit) return hit;
  // ONE read of the tabs, both recorded and built from: a list captured separately from
  // the one the build unions is a list the next query can disagree with.
  const tabs = openTabUris();
  builtFrom = tabKey(tabs);
  const promise = buildGraph(forUri, tabs).then((g) => {
    // Only if this build is still the current one. An invalidation while it was running
    // cleared `graphs`, and a graph built from files that have since changed must not be
    // published into `ready`, where the synchronous path would answer from it.
    if (graphs.get(forUri) === promise) ready.set(forUri, g);
    return g;
  });
  graphs.set(forUri, promise);
  return promise;
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

async function buildGraph(forUri: string, tabs: vscode.Uri[]): Promise<UsageGraph> {
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

  // Everything expensive is in here: which of these files can affect `forUri`, reading only
  // those, and re-using what is unchanged. See usageSources.ts.
  return buildUsageGraphFromSummaries(await scopedSummaries(forUri, [...byUri.values()]));
}

// --- Queries ----------------------------------------------------------------

// Blocks that use variable `varName` living in the source at `sourceUri` (a
// .sldd/.mat file, or a model uri for that model's workspace vars).
export async function blocksUsingVariable(sourceUri: string, varName: string): Promise<BlockLink[]> {
  const g = await ensureUsageGraph(sourceUri);
  return g.blocksUsing(sourceUri, varName);
}

// Resolved param links for a block (model view Usage cell). `blockKey` is the
// block's SID (its name only for a file written before SIDs existed), never the
// Name label — see `annotateModelRows`.
export async function paramLinksForBlock(modelUri: string, blockKey: string): Promise<ParamLink[]> {
  const g = await ensureUsageGraph(modelUri);
  return g.paramLinks(modelUri, blockKey);
}

// --- Row annotation ---------------------------------------------------------
//
// Both directions below are thin awaits over the annotation policy in
// usageCells.ts, where it is unit-testable — this module imports `vscode`. Both
// reach the SAME `annotateVariableRows` for a variable row; see its comment for why
// the graph overwrites a cell a node already filled instead of yielding to it.

// Data view (.sldd/.mat): set the Usage column on variable rows to the blocks
// that use them (links back to each block's model). `sourceUri` is the open
// file's uriString.
export async function annotateDataRows(sourceUri: string, rows: any[]): Promise<boolean> {
  return annotateVariableRows(sourceUri, rows, await ensureUsageGraph(sourceUri));
}

/**
 * The same annotation, without the await — or false if it cannot be done that way.
 *
 * For the one caller that cannot afford a promise: a repaint posted from a promise callback
 * cannot reach the webview until the extension host next yields, and the JSON table edit path
 * paints ~100 ms of span scan BEFORE its next yield (measured: 1 ms to the renderer against
 * 120 ms). The await above is the only asynchronous thing about a repaint, and after the first
 * query there is nothing left for it to wait for — so this hands back the built graph, and
 * false while there is none, which is the caller's cue to take the slow path.
 *
 * The graph asked for is `sourceUri`'s own, never "whichever one is built": another tab's
 * graph was scoped to another file and may not have summarised the models that use this
 * one, so answering from it would silently empty cells that do have usages.
 */
export function annotateDataRowsNow(sourceUri: string, rows: any[]): boolean {
  dropIfTabsChanged();
  const graph = ready.get(sourceUri);
  if (!graph) return false;
  annotateVariableRows(sourceUri, rows, graph);
  return true;
}

// Model view (.slx): rewrite block-row Usage cells with resolved param links
// (`Gain=Kp (dict.sldd)`), and set model-workspace variable rows' Usage to the
// blocks that use them. `modelUri` is the open model's uriString.
export async function annotateModelRows(modelUri: string, rows: any[]): Promise<boolean> {
  const g = await ensureUsageGraph(modelUri);
  return annotateModelViewRows(modelUri, rows, g);
}
