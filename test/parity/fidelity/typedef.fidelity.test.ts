// Copyright 2026 The MathWorks, Inc.
//
// Fidelity tests for Tier-3 type-definition nodes: NumericType, ValueType,
// LookupTable, Breakpoint (read-only contract lock) and AliasType (editable
// BaseType round-trip). Verifies that read-only nodes stay non-editable and
// that AliasType edits round-trip through both sldd formats with MATLAB gate.
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
  describe(`Tier-3 type-definition fidelity (${format})`, () => {
    const MATLAB_TIMEOUT = 60_000;

    // --- Read-only contract lock: NumericType ---
    describe('Simulink.NumericType (MyNumType)', () => {
      function freshNumericType() {
        const uri = `test://numtype-fid-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, 'params.sldd', uri);
        const entry = entryByName(model, uri, 'MyNumType');
        return { model, uri, entry };
      }

      it('has correct className and valueEditable=false', () => {
        const { entry } = freshNumericType();
        expect(entry.className).toBe('Simulink.NumericType');
        expect(entry.valueEditable).toBe(false);
        expect(entry.displayValue).toBe('');
      });

      it('Description edit round-trips', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, entry } = freshNumericType();

        expect(entry.setProperty('Description', 'fixed-point type')).toBe(true);
        expect(entry.Description).toBe('fixed-point type');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyNumType');
        expect(fresh.Description).toBe('fixed-point type');

        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyNumType', {
            Description: 'fixed-point type',
            __class__: 'Simulink.NumericType',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });
    });

    // --- Read-only contract lock: ValueType ---
    describe('Simulink.ValueType (MyValueType)', () => {
      function freshValueType() {
        const uri = `test://valtype-fid-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, 'params.sldd', uri);
        const entry = entryByName(model, uri, 'MyValueType');
        return { model, uri, entry };
      }

      it('has correct className and valueEditable=false', () => {
        const { entry } = freshValueType();
        expect(entry.className).toBe('Simulink.ValueType');
        expect(entry.valueEditable).toBe(false);
        expect(entry.displayValue).toBe('');
      });

      it('Description edit round-trips', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, entry } = freshValueType();

        expect(entry.setProperty('Description', 'speed value type')).toBe(true);
        expect(entry.Description).toBe('speed value type');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyValueType');
        expect(fresh.Description).toBe('speed value type');

        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyValueType', {
            Description: 'speed value type',
            __class__: 'Simulink.ValueType',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });
    });

    // --- Read-only contract lock: LookupTable ---
    describe('Simulink.LookupTable (MyLUT)', () => {
      function freshLUT() {
        const uri = `test://lut-fid-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, 'params.sldd', uri);
        const entry = entryByName(model, uri, 'MyLUT');
        return { model, uri, entry };
      }

      it('has correct className and valueEditable=false', () => {
        const { entry } = freshLUT();
        expect(entry.className).toBe('Simulink.LookupTable');
        expect(entry.valueEditable).toBe(false);
        expect(entry.displayValue).toBe('');
      });

      it('Description edit round-trips in-process', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, entry } = freshLUT();

        expect(entry.setProperty('Description', 'throttle map')).toBe(true);
        expect(entry.Description).toBe('throttle map');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyLUT');
        expect(fresh.Description).toBe('throttle map');

        // NOTE: MATLAB's Simulink.LookupTable does NOT expose a top-level
        // Description property (it errors: "Unrecognized method, property, or
        // field 'Description' for class 'Simulink.LookupTable'"). The
        // Description we serialize is a node-level field preserved by our
        // round-trip but not readable via obj.Description in MATLAB. Gate only
        // asserts class.
        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyLUT', {
            __class__: 'Simulink.LookupTable',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });
    });

    // --- Read-only contract lock: Breakpoint ---
    describe('Simulink.Breakpoint (MyBkpt)', () => {
      function freshBkpt() {
        const uri = `test://bkpt-fid-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, 'params.sldd', uri);
        const entry = entryByName(model, uri, 'MyBkpt');
        return { model, uri, entry };
      }

      it('has correct className and valueEditable=false', () => {
        const { entry } = freshBkpt();
        expect(entry.className).toBe('Simulink.Breakpoint');
        expect(entry.valueEditable).toBe(false);
        expect(entry.displayValue).toBe('');
      });

      it('Description edit round-trips in-process', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, entry } = freshBkpt();

        expect(entry.setProperty('Description', 'speed breakpoints')).toBe(true);
        expect(entry.Description).toBe('speed breakpoints');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyBkpt');
        expect(fresh.Description).toBe('speed breakpoints');

        // NOTE: MATLAB's Simulink.Breakpoint does NOT expose a top-level
        // Description property (it errors: "Unrecognized method, property, or
        // field 'Description' for class 'Simulink.Breakpoint'"). The
        // Description we serialize is a node-level field preserved by our
        // round-trip but not readable via obj.Description in MATLAB. Gate only
        // asserts class.
        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyBkpt', {
            __class__: 'Simulink.Breakpoint',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });
    });

    // --- AliasType: editable BaseType ---
    describe('Simulink.AliasType (MyAlias)', () => {
      function freshAlias() {
        const uri = `test://alias-fid-${format}-${Date.now()}.sldd`;
        const model = loadModel(format, 'params.sldd', uri);
        const entry = entryByName(model, uri, 'MyAlias');
        return { model, uri, entry };
      }

      it('has correct className and valueEditable=false', () => {
        const { entry } = freshAlias();
        expect(entry.className).toBe('Simulink.AliasType');
        expect(entry.valueEditable).toBe(false);
        expect(entry.displayValue).toBe('');
      });

      it('edits BaseType to "single", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, entry } = freshAlias();
        // Fixture has BaseType='int32'; change to 'single'.
        expect(entry.setProperty('BaseType', 'single')).toBe(true);
        expect(entry.BaseType).toBe('single');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyAlias');
        expect(fresh.BaseType).toBe('single');

        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyAlias', {
            BaseType: 'single',
            __class__: 'Simulink.AliasType',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('edits BaseType to "int32", round-trips', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, entry } = freshAlias();
        // Change to a different concrete type to verify assignment.
        expect(entry.setProperty('BaseType', 'uint16')).toBe(true);
        expect(entry.BaseType).toBe('uint16');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyAlias');
        expect(fresh.BaseType).toBe('uint16');

        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyAlias', {
            BaseType: 'uint16',
            __class__: 'Simulink.AliasType',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('Description edit round-trips', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, entry } = freshAlias();

        expect(entry.setProperty('Description', 'alias for int32')).toBe(true);
        expect(entry.Description).toBe('alias for int32');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'MyAlias');
        expect(fresh.Description).toBe('alias for int32');

        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'MyAlias', {
            Description: 'alias for int32',
            __class__: 'Simulink.AliasType',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('Name rename round-trips', { timeout: MATLAB_TIMEOUT }, () => {
        const { model, uri, entry } = freshAlias();

        expect(entry.setProperty('Name', 'RenamedAlias')).toBe(true);
        expect(entry.name).toBe('RenamedAlias');

        const bytes = serializeModel(model, format);
        const fresh = reparseEntry(bytes, format, 'params.sldd', 'RenamedAlias');
        expect(fresh.className).toBe('Simulink.AliasType');
        // BaseType should be preserved from fixture (int32).
        expect(fresh.BaseType).toBe('int32');

        if (matlabAvailable()) {
          const out = matlabAssertRoundTrip(bytes, 'RenamedAlias', {
            __class__: 'Simulink.AliasType',
          });
          expect(out).toMatch(/RESULT PASS/);
        }
      });

      it('rejects invalid Name "123bad"', () => {
        const { entry } = freshAlias();
        const result = entry.setProperty('Name', '123bad');
        expect(result).not.toBe(true);
        expect(result.error).toBe(true);
        expect(result.reason).toContain('Invalid MATLAB name');
        expect(result.invalidValue).toBe('123bad');
        expect(result.validValue).toBe('MyAlias');
        // Name must not have been mutated.
        expect(entry.name).toBe('MyAlias');
      });
    });
  });
}
