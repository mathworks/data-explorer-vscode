// Copyright 2026 The MathWorks, Inc.
//
// Fidelity tests for schema-projected Code Generation columns (storageClass,
// headerFile, alignment). Verifies that editable StorageClass round-trips
// through both sldd formats and that invalid values are rejected, and that
// read-only columns (headerFile, alignment) are not writable.
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

// Dotted paths in the expected-spec JSON must survive MATLAB's jsondecode without
// being mangled. R2027a converts '.' to '_' in field names, but verify_roundtrip.m
// reverses the hex escape '_0x2E_' → '.'. So we pre-encode dots as '_0x2E_' here.
const CODER_STORAGE = 'CoderInfo_0x2E_StorageClass';

// MATLAB launch takes ~20-30s; give generous headroom for the live gate tests.
const MATLAB_TIMEOUT = 60_000;

for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`Schema columns: StorageClass fidelity — Parameter (${format})`, () => {
    function freshEntry() {
      const uri = `test://schema-param-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'gravity');
      return { model, uri, entry };
    }

    it('setProperty storageClass to ExportedGlobal round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.className).toBe('Simulink.Parameter');

      const result = entry.setProperty('storageClass', 'ExportedGlobal');
      expect(result).toBe(true);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');

      // Read back the storageClass via the schema readValue path
      const props = fresh.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      expect(bag?.StorageClass).toBe('ExportedGlobal');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'gravity', {
          [CODER_STORAGE]: 'ExportedGlobal',
          __class__: 'Simulink.Parameter',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('setProperty storageClass to Auto round-trips back to Auto', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();

      // First set to something else, then back to Auto
      expect(entry.setProperty('storageClass', 'ImportedExtern')).toBe(true);
      expect(entry.setProperty('storageClass', 'Auto')).toBe(true);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');

      const props = fresh.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      expect(bag?.StorageClass).toBe('Auto');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'gravity', {
          [CODER_STORAGE]: 'Auto',
          __class__: 'Simulink.Parameter',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('setProperty storageClass to Custom round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();

      expect(entry.setProperty('storageClass', 'Custom')).toBe(true);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');

      const props = fresh.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      expect(bag?.StorageClass).toBe('Custom');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'gravity', {
          [CODER_STORAGE]: 'Custom',
          __class__: 'Simulink.Parameter',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('rejects invalid storageClass "bogus" without mutating', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('storageClass', 'bogus');
      expect(result).not.toBe(true);
      expect((result as any).error).toBe(true);
      expect((result as any).reason).toBe('Invalid value for Storage Class');
      expect((result as any).invalidValue).toBe('bogus');

      // Node must not have been mutated — storageClass still Auto
      const props = entry.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      expect(bag?.StorageClass).toBe('Auto');
    });

    it('rejects CSC name "BitField" (not valid on CoderInfo.StorageClass)', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('storageClass', 'BitField');
      expect(result).not.toBe(true);
      expect((result as any).error).toBe(true);
      expect((result as any).reason).toBe('Invalid value for Storage Class');
      expect((result as any).invalidValue).toBe('BitField');
    });

    it('headerFile is guarded by label editor (trySetSchemaProperty returns null)', () => {
      const { entry } = freshEntry();

      // trySetSchemaProperty returns null for label-editor props, so the schema
      // bridge declines to handle the edit. The UI never sends this edit because
      // the column renders as a non-editable label cell. We verify the schema
      // bridge gate: import trySetSchemaProperty directly would require exposing
      // internals; instead we verify that the CoderInfo.CustomAttributes.HeaderFile
      // path is NOT mutated by the schema bridge (the fallthrough to DataNode's
      // generic path sets a JS property but NOT the serial bag the schema reads).
      const props = entry.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      const headerBefore = bag?.CustomAttributes?._properties?.HeaderFile;

      entry.setProperty('headerFile', 'myheader.h');

      // The serial CoderInfo bag should NOT have been touched by trySetSchemaProperty
      // (it returned null). The fallthrough sets entry.headerFile on the JS object,
      // which is harmless and not persisted via the schema sourcePath.
      const headerAfter = bag?.CustomAttributes?._properties?.HeaderFile;
      expect(headerAfter).toBe(headerBefore);
    });

    it('alignment is guarded by label editor (trySetSchemaProperty returns null)', () => {
      const { entry } = freshEntry();

      const props = entry.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      const alignBefore = bag?.Alignment;

      entry.setProperty('alignment', '8');

      // Serial bag Alignment must not have been mutated by the schema bridge.
      const alignAfter = bag?.Alignment;
      expect(alignAfter).toBe(alignBefore);
    });
  });

  describe(`Schema columns: StorageClass fidelity — Signal (${format})`, () => {
    function freshEntry() {
      const uri = `test://schema-sig-${format}-${Date.now()}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      const entry = entryByName(model, uri, 'sig1');
      return { model, uri, entry };
    }

    it('setProperty storageClass to ExportedGlobal round-trips', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();
      expect(entry.className).toBe('Simulink.Signal');

      const result = entry.setProperty('storageClass', 'ExportedGlobal');
      expect(result).toBe(true);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'sig1');

      const props = fresh.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      expect(bag?.StorageClass).toBe('ExportedGlobal');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'sig1', {
          [CODER_STORAGE]: 'ExportedGlobal',
          __class__: 'Simulink.Signal',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('setProperty storageClass to Auto round-trips back to Auto', { timeout: MATLAB_TIMEOUT }, () => {
      const { model, entry } = freshEntry();

      expect(entry.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
      expect(entry.setProperty('storageClass', 'Auto')).toBe(true);

      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'sig1');

      const props = fresh.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      expect(bag?.StorageClass).toBe('Auto');

      if (matlabAvailable()) {
        const out = matlabAssertRoundTrip(bytes, 'sig1', {
          [CODER_STORAGE]: 'Auto',
          __class__: 'Simulink.Signal',
        });
        expect(out).toMatch(/RESULT PASS/);
      }
    });

    it('rejects invalid storageClass "bogus" without mutating', () => {
      const { entry } = freshEntry();

      const result = entry.setProperty('storageClass', 'bogus');
      expect(result).not.toBe(true);
      expect((result as any).error).toBe(true);
      expect((result as any).reason).toBe('Invalid value for Storage Class');
      expect((result as any).invalidValue).toBe('bogus');

      const props = entry.serial?._properties;
      const coderInfo = props?.CoderInfo;
      const bag =
        coderInfo?._properties ?? coderInfo?._elements?.[0]?._properties;
      expect(bag?.StorageClass).toBe('Auto');
    });
  });
}
