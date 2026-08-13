// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../../src/dex/datamodel/node/data/ParameterNode.js';
import SignalNode from '../../src/dex/datamodel/node/data/SignalNode.js';

describe('toRow emits schema columns for Parameter/Signal', () => {
  it('ParameterNode.toRow includes storageClass/alignment/dimensions/complexity', () => {
    const row: any = ParameterNode.createDefault('p', null).toRow();
    // storageClass/alignment are editable (object cells); dimensions/complexity
    // stay read-only (plain strings).
    expect(row.storageClass.text).toBe('Auto');
    expect(row.alignment.text).toBe('-1');
    expect(row.complexity).toBe('real');
    expect('dimensions' in row).toBe(true);
  });

  it('the schema Code Generation columns are editable in getProperties (storageClass select, alignment text)', () => {
    const node = ParameterNode.createDefault('p', null);
    const props = node.getProperties();
    const storage = props.find((p: any) => p.key === 'storageClass')!;
    expect(storage.column).toBe('storageClass');
    expect(storage.editor).toBe('select');
    const alignment = props.find((p: any) => p.key === 'alignment')!;
    expect(alignment.editor).toBe('text');
    // The Data Object columns remain read-only labels.
    const dims = props.find((p: any) => p.key === 'dimensions')!;
    expect(dims.editor).toBe('label');
  });

  it('an editable schema cell carries editor + options for the webview', () => {
    const row: any = ParameterNode.createDefault('p', null).toRow();
    expect(row.storageClass.editable).toBe(true);
    expect(row.storageClass.editor).toBe('select');
    expect(row.storageClass.options).toContain('ExportedGlobal');
    expect(row.alignment.editable).toBe(true);
    expect(row.alignment.editor).toBe('text');
  });

  it('SignalNode.toRow also emits an editable storageClass', () => {
    const row: any = SignalNode.createDefault('s', null).toRow();
    expect(row.storageClass.text).toBe('Auto');
    expect(row.storageClass.editable).toBe(true);
  });

  it('the legacy columns are still emitted (no regression)', () => {
    const row: any = ParameterNode.createDefault('p', null).toRow();
    expect(row.Name).toBeDefined();
    expect('DataType' in row).toBe(true);
  });
});
