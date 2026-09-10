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
//   - the `(source)` label on a param link and the `(model)` qualifier on a block link:
//     WHICH of them a cell has earned is a rendering decision, not a fact about the graph;
//   - and `annotateVariableRows`, which decides which of two engines settles a cell.
//
// usageGraph.ts adds the vscode file I/O in front of this and nothing else, so a
// test here drives the same path the extension runs.
import { blockLabel, buildUsageIndex, type NodeUsage, type ParamOrigin, type UsageIndex } from 'data-explorer-core';
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
//
// Which is also why `modelName` can be BLANK on a link the graph answered fully: the cell
// drops the qualifier when it names the very file being viewed (see `withoutOwnModel`).
// The uri still identifies the model, so nothing downstream loses the ability to group,
// target or navigate — only the printed `(model)` goes.
//
// `blockName` is a LABEL and not an identity: core substitutes `<SID: 65>` for a block
// Simulink recorded without a name, and two blocks in different subsystems can print
// the same text. What identifies the block is inside `linkTarget` (its SID).
//
// Which is why `blockPath` is here too. A dictionary entry read by four blocks named
// `Gain` gives a cell reading `Gain, Gain, Gain, Gain` — four separate, correct links
// that a user cannot choose between. The path (`Controller/Gain`) is what tells them
// apart, and the cell shows it as each link's tooltip rather than inline, because
// spelling four paths out is a column nobody can read.
export interface BlockLink {
  blockName: string;
  blockPath: string;
  modelName: string;
  modelUri: string;
  linkTarget: string;
}

// One parameter of a block, with where its value came from: `Gain=Kp (dict.sldd)`.
//
// `source` is that place as a reader should see it, which is not one kind of string: a
// linked file is its basename, a mask parameter is the masked BLOCK it belongs to, and
// the block's own model workspace is BLANK — the one scope a model view already names.
// Which of the three a cell has is not recoverable from here, and does not need to be;
// `linkTarget` carries the channel that navigates to it. See `toParamLink`.
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
  /**
   * Resolved parameter links for one block of the model at `modelUri`, keyed by the
   * block's KEY — its SID, falling back to its name only for a file written before
   * SIDs existed. Not the Name label: a label is unique only within one system, and
   * a nameless block's label is the synthetic `<SID: 65>`.
   */
  paramLinks(modelUri: string, blockKey: string): ParamLink[];
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
    paramLinks: (modelUri, blockKey) => index.paramsOf(modelUri, blockKey).map(toParamLink),
  };
}

// --- Shaping the cells -------------------------------------------------------

function toBlockLink(usage: NodeUsage, modelNames: Map<string, string>): BlockLink {
  return {
    blockName: usage.blockName,
    // Core's own join of the block's label onto its enclosing systems (`NodeUsage
    // .blockPath`), not a second spelling of it: the same string the model view's rows
    // carry, so one block reads the same wherever it is named.
    blockPath: usage.blockPath,
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
  // A mask parameter is the one origin that is not a file: `Gain = g1` inside a masked
  // subsystem reads that subsystem's own `g1`, which lives in the model the block is
  // already in. So the two fields both mean something else here.
  //
  // The SOURCE names the masked BLOCK (`Gain=g1 (MulAdd)`) rather than a basename,
  // because a basename would be the open model's own name — the qualifier every other
  // arm below deliberately drops as noise — while the block is the thing a reader
  // cannot otherwise see. It earns a qualifier for the same reason a `.sldd` does: the
  // value came from somewhere other than the one implicit scope.
  //
  // The TARGET is the `blocks:` channel, because core answers a mask origin with the
  // masked block's KEY and not a name (see ParamOrigin.linkTarget). Which is also the
  // more useful click: there is no row anywhere named `g1`, and the row the target does
  // reach — MulAdd's — is the one whose own cell reads `g1=g1_param`. Two hops, the
  // shape MATLAB gives the same chain.
  if (origin.kind === 'mask' && origin.maskBlock) {
    return {
      property: origin.property,
      paramName: origin.expression,
      // The block's LABEL, through core's own rule, so a masked block Simulink recorded
      // with no name reads `<SID: 65>` here exactly as it does in its own row.
      source: blockLabel(origin.maskBlock.blockName, origin.maskBlock.sid),
      linkTarget: `blocks:${origin.linkTarget}`,
    };
  }
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
    row.UsedBy = { blockLinks: blockLinks.map((link) => withoutOwnModel(link, sourceUri)) };
    changed = true;
  }
  return changed;
}

