// Copyright 2026 The MathWorks, Inc.
import { DataModel, type ParseWarning } from 'data-explorer-core';
import { readSlddContent } from './slddContent.js';
import { refuseIfUnreadable, sourceWarnings } from './parseWarnings.js';
import { isMatPath, isModelPath } from '../common/fileTypes.js';

const cache = new Map<string, any>(); // uriString -> SlddNode

// Every source this module registers passes through here, which is the point: the
// "a source the reader could not read is not passed on as an empty one" rule has to
// hold for a model and a project exactly as it does for a dictionary, and the four
// adders above reach it by four different routes. `.sldd` is refused twice over —
// once inside readSlddContent, on the parser's own sink, and once here on whatever
// the node layer added — which costs a find over a list that is empty in the normal
// case and removes the chance of a format being wired to only one of the two.
//
// A refused source is DE-REGISTERED first. Core attaches the warnings to a node it
// has already put in the session, so throwing while it is still there would leave
// the session holding a tree the provider then reports as failed-to-parse: the
// Property Inspector would resolve selections into it, and re-opening the file would
// hit `deindexSource` on a tree nothing else references.
function registered(srcId: string, node: any): any {
  const warnings = sourceWarnings(node);
  try {
    refuseIfUnreadable(warnings);
  } catch (err) {
    DataModel.removeDataSource(srcId);
    throw err;
  }
  return node;
}

export function getModel(uriString: string, name: string, text: string): any {
  const cached = cache.get(uriString);
  if (cached) return cached;
  const content = JSON.parse(text);
  // Use a per-URI srcId so multiple open .sldd don't collide in DataModel.
  const node = registered(uriString, DataModel.addDataSource(uriString, content, { path: name }));
  cache.set(uriString, node);
  return node;
}

// Byte-backed formats (.slx, .mdl, .mat, compressed .sldd) parsed from bytes.
export function getModelFromBytes(uriString: string, name: string, bytes: ArrayBuffer): any {
  const cached = cache.get(uriString);
  if (cached) return cached;

  let node: any;
  // Both model containers go to the same adder. A `.mdl` is not necessarily binary
  // — both of its flavours are text — but it arrives here as bytes like the rest,
  // and core's addModelSource sniffs the actual format rather than trusting the
  // extension.
  if (isModelPath(name)) {
    node = DataModel.addModelSource(uriString, bytes, { path: name });
  } else if (isMatPath(name)) {
    node = DataModel.addMatSource(uriString, bytes, { path: name });
  } else {
    // .sldd — compressed (zip) vs JSON-as-bytes; readSlddContent dispatches. The
    // sink is threaded through both halves of the read so the dictionary's warnings
    // arrive as ONE list on the node: the zip parser fills it, then SlddNode.parse
    // appends to the same array. Passing nothing here would silently drop every
    // binary-part warning, since the node layer would start a fresh list.
    const warnings: ParseWarning[] = [];
    const content = readSlddContent(bytes, warnings);
    node = DataModel.addDataSource(uriString, content, { path: name }, warnings);
  }
  node = registered(uriString, node);
  cache.set(uriString, node);
  return node;
}

// MATLAB/Simulink Project (.prj): parsed from its resources/project/**/*.xml
// text map, keyed by POSIX relpath relative to the project root.
export function getProjectModel(uriString: string, name: string, files: Record<string, string>): any {
  const cached = cache.get(uriString);
  if (cached) return cached;
  const node = registered(uriString, DataModel.addProjectSource(uriString, files, { path: name }));
  cache.set(uriString, node);
  return node;
}

export function invalidate(uriString: string): void {
  cache.delete(uriString);
}

export function findNode(uriString: string, nodeId: string): any | null {
  // Prefer the global registry — it is keyed by the FULL node id (which embeds
  // the source's srcId), so it resolves regardless of which provider registered
  // the model. Crucially, the editable binary/text providers register their
  // model in DataModel under a prefixed srcId but NOT in this module's `cache`,
  // so gating on `cache.get(uriString)` here would wrongly drop their selections
  // (the Property Inspector would never render). Try the registry unconditionally.
  // PRECONDITION (untested) for the `: null` arm: the pinned data-explorer-core
  // always exports findNodeById on DataModel. The feature-detect exists because
  // core is a git-pinned dependency bumped independently of this repo, so an older
  // pin must degrade to the cache fallback below rather than throw on every
  // selection; the `try` covers the same risk for a throwing implementation.
  try {
    const viaRegistry = (DataModel as any).findNodeById
      ? (DataModel as any).findNodeById(nodeId)
      : null;
    if (viaRegistry) return viaRegistry;
  } catch {
    /* fall through */
  }
  // Fallback: flatten the cached model tree (for models registered via getModel).
  const model = cache.get(uriString);
  if (model && typeof model.flatten === 'function') {
    return model.flatten().find((n: any) => n.id === nodeId) ?? null;
  }
  return null;
}
