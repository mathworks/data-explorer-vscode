// Copyright 2026 The MathWorks, Inc.
// The Usage column's vscode-free half: hand core's usage index the bytes this host
// read, and shape its answers into the cell payloads the webview renders.
//
// The GRAPH is not ours. It used to be — this file held the summarising, the
// workspace → sldd → mat shadowing, the transitive dictionary chase and the edge
// build — and none of that is a presentation concern: it is a property of the parsed
// data model, which is core's subject. A second front-end would have written it
// again, and the copy would have drifted the way every other copy in this pair of
// repos has (see fileTypes, identifiersIn, normalizeRefNames). So core owns it as of
// v1.6.0 (`buildUsageIndex`), tested there against real MATLAB-written files, and
// this host is one client of it.
//
// What remains here is genuinely the host's:
//
//   - a `RawSource` is what vscode could read, keyed by uriString — core is handed
//     bytes plus a filename and never learns what a vscode uri is;
//   - the LINK CHANNEL prefixes. Core emits `name@srcId`; `blocks:` and `workspace:`
//     are this extension's routing grammar (see navTarget.ts), and prefixing them is
//     the only place either string is spelled;
//   - the `(source)` display label on a param link, which is a rendering decision;
//   - and `annotateVariableRows`, which decides which of two engines settles a cell.
//
// usageGraph.ts adds the vscode file I/O in front of this and nothing else, so a
// test here drives the same path the extension runs.
import { buildUsageIndex, type NodeUsage, type ParamOrigin, type UsageIndex } from 'data-explorer-core';
import { uriBasename } from '../common/pathUtil.js';

// A file the graph is built from, already read. `path` decides how it is parsed
// (never the caller's say-so) and `uriString` is what every link target carries.
export interface RawSource {
  uriString: string;
  path: string;
  bytes: ArrayBuffer;
}

// A block that uses a variable, ready to render: the block, the model it lives in,
// and a target that navigates back to it.
//
// The model is part of the payload and not an embellishment: two models can hold
// blocks of the same name — `DragCalc(MainVehicle)` and `DragCalc(SubChassis)` both
// use SharedTypes' DragCoeff — so a bare block name is not a usable answer for a
// variable that models share, which is every variable a dictionary exists to hold.
//
// `modelUri` rides along for the webview to GROUP by, and is not the same fact as
// `modelName`: the name is a stripped basename, so two `engine` models in two folders
// share one — grouping on the name would merge their blocks under a single qualifier
// and claim usages in a model that has none. The uri is what identifies a model.
export interface BlockLink {
  blockName: string;
  modelName: string;
  modelUri: string;
  linkTarget: string;
}

// One parameter of a block, with where its value came from: `Gain=Kp (dict.sldd)`.
export interface ParamLink {
  property: string;
  paramName: string;
  source: string;
  linkTarget: string;
}

/**
 * The graph over the files this host read, as the two questions the table asks of it.
 *
 * Immutable, so there is no cache inside it to go stale: usageGraph.ts drops the whole
 * thing when a workspace file changes and builds another.
 */
export interface UsageGraph {
  /** Blocks that use `varName` in the source at `sourceUri` (a data file, or a model for its own workspace). */
  blocksUsing(sourceUri: string, varName: string): BlockLink[];
  /** Resolved parameter links for one block of the model at `modelUri`. */
  paramLinks(modelUri: string, blockName: string): ParamLink[];
}

/**
 * Build the graph from files a caller has already read.
 *
 * The srcId core answers with is our uriString, so every link target below carries a
 * FULL uri and a click resolves to an exact file even when two same-named files exist.
 * The filename is the PATH, because that is what core dispatches the kind on — and it
 * is the path rather than the uri because a uri can carry a `?query` that no extension
 * test should have to know about.
 */
