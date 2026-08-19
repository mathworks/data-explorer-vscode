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
// This module does the vscode file I/O + parsing; the pure resolution/edge core
// lives in usageResolve.ts (unit-tested). All navigation link targets carry FULL
// uriStrings (not basenames), so a click resolves to an exact file even when two
// same-named files exist.
import * as vscode from 'vscode';
import { parseSlx } from '../dex/datamodel/parser/SlxParser.js';
import { parseMat } from '../dex/datamodel/parser/MatParser.js';
import { parseBinarySldd } from '../dex/datamodel/parser/BinarySlddParser.js';
import { isZipBytes } from './slddFormat.js';
import { toArrayBuffer } from '../common/bytes.js';
import {
  basename,
  buildEdges,
  type BlockRef,
  type DataSummary,
  type ModelSummary,
  type ParamLink,
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

function labelOf(uriPath: string): string {
  return basename(uriPath).replace(/\.slx$/i, '');
}

async function readBytes(uri: vscode.Uri): Promise<ArrayBuffer | null> {
  try {
    return toArrayBuffer(await vscode.workspace.fs.readFile(uri));
  } catch {
    return null;
  }
}

// Variable names + dictionary references from an .sldd (JSON or zip). Both share
// the same in-memory content shape (__MW_TEXT_PARTS__).
function slddSummary(uri: string, content: Record<string, unknown>): DataSummary {
  const parts = content.__MW_TEXT_PARTS__ as Record<string, unknown> | undefined;
  const chunk = parts?.['__MW_TEXT_PART__/data/chunk0'] as Record<string, unknown> | undefined;
  const inner = chunk?.__MW_TEXT_content as Record<string, unknown> | undefined;
  const varNames = new Set<string>();
  const dictRefs: string[] = [];
  if (inner) {
    for (const entry of (inner.entries as Record<string, unknown>[]) ?? []) {
      const name = entry?.name as string | undefined;
      if (name) varNames.add(name);
    }
    for (const ref of (inner['Dictionary References'] as unknown[]) ?? []) {
      const r = typeof ref === 'string' ? ref : (ref as Record<string, unknown>)?.file;
      if (typeof r === 'string') dictRefs.push(basename(r));
    }
  }
  return { uri, varNames, dictRefs };
}

const GRAPH_FILE_RE = /\.(slx|sldd|mat)$/i;

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
    found = await vscode.workspace.findFiles('**/*.{slx,sldd,mat}');
  } catch {
    /* no workspace folder open — fall back to open tabs only */
  }

  // Union workspace files with open tabs, deduped by uriString. The graph keys
  // on full uriStrings, so a file present in both sources contributes once.
  const byUri = new Map<string, vscode.Uri>();
  for (const uri of [...found, ...openTabUris()]) byUri.set(uri.toString(), uri);
  const uris = [...byUri.values()];

  const models: ModelSummary[] = [];
  // basename -> data summary (first match wins; ambiguous basenames are rare).
  const slddByBase = new Map<string, DataSummary>();
  const matByBase = new Map<string, DataSummary>();

  await Promise.all(
    uris.map(async (uri) => {
      const path = uri.path;
      const ab = await readBytes(uri);
      if (!ab) return;
      try {
        if (path.endsWith('.slx')) {
          const parsed = parseSlx(ab, basename(path));
          const externals = parsed.externalDataSources ?? [];
          const slddRefs = [
            ...(parsed.dataDictionary ? [basename(parsed.dataDictionary)] : []),
            ...externals.filter((e) => e.endsWith('.sldd')).map(basename),
          ];
          const matRefs = externals.filter((e) => e.endsWith('.mat')).map(basename);
          models.push({
            uri: uri.toString(),
            label: labelOf(path),
            wsNames: new Set((parsed.workspace ?? []).map((v) => v.name).filter(Boolean)),
            slddRefs,
            matRefs,
            blockParams: (parsed.blockParamUsages ?? []).map((u) => ({
              blockName: u.blockName,
              property: u.paramProperty,
              value: u.paramValue,
            })),
          });
        } else if (path.endsWith('.mat')) {
          const parsed = parseMat(ab);
          matByBase.set(basename(path), {
            uri: uri.toString(),
            varNames: new Set(parsed.variables.map((v) => v.name).filter(Boolean)),
            dictRefs: [],
          });
        } else if (path.endsWith('.sldd')) {
          const bytes = new Uint8Array(ab);
          const content = isZipBytes(bytes)
            ? (parseBinarySldd(ab) as Record<string, unknown>)
            : (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
          slddByBase.set(basename(path), slddSummary(uri.toString(), content));
        }
      } catch {
        /* unreadable/corrupt file contributes nothing */
      }
    }),
  );

  return buildEdges(models, slddByBase, matByBase);
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

// Shape reverse-edge block refs into the `blockLinks` Usage-cell payload (each
// link navigates back to the block in its owning model). Shared by both the
// data view and the model-workspace-variable path below.
function toBlockLinks(refs: BlockRef[]): { blockName: string; modelName: string; linkTarget: string }[] {
  return refs.map((r) => ({
    blockName: r.blockName,
    modelName: r.modelName,
    linkTarget: `blocks:${r.blockName}@${r.modelUri}`,
  }));
}

// Data view (.sldd/.mat): set the Usage column on variable rows to the blocks
// that use them (links back to each block's model). `sourceUri` is the open
// file's uriString. Rows that already carry a Usage value are left untouched.
export async function annotateDataRows(sourceUri: string, rows: any[]): Promise<boolean> {
  const g = await ensureUsageGraph();
  let changed = false;
  for (const row of rows) {
    if (row.UsedBy) continue;
    const name: string = row.Name?.label ?? '';
    const refs = g.reverse.get(`${sourceUri}\n${name}`);
    if (!refs || refs.length === 0) continue;
    row.UsedBy = { blockLinks: toBlockLinks(refs) };
    changed = true;
  }
  return changed;
}

// Model view (.slx): rewrite block-row Usage cells with resolved param links
// (`Gain=Kp (dict.sldd)`), and set model-workspace variable rows' Usage to the
// blocks that use them. `modelUri` is the open model's uriString.
export async function annotateModelRows(modelUri: string, rows: any[]): Promise<boolean> {
  const g = await ensureUsageGraph();
  let changed = false;
  for (const row of rows) {
    // Block rows carry a paramLinks-shaped Usage today (from the ModelBlockNode
    // remap in rowBuilder); replace it with the cross-file-resolved links.
    if (row._isBlockRow) {
      const links = g.forward.get(`${modelUri}\n${row.Name?.label ?? ''}`);
      row.UsedBy = links && links.length > 0 ? { paramLinks: links } : '';
      changed = true;
      continue;
    }
    // Model-workspace variable rows: blocks in THIS model that use them.
    if (!row.UsedBy) {
      const refs = g.reverse.get(`${modelUri}\n${row.Name?.label ?? ''}`);
      if (refs && refs.length > 0) {
        row.UsedBy = { blockLinks: toBlockLinks(refs) };
        changed = true;
      }
    }
  }
  return changed;
}
