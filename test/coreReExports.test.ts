// Copyright 2026 The MathWorks, Inc.
//
// Four host files that were core's code word for word (jsonEntryScan, entrySplice, jsonEntrySync,
// slddFormat) are now core's, re-exported under the names this extension's tests and its other
// files import: each name is core's own function or value. And entrySplice's
// `findEntryElementSpan` is the JSON one, core's `findJsonEntryElementSpan`, not core's own
// `findEntryElementSpan`, which is the binary dictionary's XML finder: a plain re-export of the
// name would have handed every JSON caller the wrong function.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from 'data-explorer-core';
import * as jsonEntryScan from '../src/host/jsonEntryScan.js';
import * as entrySplice from '../src/host/entrySplice.js';
import * as jsonEntrySync from '../src/host/jsonEntrySync.js';
import * as slddFormat from '../src/host/slddFormat.js';

const PARAMS = readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'workspace', 'params.sldd'), 'utf8');

const ALIASES: Record<string, string> = { findEntryElementSpan: 'findJsonEntryElementSpan' };

describe("the host files that were core's, re-exported", () => {
  for (const [file, mod] of Object.entries({ jsonEntryScan, entrySplice, jsonEntrySync, slddFormat })) {
    it(`${file}.ts exports core's own, under the names it always had`, () => {
      const names = Object.keys(mod);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect((mod as Record<string, unknown>)[name], name).toBe((core as Record<string, unknown>)[ALIASES[name] ?? name]);
      }
    });
  }

  it("entrySplice's findEntryElementSpan is the JSON finder: it finds a JSON entry's element, where core's XML one does not", () => {
    expect(entrySplice.findEntryElementSpan).toBe(core.findJsonEntryElementSpan);
    expect(entrySplice.findEntryElementSpan).not.toBe(core.findEntryElementSpan);
    const name = (JSON.parse(PARAMS).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as { name: string }[])[0].name;
    const span = entrySplice.findEntryElementSpan(PARAMS, name);
    expect(span, `the JSON finder finds "${name}"`).not.toBeNull();
    expect(PARAMS.slice(span!.offset, span!.offset + span!.length)).toContain(`"${name}"`);
    expect((core.findEntryElementSpan as (text: string, selector: string) => unknown)(PARAMS, name)).toBeNull();
  });
});
