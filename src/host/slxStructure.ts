// Copyright 2026 The MathWorks, Inc.
// Tier-1 structural extraction for Simulink models: relationships only, no entries.
// Wraps the full parseModel and narrows to the relationship fields, tolerating
// corrupt input by returning empty relationships (the file still becomes a node).
//
// `parseModel`, not `parseSlx`: a model is a `.slx` or a `.mdl`, and which of the
// three on-disk forms the bytes hold is core's decision, not this host's. Passing a
// `.mdl` to parseSlx would throw "invalid zip data" and land in the catch below,
// where a legacy model would silently show no relationships at all.
import { isModelFile, parseModel } from 'data-explorer-core';
import { refModelExt } from '../common/fileTypes.js';

export interface SlxStructure {
  dataDictionary: string | null; // linked data dictionary (basename or path)
  modelReferences: string[];     // referenced model names, extension included
  externalDataSources: string[]; // .mat / .sldd data source names
}

export function extractSlxStructure(buffer: ArrayBuffer, filename: string): SlxStructure {
  // The extension to complete a bare reference name with — the PARENT's own. See
  // refModelExt: a .mdl model's references are .mdl siblings, and labelling them
  // .slx resolves to nothing.
  const ext = refModelExt(filename);
  try {
    const parsed = parseModel(buffer, filename);
    return {
      dataDictionary: parsed.dataDictionary ?? null,
      // MATLAB stores model references by bare model name ("plant"); the file on
      // disk is "plant.slx" (or "plant.mdl"). Normalize so basename resolution in
      // RelGraph matches. A reference carrying no usable ModelName is DROPPED
      // rather than named (a bare '.slx' resolves to nothing) or allowed to throw:
      // reading its name unguarded would fall into the catch below and cost the
      // file every other relationship it does have.
      modelReferences: (parsed.modelReferences ?? [])
        .map((r) => r.modelName)
        .filter((n) => typeof n === 'string' && n.length > 0)
        .map((n) => (isModelFile(n) ? n : n + ext)),
      externalDataSources: parsed.externalDataSources ?? [],
    };
  } catch {
    return { dataDictionary: null, modelReferences: [], externalDataSources: [] };
  }
}
