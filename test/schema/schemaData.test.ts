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
    // Only the paths verified from real data. Task 4b dumped the real binary
    // fixture (test/parity/artifacts/binary/params.sldd, entry "gravity") and
    // found DataScope, HeaderFile, PreserveDimensions, and DimensionsMode are
    // absent from a Parameter's raw _properties tree (neither top-level nor
    // under CoderInfo._properties) — so they are NOT added here. The Parameter's
    // CoderInfo._properties held only HasCoderInfo, StorageClass, TypeQualifier,
    // Alias, Alignment, IsCSCPackageOverridden, CSCPackageName, ParameterOrSignal,
    // CustomStorageClass, CustomAttributes. Never ship a guessed source path.
    for (const k of ['storageClass', 'alignment']) {
      expect(keys.has(k)).toBe(true);
    }
  });
});
