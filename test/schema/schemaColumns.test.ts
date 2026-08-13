// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../../src/dex/datamodel/node/data/ParameterNode.js';
import SignalNode from '../../src/dex/datamodel/node/data/SignalNode.js';

describe('toRow emits schema columns for Parameter/Signal', () => {
  it('ParameterNode.toRow includes storageClass/alignment/dimensions/complexity', () => {
    const row: any = ParameterNode.createDefault('p', null).toRow();
    expect(row.storageClass).toBe('Auto');
    expect(row.alignment).toBe('-1');
    expect(row.complexity).toBe('real');
    expect('dimensions' in row).toBe(true);
  });

  it('the schema columns are read-only in getProperties (column === key, editor label)', () => {
    const node = ParameterNode.createDefault('p', null);
    const props = node.getProperties();
    const storage = props.find((p: any) => p.key === 'storageClass')!;
    expect(storage.column).toBe('storageClass');
    expect(storage.editor).toBe('label');
  });

  it('SignalNode.toRow also emits storageClass', () => {
    const row: any = SignalNode.createDefault('s', null).toRow();
    expect(row.storageClass).toBe('Auto');
  });

  it('the legacy columns are still emitted (no regression)', () => {
    const row: any = ParameterNode.createDefault('p', null).toRow();
    expect(row.Name).toBeDefined();
    expect('DataType' in row).toBe(true);
  });
});
