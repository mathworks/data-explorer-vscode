// Copyright 2026 The MathWorks, Inc.
// Tier-1 structural extraction for .slx models: relationships only, no entries.
// Wraps the full parseSlx and narrows to the relationship fields, tolerating
// corrupt input by returning empty relationships (the file still becomes a node).
import { parseSlx } from '../dex/datamodel/parser/SlxParser.js';

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
      modelReferences: (parsed.modelReferences ?? []).map((r) =>
        r.modelName.endsWith('.slx') ? r.modelName : r.modelName + '.slx',
      ),
      externalDataSources: parsed.externalDataSources ?? [],
    };
  } catch {
    return { dataDictionary: null, modelReferences: [], externalDataSources: [] };
  }
}
