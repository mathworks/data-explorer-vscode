// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import ValueTypeNode from '../../src/dex/datamodel/node/data/ValueTypeNode.js';
import AliasTypeNode from '../../src/dex/datamodel/node/data/AliasTypeNode.js';
import NumericTypeNode from '../../src/dex/datamodel/node/data/NumericTypeNode.js';
import { EnumTypeNode } from '../../src/dex/datamodel/node/data/EnumTypeNode.js';
import { BusNode } from '../../src/dex/datamodel/node/data/BusNode.js';
import { ConnectionBusNode } from '../../src/dex/datamodel/node/data/ConnectionBusNode.js';
import { ServiceBusNode } from '../../src/dex/datamodel/node/data/ServiceBusNode.js';
import '../../src/dex/datamodel/node/NodeClassMap.js';

// Every schema-driven class opens with a common, fixed-name "General" identity
// group [Name, (Value,) (DataType/BaseType,) Kind, Class] — a deliberate
// divergence from the MATLAB entry-adapter '<Class>: <name>' dynamic title, so a
// file-viewer user always sees the object's Kind and Class explicitly. Value
// semantics (Dimensions/Complexity/fixed-point/enumValue) live in "Value
// Properties"; code-gen attributes in "Code Generation"/"Custom Attributes".
// This pins the group structure per migrated class.

function groups(node: any): string[] {
  const pi = node.toPIObject();
  return (pi.propertySheet.groups as any[]).map((g) => g.displayName);
}
function itemsIn(node: any, groupTitle: string): string[] {
  const pi = node.toPIObject();
  const g = (pi.propertySheet.groups as any[]).find((x) => x.displayName === groupTitle)!;
  return g.items.map((it: any) => it.name);
}

describe('PI layout — common "General" identity group', () => {
  it('ValueType: General [Name, DataType, Kind, Class] + Value Properties', () => {
    const n = ValueTypeNode.createDefault('vt', null);
    expect(groups(n)).toEqual(['General', 'Value Properties']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'DataType', 'Kind', 'Class']);
    expect(itemsIn(n, 'Value Properties')).toEqual([
      'dimensions', 'complexity', 'Min', 'Max', 'Unit', 'dimensionsMode', 'Description',
    ]);
  });

  it('AliasType: General uses BaseType (no DataType) + Value + Code Generation', () => {
    const n = AliasTypeNode.createDefault('at', null);
    expect(groups(n)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'BaseType', 'Kind', 'Class']);
    expect(itemsIn(n, 'Code Generation')).toEqual(['dataScope', 'headerFile']);
  });

  it('NumericType: General is identity-only; fixed-point items in Value Properties', () => {
    const n = NumericTypeNode.createDefault('nt', null);
    expect(groups(n)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Kind', 'Class']);
    expect(itemsIn(n, 'Value Properties')).toEqual([
      'dataTypeMode', 'signedness', 'wordLength', 'fractionLength', 'slope', 'bias', 'dataTypeOverride', 'isAlias', 'Description',
    ]);
  });

  it('EnumType: General is identity-only; enumValue in Value Properties', () => {
    const n = EnumTypeNode.createDefault('et', null);
    // The enum carries an unmodeled Enumerals bag → an "Other" group also appears.
    expect(groups(n).slice(0, 3)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Kind', 'Class']);
    expect(itemsIn(n, 'Value Properties')).toEqual(['Value', 'storageType', 'Description']);
  });

  it('Simulink.Bus: General identity-only + top-level-sourced Code Generation', () => {
    const n = BusNode.createDefault('b', null);
    expect(groups(n).slice(0, 3)).toEqual(['General', 'Value Properties', 'Code Generation']);
    expect(itemsIn(n, 'General')).toEqual(['Name', 'Kind', 'Class']);
    expect(itemsIn(n, 'Code Generation')).toEqual([
      'dataScope', 'headerFile', 'alignment', 'preserveElementDimensions',
    ]);
  });

  it('ConnectionBus / ServiceBus: General + Value Properties (no code-gen attrs)', () => {
    expect(groups(ConnectionBusNode.createDefault('cb', null)).slice(0, 2)).toEqual(['General', 'Value Properties']);
    expect(groups(ServiceBusNode.createDefault('sb', null)).slice(0, 2)).toEqual(['General', 'Value Properties']);
    expect(itemsIn(ConnectionBusNode.createDefault('cb', null), 'General')).toEqual(['Name', 'Kind', 'Class']);
  });
});
