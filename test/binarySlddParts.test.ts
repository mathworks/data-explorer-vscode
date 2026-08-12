// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  parseBinarySldd,
  parseBinarySlddParts,
} from '../src/dex/datamodel/parser/BinarySlddParser.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('parseBinarySlddParts', () => {
  it('produces the same content shape as parseBinarySldd for the same chunkXml', () => {
    const whole = parseBinarySldd(ab);
    const zip = unzipSync(new Uint8Array(ab));
    const chunkXml = new TextDecoder().decode(zip['data/chunk0.xml']);
    const meta: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
    const parts = parseBinarySlddParts(chunkXml, meta);
    expect(JSON.stringify((parts as any).__MW_TEXT_PARTS__)).toBe(
      JSON.stringify((whole as any).__MW_TEXT_PARTS__),
    );
    expect((parts as any).__rawXml).toBe(chunkXml);
    expect(JSON.stringify((parts as any).__dataSourceAttrs)).toBe(
      JSON.stringify((whole as any).__dataSourceAttrs),
    );
  });
});
