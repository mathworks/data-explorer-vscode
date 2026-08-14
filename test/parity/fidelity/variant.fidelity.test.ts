// Copyright 2026 The MathWorks, Inc.
//
// Fidelity tests for Simulink.VariantControl, Simulink.VariantExpression, and
// Simulink.VariantVariable — verifies that editable-property edits round-trip
// through both sldd formats and that MATLAB rejects are mirrored in code.
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

for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`Simulink.VariantControl fidelity (${format})`, () => {
    const MATLAB_TIMEOUT = 60_000;

    function freshEntry() {
      const uri = `test://varctrl-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'MyVarCtrl');
      return { model, uri, entry };
    }

    it('className is Simulink.VariantControl', () => {
      const { entry } = freshEntry();
      expect(entry.className).toBe('Simulink.VariantControl');
    });

    it('edits Value to integer "7", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.setProperty('Value', '7')).toBe(true);
      expect(entry.Value).toBe(7);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyVarCtrl');
      expect(fresh.Value).toBe(7);

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyVarCtrl', {
          Value: 7,
          __class__: 'Simulink.VariantControl',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('accepts "true" as logical', () => {
      const { entry } = freshEntry();
      expect(entry.setProperty('Value', 'true')).toBe(true);
      expect(entry.Value).toBe(true);
    });

    it('accepts "false" as logical', () => {
      const { entry } = freshEntry();
      expect(entry.setProperty('Value', 'false')).toBe(true);
      expect(entry.Value).toBe(false);
    });

    it('accepts empty string as empty', () => {
      const { entry } = freshEntry();
      expect(entry.setProperty('Value', '')).toBe(true);
      expect(entry.Value).toBe('');
    });

    it('accepts "[]" as empty array', () => {
      const { entry } = freshEntry();
      expect(entry.setProperty('Value', '[]')).toBe(true);
      expect(entry.Value).toBe(null);
    });

    it('rejects "1.5" (non-integer) with integer message', () => {
      const { entry } = freshEntry();
      const originalValue = entry.Value;
      const result = entry.setProperty('Value', '1.5');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe(
        'Simulink.VariantControl value must be an integer, logical, an enumeration, or a Simulink.Parameter with value of type integer, logical or enumeration.',
      );
      expect(result.invalidValue).toBe('1.5');
      expect(entry.Value).toBe(originalValue);
    });

    it('rejects "Inf" with integer message', () => {
      const { entry } = freshEntry();
      const originalValue = entry.Value;
      const result = entry.setProperty('Value', 'Inf');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toContain('must be an integer, logical');
      expect(entry.Value).toBe(originalValue);
    });

    it('rejects "-Inf" with integer message', () => {
      const { entry } = freshEntry();
      const originalValue = entry.Value;
      const result = entry.setProperty('Value', '-Inf');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toContain('must be an integer, logical');
      expect(entry.Value).toBe(originalValue);
    });

    it('rejects "[1 2 3]" (array) with scalar message', () => {
      const { entry } = freshEntry();
      const originalValue = entry.Value;
      const result = entry.setProperty('Value', '[1 2 3]');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe(
        'Simulink.VariantControl value must be a scalar or a Simulink.Parameter with scalar value.',
      );
      expect(entry.Value).toBe(originalValue);
    });

    it('rejects "5+2i" (complex) with scalar message', () => {
      const { entry } = freshEntry();
      const originalValue = entry.Value;
      const result = entry.setProperty('Value', '5+2i');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toContain('must be a scalar');
      expect(entry.Value).toBe(originalValue);
    });

    it('rejects "hello" (text) with scalar message', () => {
      const { entry } = freshEntry();
      const originalValue = entry.Value;
      const result = entry.setProperty('Value', 'hello');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toContain('must be a scalar');
      expect(entry.Value).toBe(originalValue);
    });
  });

  describe(`Simulink.VariantExpression fidelity (${format})`, () => {
    const MATLAB_TIMEOUT = 60_000;

    function freshEntry() {
      const uri = `test://varexpr-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'MyVarExpr');
      return { model, uri, entry };
    }

    it('className is Simulink.VariantExpression', () => {
      const { entry } = freshEntry();
      expect(entry.className).toBe('Simulink.VariantExpression');
    });

    it('edits Condition to "A == 2", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.setProperty('Condition', 'A == 2')).toBe(true);
      expect(entry.Condition).toBe('A == 2');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyVarExpr');
      expect(fresh.Condition).toBe('A == 2');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyVarExpr', {
          Condition: 'A == 2',
          __class__: 'Simulink.VariantExpression',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('edits Condition to "bogus", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.setProperty('Condition', 'bogus')).toBe(true);
      expect(entry.Condition).toBe('bogus');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyVarExpr');
      expect(fresh.Condition).toBe('bogus');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyVarExpr', {
          Condition: 'bogus',
          __class__: 'Simulink.VariantExpression',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });
  });

  describe(`Simulink.VariantVariable fidelity (${format})`, () => {
    const MATLAB_TIMEOUT = 60_000;

    function freshEntry() {
      const uri = `test://varvar-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'MyVarVar');
      return { model, uri, entry };
    }

    it('className is Simulink.VariantVariable', () => {
      const { entry } = freshEntry();
      expect(entry.className).toBe('Simulink.VariantVariable');
    });

    it('edits Specification to "myNewVar", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.setProperty('Specification', 'myNewVar')).toBe(true);
      expect(entry.Specification).toBe('myNewVar');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyVarVar');
      expect(fresh.Specification).toBe('myNewVar');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyVarVar', {
          Specification: 'myNewVar',
          __class__: 'Simulink.VariantVariable',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('edits Specification to empty string, round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.setProperty('Specification', '')).toBe(true);
      expect(entry.Specification).toBe('');

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyVarVar');
      expect(fresh.Specification).toBe('');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'MyVarVar', {
          Specification: '',
          __class__: 'Simulink.VariantVariable',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });
  });
}
