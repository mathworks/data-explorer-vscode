// Copyright 2026 The MathWorks, Inc.
//
// Fidelity tests for Simulink.Signal — verifies that Min/Max edits round-trip
// through both sldd formats and that MATLAB-mirroring rejects fire correctly.
// A Signal has NO scalar value (displayValue '' / valueEditable false); the only
// numeric editable props are Min and Max, validated by _setMinMax.
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
  describe(`Simulink.Signal fidelity (${format})`, () => {
    function freshEntry() {
      const uri = `test://signal-fid-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'sig1');
      return { model, uri, entry };
    }

    it('loads sig1 as Simulink.Signal with no scalar value', () => {
      const { entry } = freshEntry();
      expect(entry.className).toBe('Simulink.Signal');
      expect(entry.displayValue).toBe('');
      expect(entry.valueEditable).toBe(false);
    });

    it('edits Min=-5 and Max=10, round-trips through serialize/re-parse', () => {
      const { model, entry } = freshEntry();

      expect(entry.setProperty('Min', '-5')).toBe(true);
      expect(entry.setProperty('Max', '10')).toBe(true);
      expect(entry.Min).toBe(-5);
      expect(entry.Max).toBe(10);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'sig1');
      expect(fresh.Min).toBe(-5);
      expect(fresh.Max).toBe(10);

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'sig1', {
          Min: -5,
          Max: 10,
          __class__: 'Simulink.Signal',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    }, 60_000);

    it('rejects Min="[1 2 3]" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();
      const originalMin = entry.Min;

      const result = entry.setProperty('Min', '[1 2 3]');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Minimum must be a finite real double scalar value');
      expect(result.invalidValue).toBe('[1 2 3]');
      // Node must not have been mutated.
      expect(entry.Min).toBe(originalMin);
    });

    it('rejects Min="Inf" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('Min', 'Inf');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Minimum must be a finite real double scalar value');
    });

    it('rejects Min="NaN" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('Min', 'NaN');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Minimum must be a finite real double scalar value');
    });

    it('rejects Min="5+2i" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('Min', '5+2i');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Minimum must be a finite real double scalar value');
    });

    it('clears Min with empty string (sets to undefined)', () => {
      const { model, entry } = freshEntry();

      // First confirm Min has a value on disk.
      expect(entry.Min).toBe(-10);

      expect(entry.setProperty('Min', '')).toBe(true);
      expect(entry.Min).toBeUndefined();

      // Round-trip: cleared Min serializes as [] — in JSON this re-parses as
      // undefined (no key emitted), in binary it comes back as [] (MATLAB's
      // representation of "cleared"). Either way it is falsy/not a number.
      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'sig1');
      if (format === 'json') {
        expect(fresh.Min).toBeUndefined();
      } else {
        // Binary: the parser returns [] for an empty double, which the
        // constructor assigns as-is. Both undefined and [] mean "no bound".
        expect(fresh.Min === undefined || (Array.isArray(fresh.Min) && fresh.Min.length === 0)).toBe(true);
      }
    });

    it('rejects Max="[1 2 3]" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('Max', '[1 2 3]');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Maximum must be a finite real double scalar value');
    });

    it('rejects Max="Inf" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('Max', 'Inf');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Maximum must be a finite real double scalar value');
    });

    it('rejects Max="NaN" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('Max', 'NaN');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Maximum must be a finite real double scalar value');
    });

    it('rejects Max="5+2i" with finite-real-scalar reason', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('Max', '5+2i');
      expect(result).not.toBe(true);
      expect(result.error).toBe(true);
      expect(result.reason).toBe('Maximum must be a finite real double scalar value');
    });
  });
}
