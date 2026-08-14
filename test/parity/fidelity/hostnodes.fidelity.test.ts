// Copyright 2026 The MathWorks, Inc.
//
// Contract-lock tests for Tier-4 (no-fixture) and Tier-5 (host/graph) nodes.
// These pin the read-only / host status of nodes that have no MATLAB round-trip
// fixture, ensuring a future regression that makes them editable fails here.
// No MATLAB gate needed — these nodes have no round-trip path.
import { describe, it, expect } from 'vitest';
import VariantBankNode from '../../../src/dex/datamodel/node/data/VariantBankNode.js';
import VariantBankCoderInfoNode from '../../../src/dex/datamodel/node/data/VariantBankCoderInfoNode.js';
import VariantConfigurationDataNode from '../../../src/dex/datamodel/node/data/VariantConfigurationDataNode.js';
import ConfigSetNode from '../../../src/dex/datamodel/node/data/ConfigSetNode.js';
import ConfigSetRefNode from '../../../src/dex/datamodel/node/data/ConfigSetRefNode.js';
import CustomObjectNode from '../../../src/dex/datamodel/node/data/CustomObjectNode.js';
import ObjectNode from '../../../src/dex/datamodel/node/data/ObjectNode.js';
import ModelBlockNode from '../../../src/dex/datamodel/node/data/ModelBlockNode.js';
import ModelReferenceNode from '../../../src/dex/datamodel/node/data/ModelReferenceNode.js';
import DataSourceNode from '../../../src/dex/datamodel/node/data/DataSourceNode.js';

// ─── Group A: Tier-4 variant/config nodes (no fixture, contract-lock only) ────

describe('Tier-4 contract-lock: VariantBankNode', () => {
  it('reports className Simulink.VariantBank', () => {
    const node = VariantBankNode.createDefault('vb1', null);
    expect(node.className).toBe('Simulink.VariantBank');
  });

  it('exposes [PropName, PropValue, PropDataType] properties', () => {
    const node = VariantBankNode.createDefault('vb1', null);
    const keys = node.getProperties().map((p) => p.key);
    expect(keys).toEqual(['Name', 'Value', 'DataType']);
  });

  it('has empty-string Value by default', () => {
    const node = VariantBankNode.createDefault('vb1', null);
    expect(node.Value).toBe('');
  });
});

describe('Tier-4 contract-lock: VariantBankCoderInfoNode', () => {
  it('reports className Simulink.VariantBankCoderInfo', () => {
    const node = VariantBankCoderInfoNode.createDefault('vbci1', null);
    expect(node.className).toBe('Simulink.VariantBankCoderInfo');
  });

  it('exposes [PropName, PropValue, PropDataType] properties', () => {
    const node = VariantBankCoderInfoNode.createDefault('vbci1', null);
    const keys = node.getProperties().map((p) => p.key);
    expect(keys).toEqual(['Name', 'Value', 'DataType']);
  });

  it('has empty-string Value by default', () => {
    const node = VariantBankCoderInfoNode.createDefault('vbci1', null);
    expect(node.Value).toBe('');
  });
});

describe('Tier-4 contract-lock: VariantConfigurationDataNode', () => {
  it('reports className Simulink.VariantConfigurationData', () => {
    const node = VariantConfigurationDataNode.createDefault('vcd1', null);
    expect(node.className).toBe('Simulink.VariantConfigurationData');
  });

  it('valueEditable is explicitly false', () => {
    const node = VariantConfigurationDataNode.createDefault('vcd1', null);
    expect(node.valueEditable).toBe(false);
  });

  it('displayValue is empty string', () => {
    const node = VariantConfigurationDataNode.createDefault('vcd1', null);
    expect(node.displayValue).toBe('');
  });

  it('exposes [PropName, PropDataType] properties (no PropValue)', () => {
    const node = VariantConfigurationDataNode.createDefault('vcd1', null);
    const keys = node.getProperties().map((p) => p.key);
    expect(keys).toEqual(['Name', 'DataType']);
  });
});

describe('Tier-4 contract-lock: ConfigSetNode', () => {
  it('reports className Simulink.ConfigSet', () => {
    const node = ConfigSetNode.createDefault('cfg1', null);
    expect(node.className).toBe('Simulink.ConfigSet');
  });

  it('valueEditable is explicitly false', () => {
    const node = ConfigSetNode.createDefault('cfg1', null);
    expect(node.valueEditable).toBe(false);
  });

  it('displayValue is empty string', () => {
    const node = ConfigSetNode.createDefault('cfg1', null);
    expect(node.displayValue).toBe('');
  });

  it('exposes [PropName, PropDataType] properties', () => {
    const node = ConfigSetNode.createDefault('cfg1', null);
    const keys = node.getProperties().map((p) => p.key);
    expect(keys).toEqual(['Name', 'DataType']);
  });

  it('icon is settings (inactive by default)', () => {
    const node = ConfigSetNode.createDefault('cfg1', null);
    expect(node.icon).toBe('settings');
  });
});

