// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import '../src/dex/datamodel/node/NodeClassMap.js';
import ModelSectionNode from '../src/dex/datamodel/node/container/ModelSectionNode.js';
import ConfigSetNode from '../src/dex/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../src/dex/datamodel/node/data/ConfigSetRefNode.js';

// The SLX Configurations section and the SLDD path must produce the SAME node
// class for a config set — ConfigSetNode / ConfigSetRefNode — so presentation
// is identical: empty, non-editable Value and Data Type. The SLX-only "active"
// state rides on the shared node and shows up in the icon, not a Value suffix.
// (Previously the SLX path used a separate ModelConfigSetNode that diverged.)
function configSection(): ModelSectionNode {
  return new ModelSectionNode('config', null, 'Configurations', 'databaseFolderConfiguration');
}

describe('SLX config section uses the shared SLDD ConfigSet node classes', () => {
  it('builds a ConfigSetNode with empty, non-editable Value and empty Data Type', () => {
    const section = configSection();
    const node = section.addConfigSetEntry({
      name: 'Configuration',
      active: true,
      data: { _object_class: 'Simulink.ConfigSet' },
    });
    expect(node).toBeInstanceOf(ConfigSetNode);

    const row = node.toRow() as any;
    expect(row.Name?.label ?? row.Name).toBe('Configuration');
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
    expect(row.DataType).toBe('');
  });

  it('routes _object_class Simulink.ConfigSetRef to ConfigSetRefNode', () => {
    const section = configSection();
    const node = section.addConfigSetEntry({
      name: 'RefConfig',
      active: false,
      data: { _object_class: 'Simulink.ConfigSetRef' },
    });
    expect(node).toBeInstanceOf(ConfigSetRefNode);

    const row = node.toRow() as any;
    expect(row.Value).toBe('');
    expect(row.DataType).toBe('');
  });

  it('reflects active state in the icon, not the Value', () => {
    const section = configSection();
    const active = section.addConfigSetEntry({ name: 'A', active: true, data: { _object_class: 'Simulink.ConfigSet' } });
    const inactive = section.addConfigSetEntry({ name: 'B', active: false, data: { _object_class: 'Simulink.ConfigSet' } });
    expect(active.icon).toBe('check_settings');
    expect(inactive.icon).toBe('settings');

    const activeRef = section.addConfigSetEntry({ name: 'R1', active: true, data: { _object_class: 'Simulink.ConfigSetRef' } });
    const inactiveRef = section.addConfigSetEntry({ name: 'R2', active: false, data: { _object_class: 'Simulink.ConfigSetRef' } });
    expect(activeRef.icon).toBe('check_configurationReference');
    expect(inactiveRef.icon).toBe('configurationReference');
  });

  it('defaults to ConfigSetNode when data has no _object_class', () => {
    const section = configSection();
    const node = section.addConfigSetEntry({ name: 'Plain', active: false, data: null });
    expect(node).toBeInstanceOf(ConfigSetNode);
  });
});

// The SLDD path (no active flag) must be unchanged: inactive icon by default.
describe('SLDD ConfigSet nodes are unchanged when active is not set', () => {
  it('ConfigSetNode.parse yields the plain settings icon', () => {
    const rawVal = { _array_class: 'Simulink.ConfigSet', _elements: [{ _properties: { Name: 'C' } }] };
    const node = ConfigSetNode.parse(rawVal, 'C', null);
    expect(node.active).toBeUndefined();
    expect(node.icon).toBe('settings');
  });

  it('ConfigSetRefNode.parse yields the plain configurationReference icon', () => {
    const rawVal = { _array_class: 'Simulink.ConfigSetRef', _elements: [{ _properties: { SourceName: 'src' } }] };
    const node = ConfigSetRefNode.parse(rawVal, 'R', null);
    expect(node.active).toBeUndefined();
    expect(node.icon).toBe('configurationReference');
  });
});
