// Copyright 2026 The MathWorks, Inc.
//
// Phase-0 smoke test: proves the fidelity round-trip harness works end-to-end
// for BOTH sldd formats — edit a Parameter's Min, serialize, re-parse, and (when
// MATLAB is configured via DEX_MATLAB_CMD) assert MATLAB reads back the value we
// set. This validates the harness the per-node fidelity suites build on.
import { describe, it, expect } from 'vitest';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  matlabAvailable,
  matlabAssertRoundTrip,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

for (const format of ['json', 'binary'] as SlddFormat[]) {
  describe(`fidelity harness smoke (${format})`, () => {
    it('edits Parameter.Min and round-trips through serialize/re-parse', () => {
      const uri = `test://smoke-${format}.sldd`;
      const model = loadModel(format, 'params.sldd', uri);
      // params.sldd has a Parameter entry — find the first one.
      const rows = model;
      void rows;
      const entry = entryByName(model, uri, 'gravity');
      expect(entry.className).toBe('Simulink.Parameter');

      expect(entry.setProperty('Min', '3')).toBe(true);
      const bytes = serializeModel(model, format);
      const fresh = reparseEntry(bytes, format, 'params.sldd', 'gravity');
      expect(fresh.Min).toBe(3);

      // Definitive gate: MATLAB reads the value we set (skipped w/o MATLAB).
      const out = matlabAssertRoundTrip(bytes, 'gravity', { Min: 3, __class__: 'Simulink.Parameter' });
      if (matlabAvailable()) expect(out).toMatch(/RESULT PASS/);
    });
  });
}
