// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import {
  serializeBinarySldd,
  serializeEntryToXml,
} from '../src/dex/datamodel/parser/BinarySlddSerializer.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);

function freshModel(uri: string) {
  invalidate(uri);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return getModelFromBytes(uri, 'params.sldd', ab as ArrayBuffer);
}

describe('serializeBinarySldd', () => {
  it('round-trips: re-serialized zip re-parses to the same entry names', () => {
    const model = freshModel('mem://ser1');
    const out = serializeBinarySldd(model);
    const parts = unzipSync(new Uint8Array(out));
    expect(parts['data/chunk0.xml']).toBeDefined();
    const xml = new TextDecoder().decode(parts['data/chunk0.xml']);
    expect(xml).toContain('<Object Class="DD.ENTRY">');
    expect(xml).toContain('<Object Class="DD.Dictionary">');
    const names = model.children.flatMap((s: any) => s.children.map((e: any) => e.name));
    for (const n of names) expect(xml).toContain('>' + n + '</P>');
  });

  it('serializeEntryToXml emits the 6 metadata P-nodes and a Value P', () => {
    const model = freshModel('mem://ser2');
    const entry = model.children.flatMap((s: any) => s.children)[0];
    const frag = serializeEntryToXml(entry);
    expect(frag).toContain('<Object Class="DD.ENTRY">');
    expect(frag).toContain('<P Name="Name" Class="char">');
    expect(frag).toContain('<P Name="UUID" Class="char">');
    expect(frag).toContain('<P Name="Namespace" Class="char">');
    expect(frag).toContain('<P Name="LastMod" Class="char">');
    expect(frag).toContain('<P Name="LastModBy" Class="char">');
    expect(frag).toContain('<P Name="IsDerived" Class="char">');
    expect(frag).toContain('Name="Value"');
    expect(frag.trimEnd().endsWith('</Object>')).toBe(true);
  });

  it('preserves _rawLastMod (no date bump)', () => {
    const model = freshModel('mem://ser3');
    const entry = model.children.flatMap((s: any) => s.children)[0];
    const raw = entry.metadata._rawLastMod as string;
    expect(serializeEntryToXml(entry)).toContain('<P Name="LastMod" Class="char">' + raw + '</P>');
  });
});
