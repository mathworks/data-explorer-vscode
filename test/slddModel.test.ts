// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModelFromBytes, getModel, invalidate } from '../src/host/SlddModel.js';

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe('getModelFromBytes', () => {
  it('parses an .slx into a model node with the 5 sections', () => {
    const node: any = getModelFromBytes('test://m.slx', 'm.slx', bytes('model_with_refs.slx'));
    const sectionNames = (node.children ?? []).map((c: any) => c.name);
    expect(sectionNames).toEqual(['blocks', 'workspace', 'config', 'references', 'dataSources']);
  });

  it('parses a compressed .sldd into a dictionary node with sections', () => {
    const node: any = getModelFromBytes('test://c.sldd', 'compressed.sldd', bytes('compressed.sldd'));
    expect(Array.isArray(node.children)).toBe(true);
  });

  it('parses a non-zip .sldd supplied as bytes (UTF-8 JSON)', () => {
    const json = JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: { entries: [], 'Dictionary References': [], AllowAccessBWS: false },
        },
      },
    });
    const b = new TextEncoder().encode(json);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const node: any = getModelFromBytes('test://plain.sldd', 'plain.sldd', ab);
    expect(Array.isArray(node.children)).toBe(true);
  });

  it('caches by uriString: a second call returns the same instance', () => {
    const uri = 'test://cache.slx';
    invalidate(uri);
    const a = getModelFromBytes(uri, 'cache.slx', bytes('model_with_refs.slx'));
    const b = getModelFromBytes(uri, 'cache.slx', bytes('model_with_refs.slx'));
    expect(a).toBe(b);
  });

  it('invalidate() forces a fresh parse (new instance)', () => {
    const uri = 'test://reparse.slx';
    invalidate(uri);
    const a = getModelFromBytes(uri, 'reparse.slx', bytes('model_with_refs.slx'));
    invalidate(uri);
    const b = getModelFromBytes(uri, 'reparse.slx', bytes('model_with_refs.slx'));
    expect(a).not.toBe(b);
  });

  it('throws on a corrupt .slx (caller catches to show an error banner)', () => {
    // A 4-byte non-zip buffer is not a valid SLX; DataModel.addModelSource throws.
    expect(() => getModelFromBytes('test://bad.slx', 'bad.slx', new ArrayBuffer(4))).toThrow();
  });

  it('routes a .mat through addMatSource (minimal valid empty MAT)', () => {
    // Level-5 MAT: 128-byte header with little-endian 'IM' at bytes 126-127,
    // then an 8-byte zero terminator => zero variables. Exercises the .mat branch.
    const buf = new Uint8Array(136);
    const header = 'MATLAB 5.0 MAT-file, test';
    for (let i = 0; i < header.length; i++) buf[i] = header.charCodeAt(i);
    buf[124] = 0x00; buf[125] = 0x01; // version
    buf[126] = 0x49; buf[127] = 0x4d; // 'IM' little-endian indicator
    // bytes 128..135 remain zero => terminator (dataType=0, numBytes=0)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    invalidate('test://e.mat');
    const node: any = getModelFromBytes('test://e.mat', 'e.mat', ab);
    expect(node).toBeTruthy();
    expect(Array.isArray(node.children)).toBe(true);
    expect(node.children.length).toBe(0); // no variables
  });
});

describe('getModel (JSON text path, unchanged)', () => {
  it('parses JSON .sldd text into a dictionary node', () => {
    invalidate('test://json.sldd');
    const json = JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: { entries: [], 'Dictionary References': [], AllowAccessBWS: false },
        },
      },
    });
    const node: any = getModel('test://json.sldd', 'json.sldd', json);
    expect(Array.isArray(node.children)).toBe(true);
  });
});
