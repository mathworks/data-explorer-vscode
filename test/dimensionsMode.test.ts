// Copyright 2026 The MathWorks, Inc.
//
// Dimensions Mode column — a Simulink.Signal-only Code Generation / Data Object
// property. Its schema source path and default were confirmed from real MATLAB
// data (test/parity/gen_codegen_fixture.m): DimensionsMode is a top-level char
// on Simulink.Signal (default 'auto') and is Unrecognized on Simulink.Parameter.
// This test pins that against the real parsed fixture (codegen.sldd, entries
// cgSignal + cgParam) via the production getModelFromBytes path.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

function loadCodegen(): { cgSignal: any; cgParam: any } {
  const p = fileURLToPath(new URL('./parity/artifacts/binary/codegen.sldd', import.meta.url));
  const raw = readFileSync(p);
  invalidate('dm://codegen');
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const model: any = getModelFromBytes('dm://codegen', 'codegen.sldd', ab);
  const found: Record<string, any> = {};
  for (const s of model.children ?? []) for (const e of s.children ?? []) found[e.name] = e;
  return { cgSignal: found.cgSignal, cgParam: found.cgParam };
}

describe('Dimensions Mode: real-fixture parity', () => {
  it('the fixture carries both entries', () => {
    const { cgSignal, cgParam } = loadCodegen();
    expect(cgSignal?.className).toBe('Simulink.Signal');
    expect(cgParam?.className).toBe('Simulink.Parameter');
  });

  it('DimensionsMode parses as a top-level property on the Signal', () => {
    const { cgSignal } = loadCodegen();
    // The generator set it to 'Fixed'; the schema sourcePath is a bare
    // top-level key, so it resolves directly off _properties.
    expect(cgSignal.serial._properties.DimensionsMode).toBe('Fixed');
  });

  it('the Signal surfaces a read-only dimensionsMode column from real data', () => {
    const { cgSignal } = loadCodegen();
    const prop = cgSignal.getProperties().find((p: any) => p.key === 'dimensionsMode');
    expect(prop).toBeDefined();
    expect(prop.editor).toBe('label');
    const row: any = cgSignal.toRow();
    expect(row.dimensionsMode).toBe('Fixed');
  });

  it('the Parameter has no DimensionsMode and surfaces no such column', () => {
    const { cgParam } = loadCodegen();
    expect('DimensionsMode' in cgParam.serial._properties).toBe(false);
    expect(cgParam.getProperties().find((p: any) => p.key === 'dimensionsMode')).toBeUndefined();
  });

  it('an omitted DimensionsMode hydrates to the "auto" default', () => {
    // A default-constructed Signal node (no DimensionsMode stored) should read
    // back the schema default rather than empty.
    const { cgSignal } = loadCodegen();
    const prop = cgSignal.getProperties().find((p: any) => p.key === 'dimensionsMode');
    // readValue over a props bag WITHOUT the key falls back to the default.
    const bare: any = { serial: { _properties: { Dimensions: -1 } }, className: 'Simulink.Signal' };
    expect(prop.readValue(bare)).toBe('auto');
  });
});
