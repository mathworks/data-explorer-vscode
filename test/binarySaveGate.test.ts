// Copyright 2026 The MathWorks, Inc.
//
// The save's own half of the compressed dictionary editor's save gate: the provider calls view's
// binary engine's beginSave (read, gate, zip, in one synchronous call) before the save's first
// await, so the text gated is the text written. What beginSave writes and refuses, in the words
// the user is shown, is view's (its test/binaryEngine/save.test.ts); the gate's own rules are
// core's (savedChunkRefusal and the keys it pairs by, data-explorer-core's
// test/binarySaveGate.test.ts), with the cases that drove it through this extension's structural
// edits, which core's own edits are now.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

describe("the save's own half of the gate: the engine's beginSave, before the save's first await", () => {
  // The provider imports `vscode`, so where it calls the engine is read from its source, with the
  // comments blanked so that only code is matched.
  it("calls the engine's beginSave before the save's first await, so the text gated is the text written", () => {
    // An edit landing on the awaits that follow is the next save's, as its text is.
    const src = blankCommentsAndKeepLines(readFileSync(repo('src/host/BinarySlddEditorProvider.ts'), 'utf8'));
    const start = src.indexOf('  private async writeDocument(');
    expect(start, 'the provider still has writeDocument').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const begin = body.indexOf('document.engine.beginSave()');
    expect(begin).toBeGreaterThan(-1);
    expect(body.slice(0, begin)).not.toMatch(/\bawait\b/);
  });
});
