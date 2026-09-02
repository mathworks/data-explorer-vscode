// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSlddContent } from '../src/host/slddContent.js';

function bytes(relpath: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(relpath, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

// The one shape both formats deserialize to; every downstream consumer (the
// datamodel, the name index, the usage graph) reads entries through this path.
function entryNames(content: Record<string, unknown>): string[] {
  const parts = content.__MW_TEXT_PARTS__ as Record<string, any>;
  const inner = parts['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  return (inner.entries as any[]).map((e) => e.name);
}

describe('readSlddContent', () => {
  it('reads a JSON .sldd', () => {
    const content = readSlddContent(bytes('./fixtures/numeric_json.sldd'));
    expect(entryNames(content).length).toBeGreaterThan(0);
  });

  it('reads a compressed-binary .sldd into the SAME content shape', () => {
    // The whole point of the helper: past this call, nothing downstream has to
    // know which format the file was — so both formats must produce a content
    // object the same accessor path can read.
    const content = readSlddContent(bytes('./fixtures/compressed.sldd'));
    expect(entryNames(content).length).toBeGreaterThan(0);
  });

  it('dispatches on the ZIP magic bytes, not the filename', () => {
    // It takes bytes, with no name to be misled by. A compressed and a JSON
    // dictionary carry the same `.sldd` extension — MATLAB picks the format from
    // FileFormat at save time — so gating on the extension would read a
    // compressed dictionary as JSON and throw, yielding a file that looks empty.
    // These two fixtures differ ONLY in format.
    expect(() => readSlddContent(bytes('./fixtures/rt_text.sldd'))).not.toThrow();
    expect(() => readSlddContent(bytes('./fixtures/rt_bin.sldd'))).not.toThrow();
    expect(entryNames(readSlddContent(bytes('./fixtures/rt_bin.sldd')))).toEqual(
      entryNames(readSlddContent(bytes('./fixtures/rt_text.sldd'))),
    );
  });

  it('throws on content that is neither a zip nor valid JSON', () => {
    // Callers that scan a whole workspace (nameIndex.recordsForFile,
    // usageGraph.buildGraph) wrap this in a try and let a corrupt file
    // contribute nothing, so the throw is the contract they rely on — returning
    // an empty object instead would make a truncated dictionary indistinguishable
    // from an empty one.
    expect(() => readSlddContent(encode('{ this is not json'))).toThrow();
  });

  it('accepts JSON that is valid but not dictionary-shaped', () => {
    // Shape validation belongs to the consumers (they read through optional
    // chaining and tolerate a missing __MW_TEXT_PARTS__); this function only
    // decides the FORMAT. A stricter check here would reject content the
    // consumers handle fine.
    expect(readSlddContent(encode('{"unexpected":true}'))).toEqual({ unexpected: true });
  });
});