/**
 * Drop the `(model)` qualifier from a usage inside the file the row itself belongs to.
 *
 * The qualifier is there because a variable can be SHARED: `DragCalc(MainVehicle)` and
 * `DragCalc(SubChassis)` are two different blocks and the model is the only thing that
 * separates them. A MODEL-WORKSPACE variable is shared with nobody — every block that can
 * read it is in the model whose workspace holds it — so in a model view the qualifier
 * repeated the name of the open file on every link and disambiguated nothing.
 *
 * Which is the rule `toParamLink` already applies to the same edge read the other way: a
 * param resolved to the block's own model workspace reads `Gain=Kp`, not
 * `Gain=Kp (shadow_ws)`. Now neither direction qualifies what the view already says.
 *
 * Blanked in the PAYLOAD rather than skipped while rendering, because the Usage column's
 * text — what sorting, copying and the filter bar see — is built from `modelName` too
 * (`_getCellText`). Hiding it in the template alone is how a cell comes to read `WsGain`
 * and copy as `WsGain(shadow_ws)`.
 *
 * Keyed on the uri and not on "is this a model view", so it is inert where it should be: a
 * data file's uri is never a model's, so a .sldd/.mat row keeps the qualifier on every
 * link, and a usage from any OTHER model keeps it even in a model view.
 */
function withoutOwnModel(link: BlockLink, sourceUri: string): BlockLink {
  return link.modelUri === sourceUri ? { ...link, modelName: '' } : link;
}

/**
 * Fill the Usage column of a MODEL view's rows: block rows take their resolved parameter
 * links (`Gain=Kp (dict.sldd)`), and the model-workspace variable rows go through
 * `annotateVariableRows` above, so a variable's usage reads the same everywhere — bar the
 * `(model)` qualifier, which a usage inside the open model has no work for.
 *
 * Lives here rather than in usageGraph.ts for the same reason `annotateVariableRows`
 * does: that module imports `vscode` and this is a policy worth testing over real bytes.
 * usageGraph.ts only awaits the graph and calls this.
 *
 * A block row is joined by its `_blockKey` — the block's SID, which core's
 * `ModelBlockNode.toRow` publishes for exactly this purpose — and NEVER by the Name
 * label. A label is unique only inside one system, so two `Gain` blocks in different
 * subsystems would take each other's parameters; and a block Simulink recorded with no
 * name at all (f14.slx's SID 65, whose `Name` attribute is a lone line break) has the
 * synthetic label `<SID: 65>`, which matches no block in core's index and left the cell
 * empty. Unlike a variable row, a block row IS emptied when the graph has nothing for
 * it: the row came from this same model's parse, so the graph has seen the block, and
 * "no parameters resolved" is an answer about it rather than a gap in what was read.
 */
export function annotateModelViewRows(
  modelUri: string,
  rows: { Name?: { label?: string }; UsedBy?: unknown; _isBlockRow?: boolean; _blockKey?: string }[],
  graph: UsageGraph,
): boolean {
  let changed = false;
  const varRows: typeof rows = [];
  for (const row of rows) {
    // Block rows carry a paramLinks-shaped Usage today (from the ModelBlockNode remap in
    // rowBuilder); replace it with the cross-file-resolved links.
    if (row._isBlockRow) {
      const links = graph.paramLinks(modelUri, row._blockKey ?? '');
      row.UsedBy = links.length > 0 ? { paramLinks: links } : '';
      changed = true;
      continue;
    }
    varRows.push(row);
  }
  // Model-workspace variable rows: blocks in THIS model that use them, which is every
  // block that could. Same call as the data view — one engine settles the column in both —
  // and the `(model)` qualifier falls off there rather than here, because the reason it
  // falls off is the uri and not the caller (see `withoutOwnModel`).
  if (annotateVariableRows(modelUri, varRows, graph)) changed = true;
  return changed;
}
