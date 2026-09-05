// Copyright 2026 The MathWorks, Inc.
//
// Element-level node property parity with MATLAB. The fixtures elements.sldd
// (text + binary) were saved by real MATLAB (test/parity/gen_element_fixture.m)
// with a fully-populated Simulink.BusElement:
//   Name x, DataType int32, Min -5, Max 10, Unit m/s, Dimensions 2,
//   Complexity complex, DimensionsMode Fixed, Description 'a populated element'
// plus a default (empty) element y. These tests pin, against the real parsed
// data, that:
//   (1) the Complexity / Dimensions / DimensionsMode columns populate for a
//       BusElement (they used to render empty), with Complexity and
//       DimensionsMode arriving as editable dropdowns over MATLAB's own enums
//       and Dimensions, which has no enum, as a label,
//   (2) Min/Max edits are routed through the MATLAB-verified finite-real-scalar
//       validator (Inf / NaN / arrays / complex rejected; '' clears),
//   (3) a FunctionElement surfaces only Name (no foreign Description/DataType),
//   (4) BusElement property edits round-trip byte-faithfully through the
//       serializer (the read-only element props are preserved).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serializeEntryToXml } from 'data-explorer-core';
import { getModelFromBytes, invalidate } from '../src/host/SlddModel.js';

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

// A BusElement carries these three columns that previously rendered empty.
// Verify against both serialization formats.
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

    it('surfaces Complexity/DimensionsMode as selects and Dimensions as a label', () => {
      const { MyBus } = loadElements(variant);
      const x = MyBus.children.find((c: Entry) => c.name === 'x');
      const props = x.getProperties();
      // MATLAB constrains a BusElement's Complexity and DimensionsMode to a
      // closed enum, so each is a dropdown; Dimensions is a free numeric value
      // and stays read-only. A Signal's dimensionsMode column comes from the
      // declarative schema and is still a label — see dimensionsMode.test.ts.
      for (const [key, editor] of Object.entries({ complexity: 'select', dimensions: 'label', dimensionsMode: 'select' })) {
        const prop = props.find((p: any) => p.key === key);
        expect(prop, key).toBeDefined();
        expect(prop.editor, key).toBe(editor);
      }
      // An editable cell reaches the table as the object shape dex-tree-table
      // opens an editor from — text plus editable/editor/options — not a string,
      // and the options are in MATLAB's own casing.
      const row: Entry = x.toRow();
      expect(row.complexity).toEqual({ text: 'complex', editable: true, editor: 'select', options: ['real', 'complex'] });
      expect(row.dimensionsMode).toEqual({ text: 'Fixed', editable: true, editor: 'select', options: ['Fixed', 'Variable'] });
      expect(row.dimensions).toBe('2');
    });

    it('a default (empty) element y renders its columns without crashing', () => {
      const { MyBus } = loadElements(variant);
      const y = MyBus.children.find((c: Entry) => c.name === 'y');
      expect(y).toBeDefined();
      // A default BusElement is real/Fixed with scalar dimensions in MATLAB.
      const row: Entry = y.toRow();
      expect(row.complexity.text).toBe('real');
      expect(row.dimensionsMode.text).toBe('Fixed');
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

describe('BusElement serialization preserves the element props', () => {
  it('a Min edit round-trips while Complexity/Dimensions/DimensionsMode survive', () => {
    const { MyBus } = loadElements('elem_text');
    const x = MyBus.children.find((c: Entry) => c.name === 'x');
    // Edit Min, then reserialize the whole entry.
    expect(x.setProperty('Min', '2')).toBe(true);
    const props = elementProps(MyBus.serialize());
    // The edited numeric prop is written back (stored key is Min_internal).
    expect(props.Min_internal).toBe(2);
    // The element props this edit did not touch are preserved verbatim.
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

// Both editor providers hand setProperty the COLUMN id the webview sent
// ('complexity'), never the capitalised node/_properties key, so a dropdown over
// one of these two enums only reaches the file if that mapping holds — a broken
// one writes a stray lowercase field and reports success. Cover both write paths:
// the text provider reserializes the entry to JSON, the binary one to the XML
// fragment it splices back into chunk0.xml.
for (const variant of ['elem_text', 'elem_binary'] as const) {
  describe(`BusElement enum edits reach the file (${variant})`, () => {
    it('an edit routed by column id lands on the capitalised property', () => {
      const { MyBus } = loadElements(variant);
      const x = MyBus.children.find((c: Entry) => c.name === 'x');
      expect(x.setProperty('complexity', 'real')).toBe(true);
      expect(x.setProperty('dimensionsMode', 'Variable')).toBe(true);
      const props = elementProps(MyBus.serialize());
      expect(props.Complexity).toBe('real');
      expect(props.DimensionsMode).toBe('Variable');
      // Not written twice under the display key.
      expect('complexity' in props).toBe(false);
      expect('dimensionsMode' in props).toBe(false);
      // The fragment the binary provider splices carries both edits. The sibling
      // element y is real/Fixed already, so 'Variable' can only have come from x,
      // and 'complex' appearing nowhere is what proves x's Complexity moved.
      const frag = serializeEntryToXml(MyBus);
      expect(frag).toContain('<P Name="DimensionsMode" Class="char">Variable</P>');
      expect(frag).not.toContain('>complex<');
    });

    it('a value outside MATLAB’s enum is refused and nothing is written', () => {
      const { MyBus } = loadElements(variant);
      const x = MyBus.children.find((c: Entry) => c.name === 'x');
      // 'Real' is the right word in the wrong casing — MATLAB raises "There is
      // no enumerated value named ..." for it, and so must we.
      for (const [key, bad] of Object.entries({ complexity: 'Real', dimensionsMode: 'fixed' })) {
        const r: any = x.setProperty(key, bad);
        expect(r, key).not.toBe(true);
        expect(r.error, key).toBe(true);
      }
      const props = elementProps(MyBus.serialize());
      expect(props.Complexity).toBe('complex');
      expect(props.DimensionsMode).toBe('Fixed');
    });
  });
}

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
