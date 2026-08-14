// Copyright 2026 The MathWorks, Inc.
//
// Fidelity tests for Simulink.data.dictionary.EnumTypeDefinition — verifies
// that DefaultValue edits and structural add/remove of enumerals round-trip
// through both sldd formats, with optional live MATLAB value-equality gate.
import { describe, it, expect } from 'vitest';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  matlabAvailable,
  matlabAssertRoundTrip,
  type SlddFormat,
} from './roundTripHarness.js';

const FORMATS: SlddFormat[] = ['json', 'binary'];
const FIXTURE = 'params.sldd';
const ENTRY = 'MyEnum';
const CLASS_NAME = 'Simulink.data.dictionary.EnumTypeDefinition';

// MATLAB launches are slow (~20-30s each); increase timeout for live-gated tests.
const MATLAB_TIMEOUT = 60_000;

for (const format of FORMATS) {
  describe(`EnumTypeDefinition fidelity (${format})`, () => {
    function freshEntry() {
      const uri = `test://enum-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, FIXTURE, uri);
      const entry = entryByName(model, uri, ENTRY);
      return { model, uri, entry };
    }

    // -----------------------------------------------------------------
    // className + displayValue sanity
    // -----------------------------------------------------------------
    it('className is correct and displayValue equals first enumeral when no DefaultValue', () => {
      const { entry } = freshEntry();
      expect(entry.className).toBe(CLASS_NAME);
      // Fixture has no DefaultValue set, so displayValue = first enumeral name
      expect(entry.DefaultValue).toBe('');
      expect(entry.displayValue).toBe(entry.children[0].name);
    });

    // -----------------------------------------------------------------
    // DefaultValue edit round-trip
    // -----------------------------------------------------------------
    it('DefaultValue edit round-trips through serialize/re-parse', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      // Pick an existing enumeral name that is NOT the first (to distinguish from fallback)
      const enumeralNames = entry.children.map((c: any) => c.name);
      expect(enumeralNames.length).toBeGreaterThan(1);
      const target = enumeralNames[1]; // 'Red' in the fixture

      // setProperty('Value', ...) routes to DefaultValue via PropEnumValue.nodeProperty
      expect(entry.setProperty('Value', target)).toBe(true);
      expect(entry.DefaultValue).toBe(target);
      expect(entry.displayValue).toBe(target);

      // Serialize and re-parse
      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, FIXTURE, ENTRY);
      expect(fresh.DefaultValue).toBe(target);
      expect(fresh.displayValue).toBe(target);

      // MATLAB live gate: DefaultValue should read back as the string we set
      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, ENTRY, {
          DefaultValue: target,
          __class__: CLASS_NAME,
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    // -----------------------------------------------------------------
    // Enumeral add round-trip
    // -----------------------------------------------------------------
    it('enumeral add: child count N+1 after re-parse', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      const N = entry.children.length;
      expect(N).toBeGreaterThan(0);

      // Add a new enumeral
      const result = entry.execAddChild();
      expect(result).not.toBeNull();
      expect(entry.children.length).toBe(N + 1);
      const newName = result.node.name;
      // New enumeral value should be stringified child count before add
      expect(result.node.Value).toBe(String(N));

      // Serialize and re-parse
      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, FIXTURE, ENTRY);
      expect(fresh.children.length).toBe(N + 1);
      const freshNames = fresh.children.map((c: any) => c.name);
      expect(freshNames).toContain(newName);

      // MATLAB live gate: __class__ proves MATLAB opens the mutated file.
      // Cannot use __count__ (it reads v.Elements, bus-specific); assert count
      // in-process only.
      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, ENTRY, {
          __class__: CLASS_NAME,
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    // -----------------------------------------------------------------
    // Enumeral remove round-trip
    // -----------------------------------------------------------------
    it('enumeral remove: child count N-1 after re-parse', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      const N = entry.children.length;
      expect(N).toBeGreaterThan(1);
      const removedName = entry.children[N - 1].name;

      // Remove the last enumeral
      const result = entry.execRemoveChild(entry.children[N - 1]);
      expect(result).not.toBeNull();
      expect(entry.children.length).toBe(N - 1);

      // Serialize and re-parse
      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, FIXTURE, ENTRY);
      expect(fresh.children.length).toBe(N - 1);
      const freshNames = fresh.children.map((c: any) => c.name);
      expect(freshNames).not.toContain(removedName);

      // MATLAB live gate: __class__ proves MATLAB opens the mutated file.
      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, ENTRY, {
          __class__: CLASS_NAME,
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    // -----------------------------------------------------------------
    // Undo/redo idempotence — add
    // -----------------------------------------------------------------
    it('execAddChild undo restores original count, redo re-adds', () => {
      const { entry } = freshEntry();
      const N = entry.children.length;
      const originalNames = entry.children.map((c: any) => c.name);

      const result = entry.execAddChild();
      expect(entry.children.length).toBe(N + 1);
      const addedName = result.node.name;

      // Undo
      result.undo();
      expect(entry.children.length).toBe(N);
      const afterUndo = entry.children.map((c: any) => c.name);
      expect(afterUndo).toEqual(originalNames);

      // Redo
      result.redo();
      expect(entry.children.length).toBe(N + 1);
      expect(entry.children[entry.children.length - 1].name).toBe(addedName);
    });

    // -----------------------------------------------------------------
    // Undo/redo idempotence — remove
    // -----------------------------------------------------------------
    it('execRemoveChild undo restores child at original position, redo re-removes', () => {
      const { entry } = freshEntry();
      const N = entry.children.length;
      expect(N).toBeGreaterThan(0);
      const targetIndex = 0;
      const targetName = entry.children[targetIndex].name;

      const result = entry.execRemoveChild(entry.children[targetIndex]);
      expect(result).not.toBeNull();
      expect(entry.children.length).toBe(N - 1);

      // Undo
      result.undo();
      expect(entry.children.length).toBe(N);
      expect(entry.children[targetIndex].name).toBe(targetName);

      // Redo
      result.redo();
      expect(entry.children.length).toBe(N - 1);
      expect(entry.children.map((c: any) => c.name)).not.toContain(targetName);
    });
  });
}
