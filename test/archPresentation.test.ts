// Copyright 2026 The MathWorks, Inc.
//
// Unit coverage for the Architectural Data presentation behaviors: how the
// DataType / Value columns are populated by each node's toRow(), and how the
// systemcomposer arch kind is surfaced. The webview-only styling (italic
// DataType column, understated section rows) is not unit-testable here.
import { describe, it, expect } from 'vitest';
import ValueTypeNode from '../src/dex/datamodel/node/data/ValueTypeNode.js';
import NumericTypeNode from '../src/dex/datamodel/node/data/NumericTypeNode.js';
import AliasTypeNode from '../src/dex/datamodel/node/data/AliasTypeNode.js';
import { EnumTypeNode } from '../src/dex/datamodel/node/data/EnumTypeNode.js';
import { BusNode } from '../src/dex/datamodel/node/data/BusNode.js';
import { ConnectionBusNode } from '../src/dex/datamodel/node/data/ConnectionBusNode.js';
import { ServiceBusNode } from '../src/dex/datamodel/node/data/ServiceBusNode.js';

// Build the raw Simulink-object value wrapper a node's static parse() expects,
// with a single element carrying the given _properties.
function rawVal(className: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: className,
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

// The elements wrapper for a bus-like node (Elements_internal).
function elementsInternal(elementClass: string, elems: Record<string, unknown>[]): Record<string, unknown> {
  return {
    _array_class: elementClass,
    _dimensions: [elems.length, 1],
    _mw_element_type: 'MATLABArray',
    _elements: elems.map((p) => ({ _properties: p })),
  };
}

describe('ValueType DataType column', () => {
  it('defaults to "double" when the DataType property is missing', () => {
    const node = ValueTypeNode.parse(rawVal('Simulink.ValueType', {}), 'VT', null);
    const row = node.toRow()!;
    expect(row.DataType).toBe('double');
    // The Value column is empty and not editable.
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('maps the DataType column to the DataType property when present', () => {
    const node = ValueTypeNode.parse(rawVal('Simulink.ValueType', { DataType: 'uint32' }), 'VT', null);
    expect(node.toRow()!.DataType).toBe('uint32');
  });

  it('surfaces the mapped DataType even when the systemcomposer arch kind is set', () => {
    // The arch kind ("ValueType") classifies the node, but the DataType column
    // shows the underlying data type, not the kind.
    const node = ValueTypeNode.parse(rawVal('Simulink.ValueType', { DataType: 'single' }), 'VT', null);
    node.archKind = 'ValueType';
    expect(node.toRow()!.DataType).toBe('single');
  });
});

describe('NumericType / AliasType Value column', () => {
  it('NumericType shows an empty, non-editable Value', () => {
    const node = NumericTypeNode.parse(rawVal('Simulink.NumericType', {}), 'NT', null);
    const row = node.toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('AliasType shows an empty, non-editable Value and its base type in DataType', () => {
    const node = AliasTypeNode.parse(rawVal('Simulink.AliasType', { BaseType: 'double' }), 'AT', null);
    const row = node.toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
    expect(row.DataType).toBe('double');
  });
});

describe('EnumType children (EnumItem)', () => {
  it('renders an empty DataType column (not applicable)', () => {
    const enumerals = {
      _array_type: 'Struct',
      _dimensions: [2, 1],
      _fields: ['Name', 'Value', 'Description'],
      _elements: [
        { Name: 'red', Value: 0, Description: '' },
        { Name: 'green', Value: 1, Description: '' },
      ],
    };
    const node = EnumTypeNode.parse(rawVal('Simulink.data.dictionary.EnumTypeDefinition', { Enumerals: enumerals }), 'Color', null);
    expect(node.children.length).toBe(2);
    for (const child of node.children) {
      expect(child.toRow()!.DataType).toBe('');
    }
    // The enumeral's Value is still shown.
    expect(node.children[0].toRow()!.Value).toBe('0');
  });
});

describe('systemcomposer arch kind in the DataType column', () => {
  it('shows the arch kind for a DataInterface (derived Simulink.Bus)', () => {
    const node = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'IF', null);
    node.archKind = 'DataInterface';
    expect(node.toRow()!.DataType).toBe('DataInterface');
  });

  it('shows "StructType" and marks isStructType for a struct-classified Bus', () => {
    const node = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'S', null);
    node.archKind = 'StructType';
    node.isStructType = true;
    expect(node.toRow()!.DataType).toBe('StructType');
    expect(node.icon).toBe('typeStruct');
  });

  it('falls back to the class dataType when no arch kind is set', () => {
    const node = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'B', null);
    expect(node.toRow()!.DataType).toBe('Simulink.Bus');
  });
});

describe('bus element DataType mapping', () => {
  it('DataInterface child maps DataType to DataType_internal (default double)', () => {
    const node = BusNode.parse(
      rawVal('Simulink.Bus', {
        Elements_internal: elementsInternal('Simulink.BusElement', [
          { Name: 'a' },
          { Name: 'b', DataType_internal: 'int8' },
        ]),
      }),
      'IF',
      null,
    );
    const [a, b] = node.children;
    expect(a.toRow()!.DataType).toBe('double');
    expect(b.toRow()!.DataType).toBe('int8');
  });

  it('PhysicalInterface child maps DataType to Type_internal (default connection domain)', () => {
    const node = ConnectionBusNode.parse(
      rawVal('Simulink.ConnectionBus', {
        Elements_internal: elementsInternal('Simulink.ConnectionElement', [
          { Name: 'p' },
          { Name: 'q', Type_internal: 'foundation.electrical.electrical' },
        ]),
      }),
      'PH',
      null,
    );
    const [p, q] = node.children;
    expect(p.toRow()!.DataType).toBe('Connection: <domain name>');
    expect(q.toRow()!.DataType).toBe('foundation.electrical.electrical');
  });

  it('ServiceInterface child (FunctionElement) shows Prototype as Value and empty DataType', () => {
    const node = ServiceBusNode.parse(
      rawVal('Simulink.ServiceBus', {
        Elements_internal: elementsInternal('Simulink.FunctionElement', [{ Name: 'f', Prototype: 'y = f(u,v)' }]),
      }),
      'SVC',
      null,
    );
    const [f] = node.children;
    const row = f.toRow()!;
    expect(row.Value).toBe('y = f(u,v)');
    expect(row.DataType).toBe('');
    expect(f.icon).toBe('function');
  });
});
