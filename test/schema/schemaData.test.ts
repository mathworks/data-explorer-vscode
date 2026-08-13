// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { getSchema } from '../../src/dex/datamodel/schema/index.js';

const CLASSES = ['Simulink.Parameter', 'Simulink.Signal'];
const VALID_EDITORS = new Set(['text', 'textArea', 'label', 'bool', 'select']);
const VALID_GROUPS = new Set([undefined, 'Data Object', 'Code Generation']);

describe('schema data integrity', () => {
  for (const cls of CLASSES) {
    it(`${cls}: every resolved prop has label, sourcePath, valid editor and group`, () => {
      const props = getSchema(cls)!;
      expect(props.length).toBeGreaterThan(0);
      for (const p of props) {
        expect(typeof p.label).toBe('string');
        expect(p.label.length).toBeGreaterThan(0);
        expect(typeof p.sourcePath).toBe('string');
        expect(p.sourcePath.length).toBeGreaterThan(0);
        expect(VALID_EDITORS.has(p.editor)).toBe(true);
        expect(VALID_GROUPS.has(p.group)).toBe(true);
      }
    });

    it(`${cls}: no duplicate keys in the reference list`, () => {
      const keys = getSchema(cls)!.map(p => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }

  it('the confirmed Code Generation columns are present for Parameter', () => {
    const keys = new Set(getSchema('Simulink.Parameter')!.map(p => p.key));
    // Only the paths verified from real data. Two rounds of MATLAB probing
    // (test/parity/gen_codegen_fixture.m) confirmed the four remaining props.png
    // Code Gen columns are NOT modelable on a Parameter:
    //   - DataScope, HeaderFile, PreserveDimensions -> "Unrecognized property"
    //     on Parameter, Signal, CoderInfo, AND CoderInfo.CustomAttributes.
    //   - DimensionsMode -> Unrecognized on Parameter; Signal-only (added there).
    // A Parameter's CoderInfo held only HasCoderInfo, StorageClass, TypeQualifier,
    // Alias, Alignment, IsCSCPackageOverridden, CSCPackageName, ParameterOrSignal,
    // CustomStorageClass, CustomAttributes. Never ship a guessed source path.
    for (const k of ['storageClass', 'alignment']) {
      expect(keys.has(k)).toBe(true);
    }
    expect(keys.has('dimensionsMode')).toBe(false);
  });

  it('DimensionsMode is Signal-only, defaulting to "auto"', () => {
    // Confirmed from real data: top-level char on Simulink.Signal, default 'auto'.
    const sig = getSchema('Simulink.Signal')!.find(p => p.key === 'dimensionsMode')!;
    expect(sig.sourcePath).toBe('DimensionsMode');
    expect(sig.default).toBe('auto');
    expect(sig.editor).toBe('label');
  });
});
