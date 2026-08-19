// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { BusElementNode } from '../src/dex/datamodel/node/data/BusNode.js';
import { ConnectionBusElementNode } from '../src/dex/datamodel/node/data/ConnectionBusNode.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

// Regression: bus/connection elements store their name under the raw 'Name' key
// and read type/min/max through '*_internal' aliased keys. The PI "Other"
// catch-all must treat all of those as already surfaced by the curated layout,
// never re-listing them (and never exposing the internal '*_internal' spellings).

function otherNames(node: any): string[] {
  const pi = node.toPIObject();
  const group = (pi.propertySheet.groups as any[]).find((g) => g.displayName === 'Other');
  return group ? group.items.map((i: any) => i.name) : [];
}

describe('PI "Other" — bus element raw-key dedup', () => {
  it('BusElementNode does not leak Name or *_internal aliases into "Other"', () => {
    const props = {
      Name: 'sig1',
      DataType_internal: 'int32',
      Min_internal: 0,
      Max_internal: 100,
      DocUnits: 'm/s',
      Description: 'an element',
      // A genuinely-unmodeled key must still surface.
      SampleTime: -1,
    };
    const serial = { _rawElem: { _id: '1', _properties: props }, _properties: props };
    const node: any = new BusElementNode('sig1', null, props as any, serial as any);
    const names = otherNames(node);
    expect(names).not.toContain('Other.Name');
    expect(names).not.toContain('Other.DataType_internal');
    expect(names).not.toContain('Other.Min_internal');
    expect(names).not.toContain('Other.Max_internal');
    expect(names).not.toContain('Other.DocUnits');
    expect(names).not.toContain('Other.Description');
    // The unmodeled key is still shown.
    expect(names).toContain('Other.SampleTime');
  });

  it('ConnectionBusElementNode does not leak Name or Type_internal into "Other"', () => {
    const props = {
      Name: 'c1',
      Type_internal: 'Connection: elec',
      Description: '',
      TargetUserData: 'x',
    };
    const serial = { _rawElem: { _id: '1', _properties: props }, _properties: props };
    const node: any = new ConnectionBusElementNode('c1', null, props as any, serial as any);
    const names = otherNames(node);
    expect(names).not.toContain('Other.Name');
    expect(names).not.toContain('Other.Type_internal');
    expect(names).toContain('Other.TargetUserData');
  });

  it('the widened sourceKeys clone still reads/formats the curated value correctly', () => {
    // Object.create-based clone must preserve the atom's readValue/format.
    const props = { Name: 'sig1', Min_internal: 5, Max_internal: 9 };
    const serial = { _rawElem: { _id: '1', _properties: props }, _properties: props };
    const node: any = new BusElementNode('sig1', null, props as any, serial as any);
    const pi = node.toPIObject();
    const obj = pi.objects[0];
    // Curated Min/Max still display their values (proving the clone kept format()).
    expect(obj.Min).toBe('5');
    expect(obj.Max).toBe('9');
  });
});
