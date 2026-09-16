// Copyright 2026 The MathWorks, Inc.
// Tier-1 structural extraction for Simulink models: relationships only, no entries.
// Normalizes core's three relationship fields for RelGraph, tolerating corrupt input by
// returning empty relationships (the file still becomes a node).
//
// `scanModelStructure`, not `parseModel`: this module reads three fields and the full
// parse walks every block to produce them, which this index pays for on every save of
// every model in the workspace. Measured through THIS function over a 127-model corpus,
// 1598 ms becomes 54 ms — 30x — for a byte-identical result on all 127 (76 dictionary
// links, 82 references, 13 external sources either way). It is not a second reader
// either: it runs core's own model parser over the OPC parts these three fields come
// from, so there is no new format-coverage risk to carry here.
//
// Either way it is core that decides which of the three on-disk forms the bytes hold, and
// not this host: `scanModelStructure` dispatches on the ZIP magic exactly as `parseModel`
// does. Reaching for `parseSlx` instead would throw "invalid zip data" on a `.mdl` and land
// in the catch below, where a legacy model would silently show no relationships at all.
//
// Cheaper still than the cheapest scan is NOT READING THE FILE, which is what the second entry
// point is for: `structureFromParsed` shapes these same three fields off a `ParsedSlx` a caller
// already holds. Core's `scanModelStructure` projects exactly those three fields off a
// `parseModel` result for a non-zip model, so a parse is a strict superset of a scan and there is
// no third derivation here — one SHAPING function serves both routes (see `shapeStructure`).
import { isModelFile, refModelExt, scanModelStructure } from 'data-explorer-core';
import type { ModelStructure, ParsedSlx } from 'data-explorer-core';

export interface SlxStructure {
  dataDictionary: string | null; // linked data dictionary (basename or path)
  modelReferences: string[];     // referenced model names, extension included
  externalDataSources: string[]; // .mat / .sldd data source names
}

/**
 * Core's three relationship fields, normalized for RelGraph — the whole difference between a
 * `ModelStructure` and an `SlxStructure`.
 *
 * ONE shaping function for both entry points, because the normalization is the part that must
 * not drift: the two routes read the same three fields from the same producer, so a completion
 * or a filter applied on one side only would make a model's edges depend on which consumer
 * happened to reach it first. slxStructure.test.ts compares the two routes field for field over
 * every model fixture, which is a pin on that and not merely on either route.
 */
function shapeStructure(structure: ModelStructure, filename: string): SlxStructure {
  // The extension to complete a bare reference name with — the PARENT's own, and core's
  // call rather than this host's: a .mdl model's references are .mdl siblings, labelling
  // them .slx resolves to nothing, and core's `ModelSectionNode.addReferenceEntry`
  // completes the same names for the TREE that this completes for the GRAPH.
  const ext = refModelExt(filename);
  return {
    dataDictionary: structure.dataDictionary ?? null,
    // MATLAB stores model references by bare model name ("plant"); the file on
    // disk is "plant.slx" (or "plant.mdl"). Normalize so basename resolution in
    // RelGraph matches. A reference carrying no usable ModelName is DROPPED
    // rather than named (a bare '.slx' resolves to nothing) or allowed to throw:
    // reading its name unguarded would fall into the catch in `extractSlxStructure` and cost
    // the file every other relationship it does have.
    modelReferences: (structure.modelReferences ?? [])
      .map((r) => r.modelName)
      .filter((n) => typeof n === 'string' && n.length > 0)
      .map((n) => (isModelFile(n) ? n : n + ext)),
    externalDataSources: structure.externalDataSources ?? [],
  };
}

export function extractSlxStructure(buffer: ArrayBuffer, filename: string): SlxStructure {
  try {
    // A package whose UNREAD parts are corrupt opens here and would have been refused by
    // `parseModel` — bytes that are never inflated cannot fail to inflate. So the catch
    // below fires strictly less often than it did, and a model with damaged block XML now
    // keeps the relationships it does have instead of showing none.
    return shapeStructure(scanModelStructure(buffer, filename), filename);
  } catch {
    return { dataDictionary: null, modelReferences: [], externalDataSources: [] };
  }
}

/**
 * The same structure, read off a model this host has ALREADY parsed — no bytes, no scan.
 *
 * A `ParsedSlx` carries `dataDictionary`, `modelReferences` and `externalDataSources` and they
 * are the same three fields, from the same code: for a non-zip model `scanModelStructure` IS a
 * `parseModel` with those three projected off it. So a caller holding a parse for the version it
 * wants a structure for has already paid for this answer, and reading the file again to scan it
 * would be a read for 0.1 ms of work (sourceCache.cheapOf makes exactly that decision).
 *
 * No `try` of its own, and the asymmetry is the point rather than an omission. What the other
 * route's catch is about is the BYTES — a buffer that is not a package, an archive that will not
 * walk — and a caller holding a `ParsedSlx` is past every one of those: core produced it. The
 * shaping itself reads three fields whose absence the `??`s and the filter above already answer
 * for, so there is nothing left here for a catch to convert into an all-empty structure, and one
 * that did would hide a core invariant having broken rather than a file being damaged.
 */
export function structureFromParsed(parsed: ParsedSlx, filename: string): SlxStructure {
  return shapeStructure(parsed, filename);
}
