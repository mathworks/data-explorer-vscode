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

describe('resolveSourcePath — real parsed shapes', () => {
  it('descends a MATLABArray-wrapped sub-object (_elements[0]._properties)', () => {
    const props = {
      Value: 9.81,
      CoderInfo: {
        _array_class: 'Simulink.CoderInfo',
        _mw_element_type: 'MATLABArray',
        _dimensions: [1, 1],
        _elements: [{ _properties: { StorageClass: 'ExportedGlobal', Alignment: { _type: 'int32', _value: '8' } } }],
      },
    };
    expect(resolveSourcePath(props, 'CoderInfo.StorageClass')).toBe('ExportedGlobal');
  });

  it('unwraps a typed-scalar leaf {_type,_value} to a coerced number', () => {
    const props = {
      CoderInfo: { _elements: [{ _properties: { Alignment: { _type: 'int32', _value: '-1' } } }] },
    };
    expect(resolveSourcePath(props, 'CoderInfo.Alignment')).toBe(-1);
  });

  it('leaves a non-numeric typed-scalar as its raw string value', () => {
    const props = { DataType: { _type: 'char', _value: 'double' } };
    expect(resolveSourcePath(props, 'DataType')).toBe('double');
  });

  it('returns undefined for a missing key inside a MATLABArray-wrapped sub-object', () => {
    const props = { CoderInfo: { _elements: [{ _properties: { StorageClass: 'Auto' } }] } };
    expect(resolveSourcePath(props, 'CoderInfo.DataScope')).toBeUndefined();
  });
});
