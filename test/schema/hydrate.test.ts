// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { getSchema, hydrate } from '../../src/dex/datamodel/schema/index.js';

describe('hydrate — fill omitted defaults for display', () => {
  const schema = getSchema('Simulink.Parameter')!;
  const byKey = (k: string) => schema.find(p => p.key === k)!;

  it('returns the present value when the property exists', () => {
    const props = { CoderInfo: { _properties: { StorageClass: 'ExportedGlobal' } } };
    expect(hydrate(props, byKey('storageClass'))).toBe('ExportedGlobal');
  });

  it('fills the default when a nested property is omitted (JSON minimized form)', () => {
    const jsonForm = { Value: 9.81 }; // CoderInfo entirely omitted, as JSON may do
    expect(hydrate(jsonForm, byKey('storageClass'))).toBe('Auto');
    expect(hydrate(jsonForm, byKey('alignment'))).toBe(-1);
  });

  it('matches the binary form that stores the default explicitly', () => {
    const jsonForm = { Value: 9.81 };
    const binaryForm = { Value: 9.81, CoderInfo: { _properties: { StorageClass: 'Auto', Alignment: -1 } } };
    expect(hydrate(jsonForm, byKey('alignment'))).toBe(hydrate(binaryForm, byKey('alignment')));
    expect(hydrate(jsonForm, byKey('storageClass'))).toBe(hydrate(binaryForm, byKey('storageClass')));
  });

  it('returns undefined when absent and no default is declared', () => {
    expect(hydrate({}, byKey('min'))).toBeUndefined();
  });
});
