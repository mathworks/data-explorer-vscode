// Copyright 2026 The MathWorks, Inc.
import '../dex/datamodel/node/NodeClassMap.js';
import DataModel from '../dex/core/DataModel.js';
import { parseBinarySldd } from '../dex/datamodel/parser/BinarySlddParser.js';
import { isZipBytes } from './slddFormat.js';

const cache = new Map<string, any>(); // uriString -> SlddNode

export function getModel(uriString: string, name: string, text: string): any {
  const cached = cache.get(uriString);
  if (cached) return cached;
  const content = JSON.parse(text);
  // Use a per-URI srcId so multiple open .sldd don't collide in DataModel.
  const node = DataModel.addDataSource(uriString, content, { path: name });
  cache.set(uriString, node);
  return node;
}

// Binary formats (.slx, .mat, compressed .sldd) parsed from bytes.
export function getModelFromBytes(uriString: string, name: string, bytes: ArrayBuffer): any {
  const cached = cache.get(uriString);
  if (cached) return cached;

  let node: any;
  if (name.endsWith('.slx')) {
    node = DataModel.addModelSource(uriString, bytes, { path: name });
  } else if (name.endsWith('.mat')) {
    node = DataModel.addMatSource(uriString, bytes, { path: name });
  } else {
    // .sldd — compressed (zip) vs JSON-as-bytes.
    if (isZipBytes(new Uint8Array(bytes))) {
      const content = parseBinarySldd(bytes);
      node = DataModel.addDataSource(uriString, content, { path: name });
    } else {
      const content = JSON.parse(new TextDecoder().decode(bytes));
      node = DataModel.addDataSource(uriString, content, { path: name });
    }
  }
  cache.set(uriString, node);
  return node;
}

// MATLAB/Simulink Project (.prj): parsed from its resources/project/**/*.xml
// text map, keyed by POSIX relpath relative to the project root.
export function getProjectModel(uriString: string, name: string, files: Record<string, string>): any {
  const cached = cache.get(uriString);
  if (cached) return cached;
  const node = DataModel.addProjectSource(uriString, files, { path: name });
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
