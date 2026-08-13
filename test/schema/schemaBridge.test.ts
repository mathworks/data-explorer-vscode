// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { schemaPILayout } from '../../src/dex/datamodel/node/schemaBridge.js';

// A minimal stand-in for a node: only `serial._properties` is read by the bridge.
function fakeNode(properties: Record<string, unknown>): any {
  return { serial: { _properties: properties }, className: 'Simulink.Parameter' };
}

describe('schemaPILayout — bridge schema props into PI groups', () => {
  it('returns only read-only grouped props, grouped by `group`', () => {
    const layout = schemaPILayout('Simulink.Parameter');
    const groups = layout.map((g) => g.group);
    expect(groups).toEqual(['Data Object', 'Code Generation']);
    const keys = layout.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toEqual(['dimensions', 'complexity', 'storageClass', 'alignment']);
    expect(keys).not.toContain('min');
    expect(keys).not.toContain('value');
  });

  it('bridged items are read-only (editor label) with the schema label as displayName', () => {
    const items = schemaPILayout('Simulink.Parameter').flatMap((g) => g.items);
    const storage = items.find((i) => i.key === 'storageClass')!;
    expect(storage.displayName).toBe('Storage Class');
    expect(storage.editor).toBe('label');
    expect(storage.column).toBeNull();
  });

  it('readValue hydrates from serial._properties, filling the default when omitted', () => {
    const storage = schemaPILayout('Simulink.Parameter').flatMap((g) => g.items).find((i) => i.key === 'storageClass')!;
    const alignment = schemaPILayout('Simulink.Parameter').flatMap((g) => g.items).find((i) => i.key === 'alignment')!;
    expect(storage.readValue!(fakeNode({ Value: 1 }))).toBe('Auto');
    expect(alignment.readValue!(fakeNode({ Value: 1 }))).toBe('-1');
    const withCoder = fakeNode({
      CoderInfo: { _elements: [{ _properties: { StorageClass: 'ExportedGlobal', Alignment: { _type: 'int32', _value: '8' } } }] },
    });
    expect(storage.readValue!(withCoder)).toBe('ExportedGlobal');
    expect(alignment.readValue!(withCoder)).toBe('8');
  });

  it('returns [] for a class with no schema', () => {
    expect(schemaPILayout('Simulink.NotAThing')).toEqual([]);
  });
});
