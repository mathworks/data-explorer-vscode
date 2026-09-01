// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { extractSlxStructure } from '../src/host/slxStructure.js';

function buf(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// Build a real .slx (a zip of the parts parseSlx reads) so these cases go through
// the actual parser rather than a hand-made ParsedSlx shape.
function slx(parts: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const key in parts) entries[key] = strToU8(parts[key]);
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const DATA_SOURCES_XML =
  `<?xml version="1.0"?><ExternalDataSourceSettings><ExplicitExternalBrokerSources>` +
  `<fullPathToSource>signals.mat</fullPathToSource>` +
  `</ExplicitExternalBrokerSources></ExternalDataSourceSettings>`;

describe('extractSlxStructure', () => {
  it('extracts linked dictionary, model references, and external data sources', () => {
    const s = extractSlxStructure(buf('model_with_refs.slx'), 'model_with_refs.slx');
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.modelReferences).toContain('plant.slx');
    expect(s.externalDataSources).toContain('signals.mat');
  });

  it('returns empty relationships for a corrupt buffer without throwing', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.slx');
    expect(s.dataDictionary).toBeNull();
    expect(s.modelReferences).toEqual([]);
    expect(s.externalDataSources).toEqual([]);
  });

  it('returns empty relationships for an empty buffer without throwing', () => {
    const s = extractSlxStructure(new ArrayBuffer(0), 'empty.slx');
    expect(s.dataDictionary).toBeNull();
    expect(s.modelReferences).toEqual([]);
    expect(s.externalDataSources).toEqual([]);
  });

  it('maps model references to bare model-name strings (not objects)', () => {
    const s = extractSlxStructure(buf('model_with_refs.slx'), 'model_with_refs.slx');
    for (const ref of s.modelReferences) {
      expect(typeof ref).toBe('string');
    }
  });

  it('always returns arrays (never undefined) for the list fields', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.slx');
    expect(Array.isArray(s.modelReferences)).toBe(true);
    expect(Array.isArray(s.externalDataSources)).toBe(true);
  });

  it('appends .slx to a bare model name so basename resolution can match it', () => {
    // MATLAB records a reference as "plant"; the workspace file is "plant.slx".
    // Without the suffix the graph never links the two, so the model shows no
    // referenced models even though it has one.
    const s = extractSlxStructure(
      slx({
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }],
        }),
      }),
      'bare.slx',
    );
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('keeps a model name that already ends in .slx exactly as-is', () => {
    // Double-suffixing to "plant.slx.slx" would break the same graph lookup.
    const s = extractSlxStructure(
      slx({
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant.slx' }],
        }),
      }),
      'suffixed.slx',
    );
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('keeps every other relationship when one model reference has no ModelName', () => {
    // Regression: reading .modelName off such a reference threw, and the catch
    // then returned the all-empty structure — so ONE malformed reference made the
    // model appear to have no linked dictionary and no external data at all.
    const s = extractSlxStructure(
      slx({
        'simulink/blockDiagram.json': JSON.stringify({
          BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'u' },
        }),
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }, { BlockPath: 'ctrl/x' }],
        }),
        'simulink/ExternalDataSourceSettings.xml': DATA_SOURCES_XML,
      }),
      'partial.slx',
    );
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.externalDataSources).toEqual(['signals.mat']);
    // The good reference survives; the nameless one is dropped, not invented.
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('drops a model reference whose ModelName is empty instead of naming it ".slx"', () => {
    // A bare ".slx" resolves to no file, so it would surface in the tree as a
    // phantom Model Reference row the user cannot open.
    const s = extractSlxStructure(
      slx({
        'simulink/blockDiagram.json': JSON.stringify({ BlockDiagram: { DataDictionary: 'd.sldd' } }),
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'a/b', ModelName: '' }],
        }),
      }),
      'empty-name.slx',
    );
    expect(s.modelReferences).toEqual([]);
    expect(s.dataDictionary).toBe('d.sldd');
  });

  it('reports no linked dictionary as null for a model that has none', () => {
    // graphModel keys the dictionary edge off this field; '' or undefined would
    // draw an edge to a nonexistent file.
    const s = extractSlxStructure(
      slx({ 'simulink/blockDiagram.json': JSON.stringify({ BlockDiagram: { ModelUUID: 'u' } }) }),
      'nodict.slx',
    );
    expect(s.dataDictionary).toBeNull();
  });
});
