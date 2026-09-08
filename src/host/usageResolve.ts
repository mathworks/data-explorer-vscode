// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) core of the usage graph: file summarising, parameter-source
// resolution, and edge construction. Split from usageGraph.ts — which is now only
// the vscode file I/O (findFiles, open tabs, readFile) — so the shadowing rule,
// the workspace->sldd->mat ordering, and the whole bytes->cell path are
// unit-testable. `buildUsageGraph` below is the entire graph build over bytes a
// caller already holds, so a test drives the SAME function the extension runs
// rather than a re-creation of it in the test.
import { identifiersIn, parseMat, parseModel, type ParsedMat, type ParsedSlx } from 'data-explorer-core';
import { basename, uriBasename } from '../common/pathUtil.js';
import { isModelPath, stripModelExt } from '../common/fileTypes.js';
import { normalizeRefNames, refBasename } from './slddRefs.js';
import { readSlddContent } from './slddContent.js';

export { basename } from '../common/pathUtil.js';

export type SourceKind = 'workspace' | 'sldd' | 'mat';

export interface ModelSummary {
  uri: string;
  label: string;
  wsNames: Set<string>;
  slddRefs: string[]; // ordered basenames: dataDictionary first, then external .sldd
  matRefs: string[]; // ordered basenames of linked .mat
  blockParams: { blockName: string; property: string; value: string }[];
}

export interface DataSummary {
  uri: string;
  varNames: Set<string>;
  dictRefs: string[]; // basenames of referenced dictionaries (.sldd chaining)
}

// A file the graph is built from, already read. `path` decides how it is parsed
// (never the caller's say-so) and `uriString` is what every link target carries.
export interface RawSource {
  uriString: string;
  path: string;
  bytes: ArrayBuffer;
}

export interface SourceSummaries {
  models: ModelSummary[];
  // Both maps are keyed by refBasename (basename LOWER-CASED), because the keys are
  // FILENAMES and the lookups are references authored inside a model — MATLAB records
  // those as the user typed them, so `Params.sldd` in a model legitimately refers to
  // `params.sldd` on disk. The sections tree already resolves refs this way
  // (RelGraph.byBasename); matching case-sensitively here made the SAME reference
  // resolve in the tree and silently not in the Usage column, leaving parameters that
  // are plainly used looking unused. Every key and every lookup must go through
  // refBasename or the map half-matches.
  slddByBase: Map<string, DataSummary>;
  matByBase: Map<string, DataSummary>;
}

export interface BlockRef {
  blockName: string;
  modelName: string;
  modelUri: string;
}

export interface BlockLink {
  blockName: string;
  modelName: string;
  modelUri: string;
  linkTarget: string;
}

export interface ParamLink {
  property: string;
  paramName: string;
  source: string;
  linkTarget: string;
}

export interface ResolvedGraph {
  // `${sourceUri}\n${varName}` -> blocks using it (keyed by WINNING source).
  reverse: Map<string, BlockRef[]>;
  // `${modelUri}\n${blockName}` -> resolved param links for that block.
  forward: Map<string, ParamLink[]>;
}

// Which names a param expression refers to, so `2*Kp` yields ['Kp'].
//
// The RULE is core's; only the SCOPE below is ours. Core answers "which blocks use this
// definition" within a session — the sources a host registered — while this module
// answers it across a whole workspace of files on disk, with MATLAB's
// workspace → sldd → mat shadowing and transitive dictionary references, which core
// deliberately does not model. Two resolvers, one reading of an expression.
//
// This file used to restate the regex, and the copy had drifted: it credited `mode` in
// `cfg.mode` and `e5` in `1e5`, so a dictionary entry named `mode` collected a usage
// that does not exist and a `1e5` parameter offered a link to `e5`. Core skips a token
// preceded by `.` or a digit, and publishes the function for exactly this caller as of
// v1.4.0 — so the re-export is the seam: the host names the rule in one place and
// nowhere decides it.
export { identifiersIn } from 'data-explorer-core';

// --- Summarising the files ---------------------------------------------------

// The bare model name MATLAB uses internally, whichever container the file is in
// — a `.mdl` left labelled `engine.mdl` would not match the `engine` that block
// paths and reference records name.
export function modelLabel(path: string): string {
  return stripModelExt(basename(path));
}

