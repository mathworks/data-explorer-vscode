// Copyright 2026 The MathWorks, Inc.
//
// The write-side mirror of resolveSourcePath: mutate a `_properties` bag along a
// dotted path, descending nested sub-objects (flat MCOS or MATLABArray-wrapped)
// and preserving a typed-scalar leaf's shape.
import { describe, it, expect } from 'vitest';
import { writeSourcePath, resolveSourcePath } from '../../src/dex/datamodel/schema/index.js';

describe('writeSourcePath', () => {
  it('writes a top-level plain leaf', () => {
    const props: any = { Complexity: 'real' };
    expect(writeSourcePath(props, 'Complexity', 'complex')).toBe(true);
    expect(props.Complexity).toBe('complex');
  });

  it('writes into a flat nested sub-object (text-format CoderInfo)', () => {
    const props: any = { CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { StorageClass: 'Auto' } } };
    expect(writeSourcePath(props, 'CoderInfo.StorageClass', 'ExportedGlobal')).toBe(true);
    expect(props.CoderInfo._properties.StorageClass).toBe('ExportedGlobal');
    // resolveSourcePath reads it back through the same descent.
    expect(resolveSourcePath(props, 'CoderInfo.StorageClass')).toBe('ExportedGlobal');
  });

  it('writes into a MATLABArray-wrapped nested sub-object (binary-format CoderInfo)', () => {
    const props: any = { CoderInfo: { _array_class: 'Simulink.CoderInfo', _elements: [{ _properties: { StorageClass: 'Auto' } }] } };
    expect(writeSourcePath(props, 'CoderInfo.StorageClass', 'Custom')).toBe(true);
    expect(props.CoderInfo._elements[0]._properties.StorageClass).toBe('Custom');
    expect(resolveSourcePath(props, 'CoderInfo.StorageClass')).toBe('Custom');
  });

  it('preserves a typed-scalar leaf shape, rewriting only _value (stringified)', () => {
    const props: any = { CoderInfo: { _array_class: 'Simulink.CoderInfo', _elements: [{ _properties: { Alignment: { _type: 'int32', _value: '-1' } } }] } };
    expect(writeSourcePath(props, 'CoderInfo.Alignment', 8)).toBe(true);
    const leaf = props.CoderInfo._elements[0]._properties.Alignment;
    expect(leaf).toEqual({ _type: 'int32', _value: '8' });
    // resolveSourcePath unwraps int32 → Number.
    expect(resolveSourcePath(props, 'CoderInfo.Alignment')).toBe(8);
  });

  it('adds an omitted leaf as a plain value (text CoderInfo without Alignment)', () => {
    const props: any = { CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { StorageClass: 'Auto' } } };
    expect(writeSourcePath(props, 'CoderInfo.Alignment', 8)).toBe(true);
    expect(props.CoderInfo._properties.Alignment).toBe(8);
  });

  it('refuses (returns false, no mutation) when an intermediate sub-object is absent', () => {
    const props: any = { Value: 1 };
    const before = JSON.stringify(props);
    expect(writeSourcePath(props, 'CoderInfo.StorageClass', 'Custom')).toBe(false);
    expect(JSON.stringify(props)).toBe(before);
  });

  it('returns false for an undefined bag', () => {
    expect(writeSourcePath(undefined, 'CoderInfo.StorageClass', 'x')).toBe(false);
  });
});
