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

  it('SignalNode surfaces a read-only Dimensions Mode column defaulting to "auto"', () => {
    // Confirmed from real MATLAB data (test/parity/gen_codegen_fixture.m probe):
    // DimensionsMode is a top-level char on Simulink.Signal, default 'auto'.
    const node = SignalNode.createDefault('s', null);
    const prop = node.getProperties().find((p: any) => p.key === 'dimensionsMode')!;
    expect(prop.column).toBe('dimensionsMode');
    expect(prop.editor).toBe('label');
    const row: any = node.toRow();
    // Read-only label props render as plain strings (its omitted default).
    expect(row.dimensionsMode).toBe('auto');
  });

  it('ParameterNode does NOT surface Dimensions Mode (absent on the class)', () => {
    // The probe showed DimensionsMode is Unrecognized on Simulink.Parameter, so
    // it is deliberately not in the Parameter schema.
    const props = ParameterNode.createDefault('p', null).getProperties();
    expect(props.find((p: any) => p.key === 'dimensionsMode')).toBeUndefined();
    const row: any = ParameterNode.createDefault('p', null).toRow();
    expect('dimensionsMode' in row).toBe(false);
  });

  it('the legacy columns are still emitted (no regression)', () => {
    const row: any = ParameterNode.createDefault('p', null).toRow();
    expect(row.Name).toBeDefined();
    expect('DataType' in row).toBe(true);
  });
});
