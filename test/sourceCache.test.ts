// Copyright 2026 The MathWorks, Inc.
//
// The vscode half of the shared cheap tier's rules.
//
// The cache itself — what a pass stats and reads, what each kind yields, what the expensive tier
// summarises — went to data-explorer-core, and is counted there over real fixture bytes (its
// test/sourceCache.test.ts). What stays is the one rule this host's adapter has to keep on its own
// side of the reader: sourceReads.ts versions a tab's file before it reads it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

describe('the version is taken BEFORE the bytes, on both paths', () => {
  // Which side of the read the `stat` falls on decides whether a mis-keyed entry heals itself or
  // never does, and only one direction is survivable. A version taken FIRST can only be older than
  // the bytes that follow it, so a file written during the read is keyed too old and the next pass
  // that stats it re-reads — the self-healing this cache's whole invalidation story rests on. A
  // version taken AFTER the bytes can be NEWER than the content it keys, and then every later pass
  // finds a version that matches and hits forever, on content the file no longer has: wrong, silent
  // and permanent.
  //
  // The rule therefore has to hold on both paths that key an entry, and neither of them states it
  // in a way a reader can check — the folder pass gets it from the order of two statements, and the
  // adapter gets it from statement order in a module no unit test can load. So it is pinned twice,
  // once per path: the pass in core's test/sourceCache.test.ts, the tab path here.

  it('is the order the vscode adapter uses for a TAB, where only the text can say so', () => {
    // sourceReads.ts imports `vscode` and cannot be loaded in this suite (see vitest.config.ts), so
    // this is a text check for the same reason the entry-point pin in parsedBudget.test.ts is one.
    // What it is guarding against is specific: `scanVersion(uri)` is currently an ARGUMENT, so it
    // completes before the bytes thunk can run, and a refactor that wanted the bytes for something
    // else would hoist the read above it and change nothing that any other test can see.
    const src = blankCommentsAndKeepLines(
      readFileSync(fileURLToPath(new URL('../src/host/sourceReads.ts', import.meta.url)), 'utf8'),
    );
    const from = src.indexOf('export async function parsedModelForTab');
    const to = src.indexOf('export function readerFor');
    expect(from, 'parsedModelForTab was renamed — re-pin the order').toBeGreaterThan(-1);
    expect(to, 'readerFor was moved or renamed — re-pin the slice').toBeGreaterThan(from);
    const tabPath = src.slice(from, to);
    expect(tabPath).toContain('scanVersion(');
    expect(tabPath).toContain('readFile(');
    expect(
      tabPath.indexOf('scanVersion('),
      'the tab path reads the file before it versions it: a stale entry would be permanent',
    ).toBeLessThan(tabPath.indexOf('readFile('));
  });
});

