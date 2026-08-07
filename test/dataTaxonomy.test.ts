// Copyright 2026 The MathWorks, Inc.
//
// The three-concept data model: every node exposes Class (className), Kind
// (kind), and Data Type (dataType) as DISTINCT, never-mixed values, one per
// column. Class is the raw class identity; Kind is the user-facing name; Data
// Type is a real data type only (empty for object types). This suite locks that
// separation down at the model layer (getters + toRow() emission).
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/dex/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/dex/datamodel/node/data/SignalNode.js';
import ValueTypeNode from '../src/dex/datamodel/node/data/ValueTypeNode.js';
import NumericTypeNode from '../src/dex/datamodel/node/data/NumericTypeNode.js';
import AliasTypeNode from '../src/dex/datamodel/node/data/AliasTypeNode.js';
import { EnumTypeNode } from '../src/dex/datamodel/node/data/EnumTypeNode.js';
import { BusNode } from '../src/dex/datamodel/node/data/BusNode.js';
import { ConnectionBusNode } from '../src/dex/datamodel/node/data/ConnectionBusNode.js';
import MatlabVariableNode from '../src/dex/datamodel/node/data/MatlabVariableNode.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

function rawVal(className: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

function elementsInternal(elementClass: string, elems: Record<string, unknown>[]): Record<string, unknown> {
  return {
    _array_class: elementClass,
    _dimensions: [elems.length, 1],
    _mw_element_type: 'MATLABArray',
    _elements: elems.map((p) => ({ _properties: p })),
  };
}

const enumerals = { _array_type: 'Struct', _dimensions: [1, 1], _fields: ['Name', 'Value', 'Description'], _elements: [{ Name: 'red', Value: 0, Description: '' }] };

describe('primitive MATLAB variables: Class == Data Type, Kind is "MATLAB Variable"', () => {
  it('a scalar double reports double for both Class and Data Type', () => {
    const node = MatlabVariableNode.parse(3.14, 'x', null);
    expect(node.className).toBe('double');
    expect(node.dataType).toBe('double');
    expect(node.kind).toBe('MATLAB Variable');
  });

  it('a char variable reports char for both Class and Data Type', () => {
    const node = MatlabVariableNode.parse('hello', 'greeting', null);
    expect(node.className).toBe('char');
    expect(node.dataType).toBe('char');
    expect(node.kind).toBe('MATLAB Variable');
  });

  it('toRow() emits Class, Kind, and DataType for a primitive', () => {
    const row = MatlabVariableNode.parse(42, 'n', null).toRow()!;
    expect(row.Class).toBe('double');
    expect(row.Kind).toBe('MATLAB Variable');
    expect(row.DataType).toBe('double');
  });
});

describe('object types: Class is the class identity, Kind is friendly, Data Type is type-only', () => {
  it('Simulink.Parameter -> Class identity, "Simulink Parameter" kind, no Data Type from the class', () => {
    const node = ParameterNode.parse(rawVal('Simulink.Parameter', { Value: 1 }), 'K', null);
    expect(node.className).toBe('Simulink.Parameter');
    expect(node.kind).toBe('Simulink Parameter');
    // The Data Type column never shows the class identity.
    expect(node.dataType).not.toBe('Simulink.Parameter');
  });

  it('Simulink.Signal -> Class identity + "Simulink Signal" kind', () => {
    const node = SignalNode.parse(rawVal('Simulink.Signal', {}), 'sig', null);
    expect(node.className).toBe('Simulink.Signal');
    expect(node.kind).toBe('Simulink Signal');
  });

  it('a ValueType surfaces its mapped Data Type but a class-identity Class', () => {
    const node = ValueTypeNode.parse(rawVal('Simulink.ValueType', { DataType: 'single' }), 'VT', null);
    expect(node.className).toBe('Simulink.ValueType');
    expect(node.kind).toBe('Value Type');
    expect(node.dataType).toBe('single');
  });

  it('an AliasType and NumericType keep their class identity and never leak it into Data Type', () => {
    const alias = AliasTypeNode.parse(rawVal('Simulink.AliasType', {}), 'A', null);
    expect(alias.className).toBe('Simulink.AliasType');
    expect(alias.kind).toBe('Alias Type');
    expect(alias.toRow()!.DataType).toBe('');

    const num = NumericTypeNode.parse(rawVal('Simulink.NumericType', {}), 'N', null);
    expect(num.className).toBe('Simulink.NumericType');
    expect(num.kind).toBe('Numeric Type');
    expect(num.toRow()!.DataType).toBe('');
  });

  it('an EnumType is class-only in Data Type', () => {
    const en = EnumTypeNode.parse(rawVal('Simulink.data.dictionary.EnumTypeDefinition', { Enumerals: enumerals }), 'Color', null);
    expect(en.className).toBe('Simulink.data.dictionary.EnumTypeDefinition');
    expect(en.kind).toBe('Enumerated Type');
    expect(en.dataType).toBe('');
  });
});

describe('bus / connection elements: Class is the element object class, not the mapped type', () => {
  it('a Bus element reports Simulink.BusElement / "Bus Element" / mapped data type', () => {
    const bus = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: elementsInternal('Simulink.BusElement', [{ Name: 'a', DataType_internal: 'int8' }]) }), 'B', null);
    const el = bus.children[0];
    expect(el.className).toBe('Simulink.BusElement');
    expect(el.kind).toBe('Bus Element');
    expect(el.dataType).toBe('int8');
  });

  it('a Connection element reports Simulink.ConnectionElement / "Connection Element" / mapped type', () => {
    const cb = ConnectionBusNode.parse(rawVal('Simulink.ConnectionBus', { Elements_internal: elementsInternal('Simulink.ConnectionElement', [{ Name: 'c1', Type_internal: 'foundation.x' }]) }), 'CB', null);
    const el = cb.children[0];
    expect(el.className).toBe('Simulink.ConnectionElement');
    expect(el.kind).toBe('Connection Element');
    expect(el.dataType).toBe('foundation.x');
  });

  it('the parent Bus is class-only in Data Type but friendly in Kind', () => {
    const bus = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'B', null);
    expect(bus.className).toBe('Simulink.Bus');
    expect(bus.kind).toBe('Bus');
    expect(bus.toRow()!.DataType).toBe('');
  });
});

describe('classification drives Kind independent of Class', () => {
  it('the same Simulink.Bus is a "Data Interface" or "Struct Type" by classification', () => {
    const iface = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'IF', null);
    iface.classification = 'DataInterface';
    expect(iface.className).toBe('Simulink.Bus'); // Class unchanged
    expect(iface.kind).toBe('Data Interface'); // Kind from classification
    expect(iface.toRow()!.DataType).toBe(''); // still type-only

    const struct = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'S', null);
    struct.classification = 'StructType';
    expect(struct.className).toBe('Simulink.Bus');
    expect(struct.kind).toBe('Struct Type');
  });

  it('an unknown classification token falls back to itself as the Kind', () => {
    const node = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'B', null);
    node.classification = 'SomeFutureKind';
    expect(node.kind).toBe('SomeFutureKind');
  });
});
