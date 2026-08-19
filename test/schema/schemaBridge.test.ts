// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { buildPILayout, schemaColumns } from '../../src/dex/datamodel/node/schemaBridge.js';

// A minimal stand-in for a node: only `serial._properties` is read by the bridge.
function fakeNode(properties: Record<string, unknown>): any {
  return { serial: { _properties: properties }, className: 'Simulink.Parameter' };
}

describe('buildPILayout — declarative PI layout from schema', () => {
  it('builds the class layout: groups + order from schema, curated atoms + schema props resolved', () => {
    const layout = buildPILayout('Simulink.Parameter')!;
    // A common, fixed-name "General" identity group opens every schema class,
    // then the message-catalog groups. Dimensions/Complexity live INSIDE Value
    // Properties; custom code-gen attributes get their own Custom Attributes group.
    expect(layout.map((g) => g.group)).toEqual([
      'General',
      'Value Properties',
      'Code Generation',
      'Custom Attributes',
    ]);
    // Atom keys resolve to the atom's own display key (e.g. 'value' → 'Value',
    // 'kind' → 'Kind', 'class' → 'Class'); schema keys keep their registry key.
    const keys = layout.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toEqual([
      'Name', 'Value', 'DataType', 'Kind', 'Class',
      'dimensions', 'complexity', 'Min', 'Max', 'storedIntMin', 'storedIntMax', 'Unit', 'Description',
      'storageClass', 'identifier', 'alignment',
      'headerFile', 'definitionFile', 'owner', 'preserveDimensions', 'structName', 'getFunction', 'setFunction',
    ]);
  });

  it('schema-resolved items are read-only labels with the schema label as displayName', () => {
    const items = buildPILayout('Simulink.Parameter')!.flatMap((g) => g.items);
    const storage = items.find((i) => i.key === 'storageClass')!;
    expect(storage.displayName).toBe('Storage Class');
    expect(storage.editor).toBe('label');
    expect(storage.column).toBeNull();
  });

  it('schema-resolved readValue hydrates from serial._properties, filling the default when omitted', () => {
    const items = buildPILayout('Simulink.Parameter')!.flatMap((g) => g.items);
    const storage = items.find((i) => i.key === 'storageClass')!;
    const alignment = items.find((i) => i.key === 'alignment')!;
    expect(storage.readValue!(fakeNode({ Value: 1 }))).toBe('Auto');
    expect(alignment.readValue!(fakeNode({ Value: 1 }))).toBe('-1');
    const withCoder = fakeNode({
      CoderInfo: { _elements: [{ _properties: { StorageClass: 'ExportedGlobal', Alignment: { _type: 'int32', _value: '8' } } }] },
    });
    expect(storage.readValue!(withCoder)).toBe('ExportedGlobal');
    expect(alignment.readValue!(withCoder)).toBe('8');
  });

  it('returns null for a class with no schema layout', () => {
    expect(buildPILayout('Simulink.NotAThing')).toBeNull();
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

  it('the Header File column is a read-only label; the PI item is column-less', () => {
    const hf = schemaColumns('Simulink.Parameter').find((c) => c.key === 'headerFile')!;
    expect(hf.displayName).toBe('Header File');
    expect(hf.editor).toBe('label');
    const piHf = buildPILayout('Simulink.Parameter')!.flatMap((g) => g.items).find((i) => i.key === 'headerFile')!;
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