describe('Tier-4 contract-lock: ConfigSetRefNode', () => {
  it('reports className Simulink.ConfigSetRef', () => {
    const node = ConfigSetRefNode.createDefault('cfgref1', null);
    expect(node.className).toBe('Simulink.ConfigSetRef');
  });

  it('valueEditable is explicitly false', () => {
    const node = ConfigSetRefNode.createDefault('cfgref1', null);
    expect(node.valueEditable).toBe(false);
  });

  it('displayValue is empty string', () => {
    const node = ConfigSetRefNode.createDefault('cfgref1', null);
    expect(node.displayValue).toBe('');
  });

  it('exposes [PropName, PropDataType] properties', () => {
    const node = ConfigSetRefNode.createDefault('cfgref1', null);
    const keys = node.getProperties().map((p) => p.key);
    expect(keys).toEqual(['Name', 'DataType']);
  });

  it('icon is configurationReference (inactive by default)', () => {
    const node = ConfigSetRefNode.createDefault('cfgref1', null);
    expect(node.icon).toBe('configurationReference');
  });
});

// ─── Group B: Tier-5 host/graph nodes (not Simulink data objects) ─────────────

describe('Tier-5 contract-lock: CustomObjectNode', () => {
  it('reports className CustomObject', () => {
    const node = CustomObjectNode.createDefault('co1', null);
    expect(node.className).toBe('CustomObject');
  });

  it('displayValue renders as <1x1 CustomObject> (triggers valueEditable=false)', () => {
    const node = CustomObjectNode.createDefault('co1', null);
    expect(node.displayValue).toBe('<1x1 CustomObject>');
    expect(node.valueEditable).toBe(false);
  });

  it('exposes [PropName, PropValue, PropDataType, PropDescription] properties', () => {
    const node = CustomObjectNode.createDefault('co1', null);
    const keys = node.getProperties().map((p) => p.key);
    expect(keys).toEqual(['Name', 'Value', 'DataType', 'Description']);
  });
});

describe('Tier-5 contract-lock: ObjectNode', () => {
  it('reports className from arrayClass', () => {
    const node = ObjectNode.parse(
      { _array_class: 'Simulink.SomeUnknown', _dimensions: [1, 1] } as Record<string, unknown>,
      'obj1',
      null,
    );
    expect(node.className).toBe('Simulink.SomeUnknown');
  });

  it('displayValue renders as <1x1 ClassName> (triggers valueEditable=false)', () => {
    const node = ObjectNode.parse(
      { _array_class: 'Simulink.SomeUnknown', _dimensions: [1, 1] } as Record<string, unknown>,
      'obj1',
      null,
    );
    expect(node.displayValue).toBe('<1x1 Simulink.SomeUnknown>');
    expect(node.valueEditable).toBe(false);
  });

  it('serializeValue passes through raw value unchanged', () => {
    const rawVal = { _array_class: 'Simulink.SomeUnknown', _dimensions: [2, 3], _extra: 'data' };
    const node = ObjectNode.parse(rawVal as Record<string, unknown>, 'obj1', null);
    expect(node.serializeValue()).toBe(rawVal);
  });
});

describe('Tier-5 contract-lock: ModelBlockNode', () => {
  it('valueEditable and nameEditable are both false', () => {
    const node = new ModelBlockNode('blk1', null, 'Gain', [{ property: 'K', value: 'myParam' }], 'src1', null);
    expect(node.valueEditable).toBe(false);
    expect(node.nameEditable).toBe(false);
  });

  it('displayValue returns blockType', () => {
    const node = new ModelBlockNode('blk1', null, 'Gain', [], 'src1', null);
    expect(node.displayValue).toBe('Gain');
  });

  it('className shows paramUsages', () => {
    const node = new ModelBlockNode('blk1', null, 'Gain', [{ property: 'K', value: 'myParam' }], 'src1', null);
    expect(node.className).toBe('K=myParam');
  });
});

describe('Tier-5 contract-lock: ModelReferenceNode', () => {
  it('valueEditable and nameEditable are both false', () => {
    const node = new ModelReferenceNode('ref1', null, 'models/submodel.slx');
    expect(node.valueEditable).toBe(false);
    expect(node.nameEditable).toBe(false);
  });

  it('className is Model Reference', () => {
    const node = new ModelReferenceNode('ref1', null, 'models/submodel.slx');
    expect(node.className).toBe('Model Reference');
  });

  it('displayValue returns blockPath', () => {
    const node = new ModelReferenceNode('ref1', null, 'models/submodel.slx');
    expect(node.displayValue).toBe('models/submodel.slx');
  });
});

describe('Tier-5 contract-lock: DataSourceNode', () => {
  it('valueEditable and nameEditable are both false', () => {
    const node = new DataSourceNode('source.sldd', null, '/path/to/source.sldd');
    expect(node.valueEditable).toBe(false);
    expect(node.nameEditable).toBe(false);
  });

  it('className computed from extension (.sldd -> Data Dictionary)', () => {
    expect(new DataSourceNode('a.sldd', null, '/a.sldd').className).toBe('Data Dictionary');
    expect(new DataSourceNode('b.slx', null, '/b.slx').className).toBe('Simulink Model');
    expect(new DataSourceNode('c.mat', null, '/c.mat').className).toBe('MAT File');
  });

  it('displayValue returns fullPath', () => {
    const node = new DataSourceNode('source.sldd', null, '/path/to/source.sldd');
    expect(node.displayValue).toBe('/path/to/source.sldd');
  });
});

// ─── Tier-5 nodes covered by existing tests (SKIP — no duplicate coverage) ───

// mcosTypedNode: factory function, not a node class. Exhaustively tested in
// test/mcosTypedNode.test.ts (routes, empty shells, GENERIC_KEYS exclusion).
// No contract-lock test needed here.

// ProjectItemNode: tree-presentation node. Exhaustively tested in
// test/projectNode.test.ts (section building, row generation, icon mapping,
// column population, element coloring contract). No contract-lock test needed here.
