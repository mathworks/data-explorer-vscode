// Copyright 2026 The MathWorks, Inc.
//
// The save's own half of the compressed dictionary editor's save gate: a chunk that does not read
// back. The save is view's binary engine's (BinaryEngine.beginSave), whose words and order are
// pinned here (read, gate, zip, in one synchronous call), and the provider calls it before the
// save's first await. The gate's own rules are core's (savedChunkRefusal and the keys it pairs by),
// pinned there (data-explorer-core's test/binarySaveGate.test.ts), with the cases that drove it
// through this extension's structural edits, which core's own edits are now.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from 'data-explorer-core';
import { createRegisters } from 'data-explorer-view/model';
import { BinaryEngine, EditStackIndex } from 'data-explorer-view/host';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

describe("the save's own half of the gate: the engine's beginSave, before the save's first await", () => {
  // The provider's save is view's binary engine's (BinaryEngine.beginSave): the gate's read, the
  // gate and the zip. The engine runs here; the provider imports `vscode`, so where it calls the
  // engine is read from its source, with the comments blanked so that only code is matched.
  const engine = () =>
    new BinaryEngine({
      session: createSession(),
      uri: 'file:///work/params.sldd',
      name: 'params.sldd',
      bytes: new Uint8Array(readFileSync(repo('test/parity/artifacts/binary/params.sldd'))),
      sink: { push: () => {}, undo: () => {}, redo: () => {} },
      index: new EditStackIndex(),
      registers: createRegisters(),
    });

  it('refuses a chunk that does not read back, in the words the user is shown', () => {
    const e = engine();
    e.forTests.setChunk('<Root><unterminated');
    expect(() => e.beginSave()).toThrow(/^Refusing to save: the document did not re-parse \(.+\)\.$/);
  });

  it('reads the chunk, gates it and zips it with no await between, so the text gated is the text written', () => {
    // One synchronous call: what it hands back is the bytes, not a promise of them.
    const save = engine().beginSave();
    expect(save.bytes).toBeInstanceOf(Uint8Array);
    // And the save calls it before its first await, so an edit landing on the awaits that follow
    // is the next save's, as its text is.
    const src = blankCommentsAndKeepLines(readFileSync(repo('src/host/BinarySlddEditorProvider.ts'), 'utf8'));
    const start = src.indexOf('  private async writeDocument(');
    expect(start, 'the provider still has writeDocument').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const begin = body.indexOf('document.engine.beginSave()');
    expect(begin).toBeGreaterThan(-1);
    expect(body.slice(0, begin)).not.toMatch(/\bawait\b/);
  });
});