export function buildUsageGraph(files: RawSource[]): UsageGraph {
  const index: UsageIndex = buildUsageIndex(
    files.map((f) => ({ srcId: f.uriString, filename: f.path, bytes: f.bytes })),
  );
  // Core names a usage's model by srcId; the CELL names it by model name. The lookup
  // is built once here rather than derived per link from the uri, because the name is
  // core's own reduction of the file name and re-deriving it is how the two come to
  // disagree about a `.mdl`.
  const modelNames = new Map(index.models.map((m) => [m.srcId, m.name]));
  return {
    blocksUsing: (sourceUri, varName) =>
      index.usagesOf(sourceUri, varName).map((u) => toBlockLink(u, modelNames)),
    paramLinks: (modelUri, blockName) => index.paramsOf(modelUri, blockName).map(toParamLink),
  };
}

// --- Shaping the cells -------------------------------------------------------

function toBlockLink(usage: NodeUsage, modelNames: Map<string, string>): BlockLink {
  return {
    blockName: usage.blockName,
    // A model in the graph always has a name; the fallback is for the answer that
    // cannot happen — a usage whose model core did not summarise — where a basename
    // is a better cell than `undefined`.
    modelName: modelNames.get(usage.modelSrcId) ?? uriBasename(usage.modelSrcId),
    modelUri: usage.modelSrcId,
    // `blocks:` on core's own `block@model` target, not a second spelling of it.
    linkTarget: `blocks:${usage.linkTarget}`,
  };
}

function toParamLink(origin: ParamOrigin): ParamLink {
  // A param resolved to the block's OWN model workspace needs no source suffix — the
  // value alone (e.g. `Gain=Kp`) is unambiguous in a model view. Only an EXTERNAL
  // source (linked .sldd/.mat) gets a `(basename)` qualifier, since that is where
  // disambiguation actually matters. An unresolved param is still distinguishable from
  // a workspace one, which also shows no source, by its EMPTY linkTarget.
  const workspace = origin.kind === 'workspace';
  return {
    property: origin.property,
    paramName: origin.expression,
    source: workspace || !origin.originSrcId ? '' : uriBasename(origin.originSrcId),
    linkTarget: workspace ? `workspace:${origin.linkTarget}` : origin.linkTarget,
  };
}

/**
 * Fill the Usage cell of every variable row this workspace graph has an answer for.
 * Shared by the data view (.sldd/.mat entries) and the model view's
 * model-workspace-variable rows, so one engine settles the column in both.
 *
 * OVERWRITES a cell that is already there, which is the whole point and was the bug:
 * a row arrives from `node.toRow()` carrying core's own `UsedBy`, and that answer comes
 * from core's SESSION — the models whose editor tab happened to be resolved in this
 * window — in a shape that names the block and not the model. So whether a dictionary
 * entry read `AFRConst, AFRCheck` or
 * `AFR(EngineCtrl), AFRMonitor(EngineCtrl), MixTarget(EngineCtrl), AFRConst(FuelInjector),
 * AFRCheck(FuelInjector)` depended on which models the user had opened — and merely
 * CLICKING a Usage link registered the model it pointed at, degrading the very cell it
 * was clicked from, permanently (model registrations are never withdrawn). Two engines
 * answering one column is the defect; this makes the workspace graph the one that does.
 *
 * A row the graph has nothing for is LEFT ALONE rather than emptied, so the session's
 * answer still stands for the one case the graph cannot see: a model opened from outside
 * the workspace and since closed, which leaves the session but is neither found on disk
 * nor an open tab. Absence here is not a claim that a variable is unused — the same rule
 * core's `_usedByCell` applies.
 */
export function annotateVariableRows(
  sourceUri: string,
  rows: { Name?: { label?: string }; UsedBy?: unknown }[],
  graph: UsageGraph,
): boolean {
  let changed = false;
  for (const row of rows) {
    const name = row?.Name?.label ?? '';
    if (!name) continue;
    const blockLinks = graph.blocksUsing(sourceUri, name);
    if (blockLinks.length === 0) continue;
    row.UsedBy = { blockLinks };
    changed = true;
  }
  return changed;
}
