// Copyright 2026 The MathWorks, Inc.
//
// Fidelity tests for Simulink.Parameter — verifies that Value, Min, Max edits
// round-trip through both sldd formats and that MATLAB rejects are mirrored.
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
  describe(`Simulink.Parameter fidelity (${format})`, () => {
    // MATLAB gate tests launch a full MATLAB session per assertion — allow 60s.
    const MATLAB_TIMEOUT = 60_000;

    function freshEntry() {
      const uri = `test://param-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'gravity');
      return { model, uri, entry };
    }

    it('edits Min and Max, round-trips through serialize/re-parse', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.className).toBe('Simulink.Parameter');

      expect(entry.setProperty('Min', '3')).toBe(true);
      expect(entry.setProperty('Max', '99')).toBe(true);
      expect(entry.Min).toBe(3);
      expect(entry.Max).toBe(99);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');
      expect(fresh.Min).toBe(3);
      expect(fresh.Max).toBe(99);

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'gravity', {
          Min: 3,
          Max: 99,
          __class__: 'Simulink.Parameter',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('edits Value to scalar "42", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();

      expect(entry.setProperty('Value', '42')).toBe(true);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');
      // Scalar value — no child node, value is a plain number.
      expect(fresh.Value).toBe(42);

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'gravity', {
          Value: 42,
          __class__: 'Simulink.Parameter',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('edits Value to vector "[1 2 3]", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();

      expect(entry.setProperty('Value', '[1 2 3]')).toBe(true);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');
      // Vector stored as displayValue — child node carries the array.
      expect(fresh.displayValue).toBe('[1 2 3]');

      // NOTE: verify_roundtrip.m's jsondecode turns a JSON array into a MATLAB
      // column vector while the actual stored value is a row vector, so array
      // assertions are done in-process only (the class gate still validates
      // MATLAB can open the file).
      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'gravity', {
          __class__: 'Simulink.Parameter',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('rejects cell value "{1,2}" with MATLAB-mirroring error', () => {
      const { entry } = freshEntry();
      const originalDisplay = entry.displayValue;

      const result = entry.setProperty('Value', '{1,2}');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toContain(
        'Value must be a numeric array, fi object, enumerated value, structure whose fields contain valid values, string scalar, or an expression',
      );
      expect(result.invalidValue).toBe('{1,2}');
      expect(result.validValue).toBe(originalDisplay);
      // Node must not have been mutated.
      expect(entry.displayValue).toBe(originalDisplay);
    });

    it('rejects unparseable value "not a value"', () => {
      const { entry } = freshEntry();
      const originalDisplay = entry.displayValue;

      const result = entry.setProperty('Value', 'not a value');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Invalid MATLAB expression');
      expect(result.invalidValue).toBe('not a value');
      expect(result.validValue).toBe(originalDisplay);
      expect(entry.displayValue).toBe(originalDisplay);
    });
  });
}
