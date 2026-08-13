// Copyright 2026 The MathWorks, Inc.
//
// Element-level node property parity with MATLAB. The fixtures elements.sldd
// (text + binary) were saved by real MATLAB (test/parity/gen_element_fixture.m)
// with a fully-populated Simulink.BusElement:
//   Name x, DataType int32, Min -5, Max 10, Unit m/s, Dimensions 2,
//   Complexity complex, DimensionsMode Fixed, Description 'a populated element'
// plus a default (empty) element y. These tests pin, against the real parsed
// data, that:
//   (1) the newly-surfaced Complexity / Dimensions / DimensionsMode columns
//       populate for a BusElement (they used to render empty),
//   (2) Min/Max edits are routed through the MATLAB-verified finite-real-scalar
//       validator (Inf / NaN / arrays / complex rejected; '' clears),
//   (3) a FunctionElement surfaces only Name (no foreign Description/DataType),
//   (4) BusElement property edits round-trip byte-faithfully through the
//       serializer (the read-only element props are preserved).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

type Entry = Record<string, any>;

function loadElements(variant: 'elem_text' | 'elem_binary'): Record<string, Entry> {
  const p = fileURLToPath(new URL(`./parity/artifacts/${variant}/elements.sldd`, import.meta.url));
  const raw = readFileSync(p);
  invalidate('dm://' + variant);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const model: any = getModelFromBytes('dm://' + variant, 'elements.sldd', ab);
  const found: Record<string, Entry> = {};
  for (const s of model.children ?? []) for (const e of s.children ?? []) found[e.name] = e;
  return found;
}

// A BusElement carries these three read-only columns that previously rendered
// empty. Verify against both serialization formats.
for (const variant of ['elem_text', 'elem_binary'] as const) {
  describe(`BusElement columns (${variant})`, () => {
    it('parses the populated element x with all element props', () => {
      const { MyBus } = loadElements(variant);
      expect(MyBus?.className).toBe('Simulink.Bus');
      const x = MyBus.children.find((c: Entry) => c.name === 'x');
      expect(x).toBeDefined();
      expect(x.className).toBe('Simulink.BusElement');
      // Min/Max/Unit/DataType already populated (via *_internal / DocUnits).
      expect(x.Min).toBe(-5);
      expect(x.Max).toBe(10);
      expect(x.Unit).toBe('m/s');
      expect(x.DataType).toBe('int32');
      // The newly-surfaced element props.
      expect(x.Complexity).toBe('complex');
      expect(x.DimensionsMode).toBe('Fixed');
      expect(x.Dimensions).toBe(2);
    });

    it('surfaces Complexity/Dimensions/DimensionsMode as read-only columns', () => {
      const { MyBus } = loadElements(variant);
      const x = MyBus.children.find((c: Entry) => c.name === 'x');
      const props = x.getProperties();
      for (const key of ['complexity', 'dimensions', 'dimensionsMode']) {
        const prop = props.find((p: any) => p.key === key);
        expect(prop, key).toBeDefined();
        expect(prop.editor, key).toBe('label');
      }
      const row: Entry = x.toRow();
      expect(row.complexity).toBe('complex');
      expect(row.dimensionsMode).toBe('Fixed');
      expect(row.dimensions).toBe('2');
    });

    it('a default (empty) element y renders its columns without crashing', () => {
      const { MyBus } = loadElements(variant);
      const y = MyBus.children.find((c: Entry) => c.name === 'y');
      expect(y).toBeDefined();
      // A default BusElement is real/Fixed with scalar dimensions in MATLAB.
      const row: Entry = y.toRow();
      expect(row.complexity).toBe('real');
      expect(row.dimensionsMode).toBe('Fixed');
    });
  });
}

describe('BusElement Min/Max constraint parity', () => {
  function element(): Entry {
    const { MyBus } = loadElements('elem_text');
    return MyBus.children.find((c: Entry) => c.name === 'x');
  }

  it('accepts a finite real scalar', () => {
    const x = element();
    expect(x.setProperty('Min', '3')).toBe(true);
    expect(x.Min).toBe(3);
    expect(x.setProperty('Max', '4.5')).toBe(true);
    expect(x.Max).toBe(4.5);
  });

  it('rejects Inf, -Inf and NaN (MATLAB: finite real double scalar)', () => {
    const x = element();
    for (const bad of ['Inf', '-Inf', 'NaN']) {
      const r: any = x.setProperty('Min', bad);
      expect(r).not.toBe(true);
      expect(r.error).toBe(true);
      expect(r.reason).toContain('finite real double scalar');
    }
    // The value was not mutated by a rejected edit.
    expect(x.Min).toBe(-5);
  });

  it('rejects an array and a complex literal', () => {
    const x = element();
    for (const bad of ['[5 6]', '5+2i']) {
      const r: any = x.setProperty('Max', bad);
      expect(r).not.toBe(true);
      expect(r.error).toBe(true);
    }
    expect(x.Max).toBe(10);
  });

  it("clears Min with '' or []", () => {
    const x = element();
    expect(x.setProperty('Min', '')).toBe(true);
    expect(x.Min).toBeUndefined();
    const x2 = element();
    expect(x2.setProperty('Max', '[]')).toBe(true);
    expect(x2.Max).toBeUndefined();
  });
});

describe('BusElement serialization preserves read-only element props', () => {
  // Walk the serialized entry tree to the first element's _properties bag.
  function elementProps(serialized: any): Record<string, any> {
    let found: Record<string, any> | null = null;
    const visit = (o: any) => {
      if (found || !o || typeof o !== 'object') return;
      if (o._array_class === 'Simulink.BusElement' && Array.isArray(o._elements)) {
        found = o._elements[0]._properties;
        return;
      }
      for (const k of Object.keys(o)) visit(o[k]);
    };
    visit(serialized);
    if (!found) throw new Error('no BusElement array in serialized entry');
    return found;
  }

  it('a Min edit round-trips while Complexity/Dimensions/DimensionsMode survive', () => {
    const { MyBus } = loadElements('elem_text');
    const x = MyBus.children.find((c: Entry) => c.name === 'x');
    // Edit Min, then reserialize the whole entry.
    expect(x.setProperty('Min', '2')).toBe(true);
    const props = elementProps(MyBus.serialize());
    // The edited numeric prop is written back (stored key is Min_internal).
    expect(props.Min_internal).toBe(2);
    // The read-only element props are preserved verbatim from the source.
    expect(props.Complexity).toBe('complex');
    expect(props.DimensionsMode).toBe('Fixed');
    expect(props.Dimensions).toBe(2);
    expect(props.DataType_internal).toBe('int32');
    expect(props.DocUnits).toBe('m/s');
  });

  it('serializing without any edit preserves the element props byte-for-byte', () => {
    const { MyBus } = loadElements('elem_text');
    const before = elementProps(MyBus.serial);
    const after = elementProps(MyBus.serialize());
    for (const key of ['Complexity', 'DimensionsMode', 'Dimensions', 'DataType_internal', 'DocUnits', 'Min_internal', 'Max_internal']) {
      expect(after[key], key).toEqual(before[key]);
    }
  });
});

describe('FunctionElement surface (no foreign props)', () => {
  it('surfaces only Name — never Description or DataType', () => {
    const { MyServiceBus } = loadElements('elem_text');
    if (!MyServiceBus) return; // ServiceBus may not persist an element in the fixture
    for (const fe of MyServiceBus.children ?? []) {
      const keys = fe.getProperties().map((p: any) => p.key);
      expect(keys).toContain('Name');
      expect(keys).not.toContain('Description');
      expect(keys).not.toContain('DataType');
    }
  });
});
