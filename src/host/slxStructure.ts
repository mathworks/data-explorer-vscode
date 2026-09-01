// Copyright 2026 The MathWorks, Inc.
// Tier-1 structural extraction for .slx models: relationships only, no entries.
// Wraps the full parseSlx and narrows to the relationship fields, tolerating
// corrupt input by returning empty relationships (the file still becomes a node).
import { parseSlx } from 'data-explorer-core';

export interface SlxStructure {
  dataDictionary: string | null; // linked data dictionary (basename or path)
  modelReferences: string[];     // referenced .slx model names
  externalDataSources: string[]; // .mat / .sldd data source names
}

export function extractSlxStructure(buffer: ArrayBuffer, filename: string): SlxStructure {
  try {
    const parsed = parseSlx(buffer, filename);
    return {
      dataDictionary: parsed.dataDictionary ?? null,
      // MATLAB stores model references by bare model name ("plant"); the file on
      // disk is "plant.slx". Normalize so basename resolution in RelGraph matches.
      // A reference carrying no usable ModelName is DROPPED rather than named
      // (a bare '.slx' resolves to nothing) or allowed to throw: reading its
      // name unguarded would fall into the catch below and cost the file every
      // other relationship it does have.
      modelReferences: (parsed.modelReferences ?? [])
        .map((r) => r.modelName)
        .filter((n) => typeof n === 'string' && n.length > 0)
        .map((n) => (n.endsWith('.slx') ? n : n + '.slx')),
      externalDataSources: parsed.externalDataSources ?? [],
    };
  } catch {
    return { dataDictionary: null, modelReferences: [], externalDataSources: [] };
  }
}
