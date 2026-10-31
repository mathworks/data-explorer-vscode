// Copyright 2026 The MathWorks, Inc.
//
// slddFormat.ts was core's code word for word (data-explorer-core's slddFormat), and is now core's,
// re-exported under the names extension.ts and the binary providers import: each name is core's
// own function or value.
import { describe, it, expect } from 'vitest';
import * as core from 'data-explorer-core';
import * as slddFormat from '../src/host/slddFormat.js';

describe("the host files that were core's, re-exported", () => {
  for (const [file, mod] of Object.entries({ slddFormat })) {
    it(`${file}.ts exports core's own, under the names it always had`, () => {
      const names = Object.keys(mod);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect((mod as Record<string, unknown>)[name], name).toBe((core as Record<string, unknown>)[name]);
      }
    });
  }
});
