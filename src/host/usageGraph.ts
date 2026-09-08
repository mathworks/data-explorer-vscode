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
// This module does the vscode file I/O and NOTHING else; every parse, summary and
// edge lives in usageResolve.ts (unit-tested), whose `buildUsageGraph` takes the
// bytes read below. All navigation link targets carry FULL uriStrings (not
// basenames), so a click resolves to an exact file even when two same-named files
// exist.
import * as vscode from 'vscode';
import { toArrayBuffer } from '../common/bytes.js';
import { GRAPH_FILE_RE, GRAPH_GLOB } from '../common/fileTypes.js';
import {
  annotateVariableRows,
  buildUsageGraph,
  type BlockRef,
  type ParamLink,
  type RawSource,
  type ResolvedGraph,
} from './usageResolve.js';

export type { BlockRef, ParamLink } from './usageResolve.js';

let graphPromise: Promise<ResolvedGraph> | null = null;

// Drop the cached graph; the next query rebuilds it. Called on any workspace
// file create/delete/change (see extension.ts).
export function invalidateUsageGraph(): void {
  graphPromise = null;
}

export function ensureUsageGraph(): Promise<ResolvedGraph> {
  if (!graphPromise) graphPromise = buildGraph();
  return graphPromise;
}

async function readBytes(uri: vscode.Uri): Promise<ArrayBuffer | null> {
  try {
    return toArrayBuffer(await vscode.workspace.fs.readFile(uri));
  } catch {
    return null;
  }
}

// Supported files currently open in an editor tab. Custom-editor and text tab
// inputs both expose `.uri`. Included in the graph so a single file opened via
// Cmd+O (no workspace folder → findFiles returns nothing) still resolves its own
// intra-model usage (blocks referencing the model's own workspace variables).
function openTabUris(): vscode.Uri[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .map((t) => (t.input as { uri?: vscode.Uri } | undefined)?.uri)
    .filter((u): u is vscode.Uri => !!u && GRAPH_FILE_RE.test(u.path));
}

async function buildGraph(): Promise<ResolvedGraph> {
  let found: vscode.Uri[] = [];
  try {
    found = await vscode.workspace.findFiles(GRAPH_GLOB);
  } catch {
    /* no workspace folder open — fall back to open tabs only */
  }

  // Union workspace files with open tabs, deduped by uriString. The graph keys
  // on full uriStrings, so a file present in both sources contributes once.
  const byUri = new Map<string, vscode.Uri>();
  for (const uri of [...found, ...openTabUris()]) byUri.set(uri.toString(), uri);
  const uris = [...byUri.values()];

  // Read every file concurrently, then hand the bytes to the pure builder. The
  // reads race, but the RESULT ARRAY keeps `uris` order — the blocks in a Usage
  // cell are listed in the order their models are summarised, and an order that
  // depended on which file's read finished first made the same cell render
  // differently between two opens of the same dictionary.
  //
  // A file that cannot be READ drops out here; one that cannot be PARSED drops out
  // inside summarizeSources. Both contribute nothing rather than failing the build.
  const files = (
    await Promise.all(
      uris.map(async (uri): Promise<RawSource | null> => {
        const bytes = await readBytes(uri);
        return bytes ? { uriString: uri.toString(), path: uri.path, bytes } : null;
      }),
    )
  ).filter((f): f is RawSource => f !== null);

  return buildUsageGraph(files);
}

// --- Queries ----------------------------------------------------------------

// Blocks that use variable `varName` living in the source at `sourceUri` (a
// .sldd/.mat file, or a model uri for that model's workspace vars).
export async function blocksUsingVariable(sourceUri: string, varName: string): Promise<BlockRef[]> {
  const g = await ensureUsageGraph();
  return g.reverse.get(`${sourceUri}\n${varName}`) ?? [];
}

// Resolved param links for a block (model view Usage cell).
export async function paramLinksForBlock(modelUri: string, blockName: string): Promise<ParamLink[]> {
  const g = await ensureUsageGraph();
  return g.forward.get(`${modelUri}\n${blockName}`) ?? [];
}

// --- Row annotation ---------------------------------------------------------
//
// Both directions below hand their variable rows to the SAME
// `annotateVariableRows` (in usageResolve.ts, where it is unit-testable — this
// module imports `vscode`). See its comment for why the graph overwrites a cell a
// node already filled instead of yielding to it.

// Data view (.sldd/.mat): set the Usage column on variable rows to the blocks
// that use them (links back to each block's model). `sourceUri` is the open
// file's uriString.
export async function annotateDataRows(sourceUri: string, rows: any[]): Promise<boolean> {
  const g = await ensureUsageGraph();
  return annotateVariableRows(sourceUri, rows, g.reverse);
}

// Model view (.slx): rewrite block-row Usage cells with resolved param links
// (`Gain=Kp (dict.sldd)`), and set model-workspace variable rows' Usage to the
// blocks that use them. `modelUri` is the open model's uriString.
export async function annotateModelRows(modelUri: string, rows: any[]): Promise<boolean> {
  const g = await ensureUsageGraph();
  let changed = false;
  const varRows: any[] = [];
  for (const row of rows) {
    // Block rows carry a paramLinks-shaped Usage today (from the ModelBlockNode
    // remap in rowBuilder); replace it with the cross-file-resolved links.
    if (row._isBlockRow) {
      const links = g.forward.get(`${modelUri}\n${row.Name?.label ?? ''}`);
      row.UsedBy = links && links.length > 0 ? { paramLinks: links } : '';
      changed = true;
      continue;
    }
    varRows.push(row);
  }
  // Model-workspace variable rows: blocks in THIS model that use them. Every one
  // names the model it is in, redundant as that reads in a model view — one shape
  // for a variable's usage everywhere beats a second one that differs only here.
  if (annotateVariableRows(modelUri, varRows, g.reverse)) changed = true;
  return changed;
}
