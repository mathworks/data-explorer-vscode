// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractSlxStructure } from '../src/host/slxStructure.js';

function buf(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

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
});
