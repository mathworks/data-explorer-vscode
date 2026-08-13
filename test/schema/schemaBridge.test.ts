// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { schemaPILayout, schemaColumns } from '../../src/dex/datamodel/node/schemaBridge.js';

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
    expect(keys).toEqual(['dimensions', 'complexity', 'storageClass', 'headerFile', 'alignment']);
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

describe('schemaColumns — bridge schema props into table columns', () => {
  it('returns a flat PropClass[] with the column key = prop key', () => {
    const cols = schemaColumns('Simulink.Parameter');
    expect(cols.map((c) => c.key)).toEqual(['dimensions', 'complexity', 'storageClass', 'headerFile', 'alignment']);
    for (const c of cols) {
      expect(c.column).toBe(c.key);
    }
  });

  it('the Header File column is a read-only label under Code Generation', () => {
    const hf = schemaColumns('Simulink.Parameter').find((c) => c.key === 'headerFile')!;
    expect(hf.displayName).toBe('Header File');
    expect(hf.editor).toBe('label');
    const piHf = schemaPILayout('Simulink.Parameter').flatMap((g) => g.items).find((i) => i.key === 'headerFile')!;
    expect(piHf.column).toBeNull();
  });

  it('storageClass is the only editable Code Generation column (select w/ options); alignment is read-only', () => {
    const storage = schemaColumns('Simulink.Parameter').find((c) => c.key === 'storageClass')!;
    expect(storage.displayName).toBe('Storage Class');
    expect(storage.editor).toBe('select');
    expect(storage.readOptions!({} as any)).toContain('ExportedGlobal');
    // Alignment is conservatively read-only (its valid values depend on
    // StorageClass — MATLAB rejects it under 'Auto'), so it renders as a label.
    const alignment = schemaColumns('Simulink.Parameter').find((c) => c.key === 'alignment')!;
    expect(alignment.editor).toBe('label');
    // The Data Object columns stay read-only labels.
    const dims = schemaColumns('Simulink.Parameter').find((c) => c.key === 'dimensions')!;
    expect(dims.editor).toBe('label');
  });

  it('readValue hydrates from serial._properties, filling defaults when omitted', () => {
    const cols = schemaColumns('Simulink.Parameter');
    const storage = cols.find((c) => c.key === 'storageClass')!;
    const alignment = cols.find((c) => c.key === 'alignment')!;
    const node: any = { serial: { _properties: { Value: 1 } }, className: 'Simulink.Parameter' };
    expect(storage.readValue!(node)).toBe('Auto');
    expect(alignment.readValue!(node)).toBe('-1');
  });

  it('returns [] for a class with no schema', () => {
    expect(schemaColumns('Simulink.NotAThing')).toEqual([]);
  });
});
