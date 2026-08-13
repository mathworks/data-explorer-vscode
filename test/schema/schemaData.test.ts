// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { getSchema } from '../../src/dex/datamodel/schema/index.js';

const CLASSES = ['Simulink.Parameter', 'Simulink.Signal'];
const VALID_EDITORS = new Set(['text', 'textArea', 'label', 'bool']);
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
    // Only the paths verified from real data in Phase 1 (Task 3). The remaining
    // props.png Code Generation columns (Data Scope, Header File, Preserve
    // Dimensions) + Dimensions Mode are added in Task 3b once their Parameter
    // source paths are confirmed from a binary dump.
    for (const k of ['storageClass', 'alignment']) {
      expect(keys.has(k)).toBe(true);
    }
  });
});
