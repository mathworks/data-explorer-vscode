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
import StructNode from '../src/dex/datamodel/node/data/StructNode.js';
import SignalNode from '../src/dex/datamodel/node/data/SignalNode.js';
import BreakpointNode from '../src/dex/datamodel/node/data/BreakpointNode.js';
import LookupTableNode from '../src/dex/datamodel/node/data/LookupTableNode.js';
import VariantConfigurationDataNode from '../src/dex/datamodel/node/data/VariantConfigurationDataNode.js';
import ConfigSetNode from '../src/dex/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../src/dex/datamodel/node/data/ConfigSetRefNode.js';
import type DataNode from '../src/dex/datamodel/node/DataNode.js';
// Registers the node class map so StructNode.parse can recurse into field values.
import { parseValue } from '../src/dex/datamodel/node/NodeClassMap.js';

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

  it('surfaces the mapped DataType even when a classification is set', () => {
    // The classification ("ValueType") sets the node's Kind, but the DataType
    // column shows the underlying data type, not the kind.
    const node = ValueTypeNode.parse(rawVal('Simulink.ValueType', { DataType: 'single' }), 'VT', null);
    node.classification = 'ValueType';
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

describe('EnumType child (EnumItem) icons', () => {
  function makeEnum(defaultValue: string, derived = false): EnumTypeNode {
    const enumerals = {
      _array_type: 'Struct',
      _dimensions: [2, 1],
      _fields: ['Name', 'Value', 'Description'],
      _elements: [
        { Name: 'red', Value: 0, Description: '' },
        { Name: 'green', Value: 1, Description: '' },
      ],
    };
    const props: Record<string, unknown> = { Enumerals: enumerals };
    if (defaultValue) props.DefaultValue = defaultValue;
    const node = EnumTypeNode.parse(rawVal('Simulink.data.dictionary.EnumTypeDefinition', props), 'Color', null);
    if (derived) node.metadata = { isderived: '1' };
    return node;
  }

  it('Design Data: the enumeral matching DefaultValue uses wsElement, others busElement', () => {
    const [red, green] = makeEnum('green').children;
    expect(red.icon).toBe('busElement');
    expect(green.icon).toBe('wsElement');
  });

  it('Design Data: with no DefaultValue, the first enumeral is current (wsElement)', () => {
    const [red, green] = makeEnum('').children;
    expect(red.icon).toBe('wsElement');
    expect(green.icon).toBe('busElement');
  });

  it('Architectural Data (derived): the current enumeral uses typeElement', () => {
    const [red, green] = makeEnum('green', true).children;
    expect(red.icon).toBe('busElement');
    expect(green.icon).toBe('typeElement');
  });
});

// The DataType column shows a real data type only. It never surfaces the node's
// Class (the class-identity dataType, e.g. 'Simulink.Bus') or its architectural
// Kind (classification, e.g. 'DataInterface') — those are distinct concepts with
// their own columns. The Class and Kind are still retained on the node for that use.
describe('Class and Kind are suppressed from the DataType column', () => {
  it('shows an empty DataType for a DataInterface (derived Simulink.Bus), keeping the Kind on the node', () => {
    const node = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'IF', null);
    node.classification = 'DataInterface';
    expect(node.toRow()!.DataType).toBe('');
    // The classification and Class (className) are still available on the model.
    expect(node.classification).toBe('DataInterface');
    expect(node.className).toBe('Simulink.Bus');
  });

  it('shows an empty DataType for a struct-classified Bus but still marks isStructType', () => {
    const node = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'S', null);
    node.classification = 'StructType';
    node.isStructType = true;
    expect(node.toRow()!.DataType).toBe('');
    expect(node.icon).toBe('typeStruct');
  });

  it('shows an empty DataType (not the Class name) for a plain Design Data Bus', () => {
    const node = BusNode.parse(rawVal('Simulink.Bus', { Elements_internal: [] }), 'B', null);
    expect(node.toRow()!.DataType).toBe('');
    expect(node.className).toBe('Simulink.Bus');
  });

  it('shows an empty DataType for EnumType, NumericType and ServiceBus (all Class-only)', () => {
    const en = EnumTypeNode.parse(
      rawVal('Simulink.data.dictionary.EnumTypeDefinition', {
        Enumerals: { _array_type: 'Struct', _dimensions: [1, 1], _fields: ['Name', 'Value', 'Description'], _elements: [{ Name: 'red', Value: 0, Description: '' }] },
      }),
      'Color',
      null,
    );
    expect(en.toRow()!.DataType).toBe('');
    const nt = NumericTypeNode.parse(rawVal('Simulink.NumericType', {}), 'NT', null);
    expect(nt.toRow()!.DataType).toBe('');
    const svc = ServiceBusNode.parse(rawVal('Simulink.ServiceBus', { Elements_internal: [] }), 'SVC', null);
    expect(svc.toRow()!.DataType).toBe('');
  });
});

