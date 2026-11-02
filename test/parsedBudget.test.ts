// Copyright 2026 The MathWorks, Inc.
//
// `SourceCache.parsed` is BOUNDED, and dropping an entry from it costs a re-parse and never an
// answer. The bound, eviction order and the tab pin's policy went to data-explorer-core with the
// cache (its test/parsedBudget.test.ts), and that the name index gives the same records from a
// starved cache as from a roomy one went to view with the name index (its test/nameScan.test.ts).
// What stays is the half that needs this host's own code: the text pin on which entry point
// sourceReads.ts calls.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

describe('the tab pin is what keeps the folder pass from thrashing', () => {
  it('is the entry point the vscode adapter actually calls', () => {
    // The one seam no cache test can reach: `sourceReads.ts` imports `vscode`, so it cannot be
    // loaded in this suite (see vitest.config.ts) and the openTab helpers in view's
    // nameScan.test.ts and in core's own cache tests are all hand-copies of its inner sequence. Every one of them would
    // still pass if that module went back to `parsedModelOf` — and then the shipped host would
    // re-parse an open model on every folder pass while every suite agreed it did not. Checked as
    // TEXT because there is nothing else to check it with, and with the comments blanked so the
    // prose naming `parsedModelOf` is not what is being read.
    const src = blankCommentsAndKeepLines(
      readFileSync(fileURLToPath(new URL('../src/host/sourceReads.ts', import.meta.url)), 'utf8'),
    );
    expect(src).toContain('parsedModelForOpenTab(');
    expect(src).not.toContain('parsedModelOf(');
  });
});