// What the graph needs from a parsed model: its own workspace names, the sources it
// links to (dictionary first, then externals split by extension), and every block
// parameter whose value is an expression.
//
// The extension filters are case-INSENSITIVE because these strings are whatever the
// model recorded: `EXTRADICT.SLDD` is a real dictionary link, and an `endsWith`
// test classified it as neither .sldd nor .mat, dropping the link entirely.
export function modelSummary(parsed: ParsedSlx, uriString: string, path: string): ModelSummary {
  const externals = parsed.externalDataSources ?? [];
  return {
    uri: uriString,
    label: modelLabel(path),
    wsNames: new Set((parsed.workspace ?? []).map((v) => v.name).filter(Boolean)),
    slddRefs: [
      ...(parsed.dataDictionary ? [refBasename(parsed.dataDictionary)] : []),
      ...externals.filter((e) => /\.sldd$/i.test(e)).map(refBasename),
    ],
    matRefs: externals.filter((e) => /\.mat$/i.test(e)).map(refBasename),
    blockParams: (parsed.blockParamUsages ?? []).map((u) => ({
      blockName: u.blockName,
      property: u.paramProperty,
      value: u.paramValue,
    })),
  };
}

// Variable names + dictionary references from an .sldd's content object. Both
// on-disk formats (JSON text and zip) deserialize to this same shape
// (__MW_TEXT_PARTS__), so this is format-agnostic by construction.
export function slddSummary(uriString: string, content: Record<string, unknown>): DataSummary {
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
    // Shared normalisation (a ref is a bare string or a { file } object), so the
    // usage graph, the sections tree, and the compressed-.sldd index all agree on
    // what a dictionary reference is. refBasename'd here because the graph matches
    // refs against workspace files by name, case-insensitively (see SourceSummaries).
    dictRefs.push(...normalizeRefNames(inner['Dictionary References']).map(refBasename));
  }
  return { uri: uriString, varNames, dictRefs };
}

export function matSummary(uriString: string, parsed: ParsedMat): DataSummary {
  return {
    uri: uriString,
    varNames: new Set(parsed.variables.map((v) => v.name).filter(Boolean)),
    dictRefs: [],
  };
}

// Parse each file into the summary its kind calls for, dispatching on the PATH's
// extension. A file that cannot be parsed contributes nothing rather than aborting
// the scan: one corrupt dictionary in a workspace must not empty the Usage column
// of every other file in it.
export function summarizeSources(files: RawSource[]): SourceSummaries {
  const models: ModelSummary[] = [];
  const slddByBase = new Map<string, DataSummary>();
  const matByBase = new Map<string, DataSummary>();
  for (const file of files) {
    try {
      if (isModelPath(file.path)) {
        models.push(modelSummary(parseModel(file.bytes, basename(file.path)), file.uriString, file.path));
      } else if (file.path.endsWith('.mat')) {
        matByBase.set(refBasename(file.path), matSummary(file.uriString, parseMat(file.bytes)));
      } else if (file.path.endsWith('.sldd')) {
        slddByBase.set(refBasename(file.path), slddSummary(file.uriString, readSlddContent(file.bytes)));
      }
    } catch {
      /* unreadable/corrupt file contributes nothing */
    }
  }
  return { models, slddByBase, matByBase };
}

// The whole graph over files a caller has already read. usageGraph.ts adds only the
// vscode I/O in front of this, so a test that hands over real bytes exercises the
// same parse -> summarise -> resolve -> edges path the extension does.
export function buildUsageGraph(files: RawSource[]): ResolvedGraph {
  const { models, slddByBase, matByBase } = summarizeSources(files);
  return buildEdges(models, slddByBase, matByBase);
}

// --- Shaping the cells -------------------------------------------------------

// Shape reverse-edge block refs into the `blockLinks` Usage-cell payload (each link
// navigates back to the block in its owning model). The model name is part of the
// payload and not an optional embellishment: two models can hold blocks of the same
// name — `DragCalc(MainVehicle)` and `DragCalc(SubChassis)` both use SharedTypes'
// DragCoeff — so a bare block name is not a usable answer for a variable that models
// share, which is every variable a dictionary exists to hold.
//
// `modelUri` rides along for the webview to GROUP by, and is not the same fact as
// `modelName`: the label is a stripped basename, so two `engine` models in two folders
// share one — grouping on the label would merge their blocks under a single qualifier
// and claim usages in a model that has none. The uri is what identifies a model.
export function toBlockLinks(refs: BlockRef[]): BlockLink[] {
  return refs.map((r) => ({
    blockName: r.blockName,
    modelName: r.modelName,
    modelUri: r.modelUri,
    linkTarget: `blocks:${r.blockName}@${r.modelUri}`,
  }));
}

