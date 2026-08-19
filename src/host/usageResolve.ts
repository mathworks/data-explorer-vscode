// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) core of the usage graph: parameter-source resolution and
// edge construction. Split from usageGraph.ts (which does the file I/O) so the
// shadowing rule and workspace->sldd->mat ordering are unit-testable.
import { basename, uriBasename } from '../common/pathUtil.js';

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

export interface BlockRef {
  blockName: string;
  modelName: string;
  modelUri: string;
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

// Identifiers a param expression references (so `2*Kp` yields ['Kp']). Numeric
// literals and operators fall out naturally.
export function identifiers(expr: string): string[] {
  return expr.match(/[A-Za-z_]\w*/g) ?? [];
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
      const tokens = identifiers(bp.value);
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
