// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { resolveSourcePath } from '../../src/dex/datamodel/schema/index.js';

describe('resolveSourcePath — read a dotted path from a _properties bag', () => {
  const props = {
    Value: 9.81,
    DataType: 'double',
    CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { StorageClass: 'ExportedGlobal', Alignment: 8 } },
  };

  it('reads a top-level property', () => {
    expect(resolveSourcePath(props, 'Value')).toBe(9.81);
  });

  it('reads a nested property through the inner _properties', () => {
    expect(resolveSourcePath(props, 'CoderInfo.StorageClass')).toBe('ExportedGlobal');
    expect(resolveSourcePath(props, 'CoderInfo.Alignment')).toBe(8);
  });

  it('returns undefined when a top-level key is missing', () => {
    expect(resolveSourcePath(props, 'Min')).toBeUndefined();
  });

  it('returns undefined when a nested key is missing', () => {
    expect(resolveSourcePath(props, 'CoderInfo.DataScope')).toBeUndefined();
  });

  it('returns undefined when an intermediate object is missing', () => {
    expect(resolveSourcePath({ Value: 1 }, 'CoderInfo.StorageClass')).toBeUndefined();
  });
});