/**
 * Fill the Usage cell of every variable row this workspace graph has an answer for.
 * Shared by the data view (.sldd/.mat entries) and the model view's
 * model-workspace-variable rows, so one engine settles the column in both.
 *
 * OVERWRITES a cell that is already there, which is the whole point and was the bug:
 * a row arrives from `node.toRow()` carrying core's own `UsedBy`, and core answers from
 * the files REGISTERED IN ITS SESSION — the models whose editor tab happened to be
 * resolved in this window — in a shape that names the block and not the model. So
 * whether a dictionary entry read `AFRConst, AFRCheck` or
 * `AFR(EngineCtrl), AFRMonitor(EngineCtrl), MixTarget(EngineCtrl), AFRConst(FuelInjector),
 * AFRCheck(FuelInjector)` depended on which models the user had opened — and merely
 * CLICKING a Usage link registered the model it pointed at, degrading the very cell it
 * was clicked from, permanently (model registrations are never withdrawn). Two engines
 * answering one column is the defect; this makes the workspace graph the one that does.
 *
 * A row the graph has nothing for is LEFT ALONE rather than emptied, so core's answer
 * still stands for the one case the graph cannot see: a model opened from outside the
 * workspace and since closed, which leaves the session but is neither found on disk nor
 * an open tab. Absence here is not a claim that a variable is unused — the same rule
 * core's `_usedByCell` applies.
 */
export function annotateVariableRows(
  sourceUri: string,
  rows: { Name?: { label?: string }; UsedBy?: unknown }[],
  reverse: Map<string, BlockRef[]>,
): boolean {
  let changed = false;
  for (const row of rows) {
    const name = row?.Name?.label ?? '';
    if (!name) continue;
    const refs = reverse.get(`${sourceUri}\n${name}`);
    if (!refs || refs.length === 0) continue;
    row.UsedBy = { blockLinks: toBlockLinks(refs) };
    changed = true;
  }
  return changed;
}

// Resolve a param identifier from a model: workspace -> linked .sldd(s) and
// their transitive dict refs -> linked .mat(s). First found wins; a workspace
// var shadows a same-named dictionary/MAT var.
export function resolveParam(
  model: ModelSummary,
  token: string,
  slddByBase: Map<string, DataSummary>,
  matByBase: Map<string, DataSummary>,
): { kind: SourceKind; uri: string } | null {
  if (model.wsNames.has(token)) return { kind: 'workspace', uri: model.uri };

  const seen = new Set<string>();
  const queue = [...model.slddRefs];
  while (queue.length > 0) {
    const base = queue.shift()!;
    if (seen.has(base)) continue;
    seen.add(base);
    const sldd = slddByBase.get(base);
    if (!sldd) continue;
    if (sldd.varNames.has(token)) return { kind: 'sldd', uri: sldd.uri };
    queue.push(...sldd.dictRefs); // chase referenced dictionaries
  }

  for (const base of model.matRefs) {
    const mat = matByBase.get(base);
    if (mat?.varNames.has(token)) return { kind: 'mat', uri: mat.uri };
  }
  return null;
}

// Build the forward + reverse edge maps from parsed model/data summaries.
export function buildEdges(
  models: ModelSummary[],
  slddByBase: Map<string, DataSummary>,
  matByBase: Map<string, DataSummary>,
): ResolvedGraph {
  const reverse = new Map<string, BlockRef[]>();
  const forward = new Map<string, ParamLink[]>();

  const addReverse = (sourceUri: string, varName: string, ref: BlockRef): void => {
    const key = `${sourceUri}\n${varName}`;
    const list = reverse.get(key) ?? [];
    if (!list.some((r) => r.blockName === ref.blockName && r.modelUri === ref.modelUri)) list.push(ref);
    reverse.set(key, list);
  };

  for (const model of models) {
    for (const bp of model.blockParams) {
      const tokens = identifiersIn(bp.value);
      let primary: { kind: SourceKind; uri: string; token: string } | null = null;
      for (const token of tokens) {
        const res = resolveParam(model, token, slddByBase, matByBase);
        if (!res) continue;
        if (!primary) primary = { ...res, token };
        addReverse(res.uri, token, {
          blockName: bp.blockName,
          modelName: model.label,
          modelUri: model.uri,
        });
      }
      const fkey = `${model.uri}\n${bp.blockName}`;
      const links = forward.get(fkey) ?? [];
      if (primary) {
        // A param resolved to the block's OWN model workspace needs no source
        // suffix — the value alone (e.g. `Gain=Kp`) is unambiguous in a model
        // view. Only an EXTERNAL source (linked .sldd/.mat) gets a `(basename)`
        // qualifier, since that's where disambiguation actually matters. The
        // empty source is still distinguishable from an unresolved param below
        // by its non-empty linkTarget.
        const label = primary.kind === 'workspace' ? '' : uriBasename(primary.uri);
        const linkTarget =
          primary.kind === 'workspace'
            ? `workspace:${primary.token}@${primary.uri}`
            : `${primary.token}@${primary.uri}`;
        links.push({ property: bp.property, paramName: bp.value, source: label, linkTarget });
      } else {
        links.push({ property: bp.property, paramName: bp.value, source: '', linkTarget: '' });
      }
      forward.set(fkey, links);
    }
  }

  return { reverse, forward };
}
