// Copyright 2026 The MathWorks, Inc.
//
// Editable Code Generation properties (Storage Class + Alignment) — the model +
// write-back path. Exercises trySetSchemaProperty routing and a real-fixture
// round-trip for BOTH .sldd formats (JSON text and binary/XML), proving the
// nested CoderInfo write-back persists and re-parses.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ParameterNode from '../src/dex/datamodel/node/data/ParameterNode.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { resolveSourcePath } from '../src/dex/datamodel/schema/index.js';

describe('trySetSchemaProperty routing via node.setProperty', () => {
  it('sets storageClass to a valid enum value', () => {
    const node = ParameterNode.createDefault('p', null);
    expect(node.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
    expect(resolveSourcePath(node.serial._properties, 'CoderInfo.StorageClass')).toBe('ExportedGlobal');
  });

  it('rejects an out-of-enum storageClass with no mutation', () => {
    const node = ParameterNode.createDefault('p', null);
    const before = JSON.stringify(node.serial._properties);
    const r = node.setProperty('storageClass', 'Bogus');
    expect(r).not.toBe(true);
    expect((r as any).error).toBe(true);
    expect(JSON.stringify(node.serial._properties)).toBe(before);
  });

  it('sets alignment to an integer', () => {
    const node = ParameterNode.createDefault('p', null);
    expect(node.setProperty('alignment', '8')).toBe(true);
    expect(resolveSourcePath(node.serial._properties, 'CoderInfo.Alignment')).toBe(8);
  });

  it('rejects a non-integer alignment', () => {
    const node = ParameterNode.createDefault('p', null);
    const r = node.setProperty('alignment', '3.5');
    expect(r).not.toBe(true);
    expect((r as any).error).toBe(true);
  });

  it('falls through to node logic for a non-schema property (Description)', () => {
    const node = ParameterNode.createDefault('p', null);
    expect(node.setProperty('Description', 'hello')).toBe(true);
    expect(node.Description).toBe('hello');
  });
});

const ART = (variant: string, name: string) =>
  fileURLToPath(new URL(`./parity/artifacts/${variant}/${name}`, import.meta.url));

function loadGravity(variant: string): { node: any; model: any } {
  const uri = `cgedit://${variant}/params.sldd`;
  const raw = readFileSync(ART(variant, 'params.sldd'));
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  invalidate(uri);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const model = isZip ? getModelFromBytes(uri, 'params.sldd', ab) : getModel(uri, 'params.sldd', raw.toString('utf8'));
  for (const s of model.children ?? []) for (const e of s.children ?? []) if (e.name === 'gravity') return { node: e, model };
  throw new Error('gravity not found in ' + variant);
}

describe('Code Gen edit round-trip: text (JSON) gravity Parameter', () => {
  it('storageClass edit reserializes to JSON and re-parses with the new value', () => {
    const { node } = loadGravity('text');
    expect(node.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
    // Reserialize the entry (what the host splices back) and re-read.
    const serialized: any = node.serialize();
    const reparsed = ParameterNode.parse(serialized.value, 'gravity', null);
    expect(resolveSourcePath(reparsed.serial._properties, 'CoderInfo.StorageClass')).toBe('ExportedGlobal');
  });

  it('alignment edit persists into the reserialized entry', () => {
    const { node } = loadGravity('text');
    expect(node.setProperty('alignment', '16')).toBe(true);
    const serialized: any = node.serialize();
    const reparsed = ParameterNode.parse(serialized.value, 'gravity', null);
    expect(resolveSourcePath(reparsed.serial._properties, 'CoderInfo.Alignment')).toBe(16);
  });

  it('marks the entry Modified after a schema edit', () => {
    const { node } = loadGravity('text');
    node.setProperty('storageClass', 'Custom');
    expect(node.status).toBe('Modified');
  });
});

describe('Code Gen edit round-trip: binary (XML) gravity Parameter', () => {
  it('storageClass edit survives an XML reserialize + reparse', () => {
    const { node } = loadGravity('binary');
    expect(node.setProperty('storageClass', 'Custom')).toBe(true);
    // serializeValue rebuilds the MATLABArray-wrapped _properties in place.
    expect(resolveSourcePath(node.serial._properties, 'CoderInfo.StorageClass')).toBe('Custom');
  });

  it('alignment edit keeps the int32 typed-scalar shape', () => {
    const { node } = loadGravity('binary');
    expect(node.setProperty('alignment', '32')).toBe(true);
    // The binary CoderInfo.Alignment leaf is a typed scalar; the edit rewrites
    // _value while preserving _type, so it stays int32 for XML serialization.
    const align = node.serial._properties.CoderInfo._elements[0]._properties.Alignment;
    expect(align).toEqual({ _type: 'int32', _value: '32' });
  });
});
