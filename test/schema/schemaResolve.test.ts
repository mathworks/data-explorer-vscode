// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { getSchema } from '../../src/dex/datamodel/schema/index.js';

describe('getSchema — resolve class reference lists', () => {
  it('resolves a bare ref to its registry descriptor', () => {
    const props = getSchema('Simulink.Parameter')!;
    const value = props.find(p => p.key === 'value')!;
    expect(value).toMatchObject({ key: 'value', label: 'Value', sourcePath: 'Value', editor: 'text' });
  });

  it('preserves reference order', () => {
    const props = getSchema('Simulink.Parameter')!;
    expect(props.map(p => p.key).slice(0, 3)).toEqual(['value', 'dataType', 'description']);
  });

  it('resolves a nested code-gen prop with its seeded default', () => {
    const props = getSchema('Simulink.Parameter')!;
    const alignment = props.find(p => p.key === 'alignment')!;
    expect(alignment).toMatchObject({ sourcePath: 'CoderInfo.Alignment', default: -1, group: 'Code Generation' });
  });

  it('applies a $ref override without mutating the shared registry', () => {
    const sig = getSchema('Simulink.Signal')!.find(p => p.key === 'dataType')!;
    expect(sig.default).toBe('auto');
    const param = getSchema('Simulink.Parameter')!.find(p => p.key === 'dataType')!;
    expect(param.default).toBe(''); // registry default unchanged
  });

  it('returns undefined for an unregistered class', () => {
    expect(getSchema('Simulink.NotAThing')).toBeUndefined();
  });
});
