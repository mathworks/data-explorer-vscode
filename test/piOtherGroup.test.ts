// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/dex/datamodel/node/data/ParameterNode.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

// Build a Parameter whose raw _properties carry an EXTRA unmodeled key on top of
// the seeded default, so the PI "Other" catch-all has something to surface.
function paramWithExtra(extra: Record<string, unknown>): any {
  const node = ParameterNode.createDefault('p', null);
  Object.assign((node as any).serial._properties, extra);
  return node;
}

function groupNames(pi: any): string[] {
  return (pi.propertySheet.groups as any[]).map((g) => g.displayName);
}

function itemsOf(pi: any, groupDisplay: string): { name: string; value: string }[] {
  const group = (pi.propertySheet.groups as any[]).find((g) => g.displayName === groupDisplay)!;
  const obj = (pi.objects as any[])[0];
  return group.items.map((it: any) => ({ name: it.name, value: obj[it.name] }));
}

describe('PI "Other" catch-all group', () => {
  it('appends an "Other" group after the curated groups when unmodeled props exist', () => {
    const node = paramWithExtra({ SomeExtra: 'hi' });
    const pi = node.toPIObject()!;
    expect(groupNames(pi)).toEqual([
      'General',
      'Value Properties',
      'Code Generation',
      'Custom Attributes',
      'Other',
    ]);
  });

  it('lists the unmodeled key in the "Other" group with its raw value', () => {
    const node = paramWithExtra({ SomeExtra: 'hi', DataScope: 'Auto' });
    const pi = node.toPIObject()!;
    const other = itemsOf(pi, 'Other');
    // Namespaced item names avoid colliding with bare group-prop keys.
    expect(other).toEqual(
      expect.arrayContaining([
        { name: 'Other.SomeExtra', value: 'hi' },
        { name: 'Other.DataScope', value: 'Auto' },
      ]),
    );
  });

  it('does NOT re-list properties the curated/schema layout already shows', () => {
    // Value/DataType/Description/Dimensions/Complexity/DocUnits and the whole
    // CoderInfo bag are surfaced by the layout, so none appear under "Other".
    // One genuinely-unmodeled key keeps the "Other" group present to inspect.
    const node = paramWithExtra({ Value: 9.81, DataType: 'double', DocUnits: 'm/s', Leftover: 1 });
    const pi = node.toPIObject()!;
    const other = itemsOf(pi, 'Other').map((r) => r.name);
    expect(other).not.toContain('Other.Value');
    expect(other).not.toContain('Other.DataType');
    expect(other).not.toContain('Other.DocUnits');
    expect(other).not.toContain('Other.CoderInfo.StorageClass');
  });

  it('omits the "Other" group entirely when every raw prop is already shown', () => {
    // The seeded default's raw props (CoderInfo, Complexity, Dimensions, Value)
    // are all surfaced by the layout, so there is nothing left over.
    const node = ParameterNode.createDefault('p', null);
    const pi = node.toPIObject()!;
    expect(groupNames(pi)).not.toContain('Other');
  });

  it('"Other" rows are read-only', () => {
    const node = paramWithExtra({ SomeExtra: 'hi' });
    const pi = node.toPIObject()!;
    const prop = (pi.propertySheet.properties as any[]).find((p) => p.name === 'Other.SomeExtra');
    expect(prop.editable).toBe(false);
  });

  it('the "Other" group is collapsed by default', () => {
    const node = paramWithExtra({ SomeExtra: 'hi' });
    const pi = node.toPIObject()!;
    const group = (pi.propertySheet.groups as any[]).find((g) => g.displayName === 'Other');
    expect(group.expanded).toBe(false);
  });
});
