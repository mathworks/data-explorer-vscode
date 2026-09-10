// Copyright 2026 The MathWorks, Inc.
// Workspace-wide block<->parameter usage graph. Correctly resolving "which
// source does a block's parameter come from" is inherently cross-file: a param
// name is looked up model-workspace -> linked .sldd(s) -> linked .mat(s), first
// found wins (a workspace var SHADOWS a same-named dictionary/MAT var). So a
// single file can't answer it; we parse each model plus the sources it links to
// and precompute every edge once.
//
// Built LAZILY on first query and cached; invalidated wholesale on any workspace
// file change (extension.ts wires the watcher). Both table directions read from
// it, so labels, links, and shadowing stay consistent everywhere.
//
// This module does the vscode file I/O and NOTHING else. The graph itself is core's
// (`buildUsageIndex`, tested there against real MATLAB-written files) and the cell
// shaping is usageCells.ts, whose `buildUsageGraph` takes the bytes read below. All
// navigation link targets carry FULL uriStrings (not basenames), so a click resolves
// to an exact file even when two same-named files exist.
import * as vscode from 'vscode';
import { toArrayBuffer } from '../common/bytes.js';
import { mapLimited, readForScan } from './scanRead.js';
import { GRAPH_GLOB, isGraphPath } from '../common/fileTypes.js';
import {
  annotateModelViewRows,
  annotateVariableRows,
  buildUsageGraph,
  type BlockLink,
  type ParamLink,
  type RawSource,
  type UsageGraph,
} from './usageCells.js';

export type { BlockLink, ParamLink } from './usageCells.js';

let graphPromise: Promise<UsageGraph> | null = null;
// The same graph, once it exists, reachable WITHOUT an await — see annotateDataRowsNow.
let graphNow: UsageGraph | null = null;
// The open tabs the cached graph was built from, as one comparable string.
let builtFrom: string | null = null;

// Drop the cached graph; the next query rebuilds it. Called when the FOLDER changes —
// a supported file created, deleted, or saved, or a workspace folder added (see
// extension.ts). NOT on a keystroke: the graph is built from the files on disk
// (readForScan), so an unsaved edit cannot move an edge in it, and rebuilding it over a
// folder of real dictionaries costs ~5.8 s.
export function invalidateUsageGraph(): void {
  graphPromise = null;
  graphNow = null;
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
 * Drop the graph if the tabs it read are not the tabs open now.
 *
 * The graph's inputs are the workspace files plus the open tabs, and it is the only thing
 * that knows which tabs those were — so it decides this, rather than an event handler
 * guessing from a tab-change event. `onDidChangeTabs` fires for a tab going DIRTY as
 * loudly as for one opening, and invalidating on it threw the graph away after every
 * edit, undo and redo, to rebuild it byte for byte.
 */
function dropIfTabsChanged(): void {
  if (graphPromise && builtFrom !== tabKey(openTabUris())) invalidateUsageGraph();
}

export function ensureUsageGraph(): Promise<UsageGraph> {
  dropIfTabsChanged();
  if (!graphPromise) {
    // ONE read of the tabs, both recorded and built from: a list captured separately from
    // the one the build unions is a list the next query can disagree with.
    const tabs = openTabUris();
    builtFrom = tabKey(tabs);
    graphPromise = buildGraph(tabs).then((g) => {
      graphNow = g;
      return g;
    });
  }
  return graphPromise;
}

async function readBytes(uri: vscode.Uri): Promise<ArrayBuffer | null> {
  const bytes = await readForScan(uri);
  return bytes ? toArrayBuffer(bytes) : null;
}

// Supported files currently open in an editor tab. Custom-editor and text tab
// inputs both expose `.uri`. Included in the graph so a single file opened via
// Cmd+O (no workspace folder → findFiles returns nothing) still resolves its own
// intra-model usage (blocks referencing the model's own workspace variables).
function openTabUris(): vscode.Uri[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .map((t) => (t.input as { uri?: vscode.Uri } | undefined)?.uri)
    .filter((u): u is vscode.Uri => !!u && isGraphPath(u.path));
}

async function buildGraph(tabs: vscode.Uri[]): Promise<UsageGraph> {
  let found: vscode.Uri[] = [];
  try {
    found = await vscode.workspace.findFiles(GRAPH_GLOB);
  } catch {
    /* no workspace folder open — fall back to open tabs only */
  }

  // Union workspace files with open tabs, deduped by uriString. The graph keys
  // on full uriStrings, so a file present in both sources contributes once.
  const byUri = new Map<string, vscode.Uri>();
  for (const uri of [...found, ...tabs]) byUri.set(uri.toString(), uri);
  const uris = [...byUri.values()];

  // Read the files a few at a time and hand the bytes to the pure builder. The
  // reads race within a batch, but the RESULT ARRAY keeps `uris` order — the blocks
  // in a Usage cell are listed in the order their models are summarised, and an
  // order that depended on which file's read finished first made the same cell
  // render differently between two opens of the same dictionary. See scanRead for
  // why a scan is read in bounded batches and skips oversized files.
  //
  // A file that cannot be READ (or is too large to scan) drops out here; one that
  // cannot be PARSED drops out inside core's summariser. Both contribute nothing
  // rather than failing the build.
  const files = (
    await mapLimited(uris, async (uri): Promise<RawSource | null> => {
      const bytes = await readBytes(uri);
      return bytes ? { uriString: uri.toString(), path: uri.path, bytes } : null;
    })
  ).filter((f): f is RawSource => f !== null);

  return buildUsageGraph(files);
}

// --- Queries ----------------------------------------------------------------

// Blocks that use variable `varName` living in the source at `sourceUri` (a
// .sldd/.mat file, or a model uri for that model's workspace vars).
export async function blocksUsingVariable(sourceUri: string, varName: string): Promise<BlockLink[]> {
  const g = await ensureUsageGraph();
  return g.blocksUsing(sourceUri, varName);
}

// Resolved param links for a block (model view Usage cell). `blockKey` is the
// block's SID (its name only for a file written before SIDs existed), never the
// Name label — see `annotateModelRows`.
export async function paramLinksForBlock(modelUri: string, blockKey: string): Promise<ParamLink[]> {
  const g = await ensureUsageGraph();
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
  return annotateVariableRows(sourceUri, rows, await ensureUsageGraph());
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
 */
export function annotateDataRowsNow(sourceUri: string, rows: any[]): boolean {
  dropIfTabsChanged();
  if (!graphNow) return false;
  annotateVariableRows(sourceUri, rows, graphNow);
  return true;
}

// Model view (.slx): rewrite block-row Usage cells with resolved param links
// (`Gain=Kp (dict.sldd)`), and set model-workspace variable rows' Usage to the
// blocks that use them. `modelUri` is the open model's uriString.
export async function annotateModelRows(modelUri: string, rows: any[]): Promise<boolean> {
  const g = await ensureUsageGraph();
  return annotateModelViewRows(modelUri, rows, g);
}