describe('bus element icons (Design Data vs Architectural Data)', () => {
  function derive<T extends { metadata: Record<string, unknown> | null }>(node: T): T {
    node.metadata = { isderived: '1' };
    return node;
  }

  it('a plain Design Data Bus element uses wsBusElement', () => {
    const node = BusNode.parse(
      rawVal('Simulink.Bus', { Elements_internal: elementsInternal('Simulink.BusElement', [{ Name: 'a' }]) }),
      'B',
      null,
    );
    expect(node.children[0].icon).toBe('wsBusElement');
  });

  it('a derived DataInterface element uses typeBusElement', () => {
    const node = derive(
      BusNode.parse(
        rawVal('Simulink.Bus', { Elements_internal: elementsInternal('Simulink.BusElement', [{ Name: 'a' }]) }),
        'IF',
        null,
      ),
    );
    expect(node.children[0].icon).toBe('typeBusElement');
  });

  it('a StructType element uses typeStructElement (regardless of ws/type)', () => {
    const node = derive(
      BusNode.parse(
        rawVal('Simulink.Bus', { Elements_internal: elementsInternal('Simulink.BusElement', [{ Name: 'a' }]) }),
        'S',
        null,
      ),
    );
    node.isStructType = true;
    expect(node.children[0].icon).toBe('typeStructElement');
  });

  it('a plain Design Data ConnectionBus element uses wsConnectionElement', () => {
    const node = ConnectionBusNode.parse(
      rawVal('Simulink.ConnectionBus', {
        Elements_internal: elementsInternal('Simulink.ConnectionElement', [{ Name: 'p' }]),
      }),
      'C',
      null,
    );
    expect(node.children[0].icon).toBe('wsConnectionElement');
  });

  it('a derived PhysicalInterface element uses typeConnectionElement', () => {
    const node = derive(
      ConnectionBusNode.parse(
        rawVal('Simulink.ConnectionBus', {
          Elements_internal: elementsInternal('Simulink.ConnectionElement', [{ Name: 'p' }]),
        }),
        'PH',
        null,
      ),
    );
    expect(node.children[0].icon).toBe('typeConnectionElement');
  });
});

describe('bus element Name is editable (normal color, not grayed)', () => {
  it('a Design Data Bus element reports an editable Name', () => {
    const node = BusNode.parse(
      rawVal('Simulink.Bus', { Elements_internal: elementsInternal('Simulink.BusElement', [{ Name: 'a' }]) }),
      'B',
      null,
    );
    const row = node.children[0].toRow()!;
    expect((row.Name as { editable?: boolean }).editable).toBe(true);
  });

  it('a derived DataInterface Bus element also reports an editable Name', () => {
    const node = BusNode.parse(
      rawVal('Simulink.Bus', { Elements_internal: elementsInternal('Simulink.BusElement', [{ Name: 'a' }]) }),
      'IF',
      null,
    );
    node.metadata = { isderived: '1' };
    const row = node.children[0].toRow()!;
    expect((row.Name as { editable?: boolean }).editable).toBe(true);
  });
});

// These object types have no meaningful scalar value: the Value column is left
// empty (no "<1x1 Simulink.X>" placeholder) and is not editable.
describe('object nodes with no scalar value: empty, non-editable Value', () => {
  it('Signal shows an empty, non-editable Value', () => {
    const row = SignalNode.parse(rawVal('Simulink.Signal', {}), 'sig', null).toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('Breakpoint shows an empty, non-editable Value', () => {
    const row = BreakpointNode.parse(rawVal('Simulink.Breakpoint', {}), 'bp', null).toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('LookupTable shows an empty, non-editable Value', () => {
    const row = LookupTableNode.parse(rawVal('Simulink.LookupTable', {}), 'lut', null).toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('VariantConfiguration shows an empty, non-editable Value', () => {
    const row = VariantConfigurationDataNode.parse(rawVal('Simulink.VariantConfigurationData', { Value: 'foo' }), 'vc', null).toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('a Simulink.VariantConfigurations container parses to an empty, non-editable Value and keeps its class identity', () => {
    // The on-disk entry's class is the plural container 'Simulink.VariantConfigurations',
    // which routes to the same node. It must not fall through to ObjectNode's
    // "<1x1 ...>" placeholder.
    const node = parseValue(rawVal('Simulink.VariantConfigurations', {}), 'VariantConfigurations', null) as DataNode;
    const row = node.toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
    expect(node.className).toBe('Simulink.VariantConfigurations');
    expect(node.kind).toBe('Variant Configuration');
  });

  it('ConfigSet shows an empty, non-editable Value', () => {
    const row = ConfigSetNode.parse(rawVal('Simulink.ConfigSet', { Name: 'Configuration' }), 'cfg', null).toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('ConfigSetRef shows an empty, non-editable Value', () => {
    const row = ConfigSetRefNode.parse(rawVal('Simulink.ConfigSetRef', { SourceName: 'src' }), 'ref', null).toRow()!;
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });
});

describe('real data types remain in the DataType column', () => {
  it('a struct variable shows "struct"', () => {
    const node = StructNode.parse(
      { _array_type: 'Struct', _dimensions: [1, 1], _fields: ['a'], _elements: [{ a: 1 }] },
      'S',
      null,
    );
    expect(node.toRow()!.DataType).toBe('struct');
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
