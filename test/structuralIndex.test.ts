// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGraphSource, type RawFile } from '../src/host/structuralIndex.js';

function raw(name: string): RawFile {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return {
    uriString: `file:///${name}`,
    path: `/${name}`,
    bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  };
}

describe('buildGraphSource', () => {
  it('extracts model relationships from an .slx', () => {
    const s = buildGraphSource(raw('model_with_refs.slx'));
    expect(s.type).toBe('model');
    expect(s.modelRefs).toContain('plant.slx');
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.dataSources).toContain('signals.mat');
  });

  it('treats a compressed .sldd as an sldd node with no references', () => {
    const s = buildGraphSource(raw('compressed.sldd'));
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual([]); // parseBinarySldd hardcodes empty refs (known limitation)
  });

  it('treats a JSON .sldd via its text', () => {
    const s = buildGraphSource({
      uriString: 'file:///j.sldd',
      path: '/j.sldd',
      text: '{ "Dictionary References": ["base.sldd"] }',
    });
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual(['base.sldd']);
  });

  it('classifies a .mat as a mat node with no outbound refs', () => {
    const s = buildGraphSource({ uriString: 'file:///x.mat', path: '/x.mat', bytes: new ArrayBuffer(0) });
    expect(s.type).toBe('mat');
    expect(s.slddRefs).toEqual([]);
    expect(s.modelRefs).toEqual([]);
  });

  it('extracts object-form references from JSON .sldd text', () => {
    const s = buildGraphSource({
      uriString: 'file:///o.sldd',
      path: '/o.sldd',
      text: '{ "Dictionary References": [{ "file": "base.sldd" }, "extra.sldd"] }',
    });
    expect(s.slddRefs).toEqual(['base.sldd', 'extra.sldd']);
  });

  it('falls back to UTF-8 JSON parsing when a JSON .sldd arrives as bytes (not zip)', () => {
    const json = '{ "Dictionary References": ["fromBytes.sldd"] }';
    const bytes = new TextEncoder().encode(json);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const s = buildGraphSource({ uriString: 'file:///b.sldd', path: '/b.sldd', bytes: ab });
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual(['fromBytes.sldd']);
  });

  it('returns an empty sldd node when text is malformed JSON (no throw)', () => {
    const s = buildGraphSource({ uriString: 'file:///bad.sldd', path: '/bad.sldd', text: '{ oops' });
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual([]);
  });

  it('returns an empty model node when an .slx has no bytes', () => {
    const s = buildGraphSource({ uriString: 'file:///m.slx', path: '/m.slx' });
    expect(s.type).toBe('model');
    expect(s.modelRefs).toEqual([]);
    expect(s.dataSources).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });

  it('tolerates a corrupt .slx buffer, yielding an empty model node', () => {
    const s = buildGraphSource({ uriString: 'file:///c.slx', path: '/c.slx', bytes: new ArrayBuffer(4) });
    expect(s.type).toBe('model');
    expect(s.modelRefs).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });

  it('returns an empty sldd node when neither text nor bytes are provided', () => {
    const s = buildGraphSource({ uriString: 'file:///n.sldd', path: '/n.sldd' });
    expect(s.type).toBe('sldd');
    expect(s.slddRefs).toEqual([]);
  });

  it('preserves uriString and path verbatim on the produced source', () => {
    const s = buildGraphSource({ uriString: 'file:///deep/path/x.mat', path: '/deep/path/x.mat', bytes: new ArrayBuffer(0) });
    expect(s.uriString).toBe('file:///deep/path/x.mat');
    expect(s.path).toBe('/deep/path/x.mat');
  });

  it('classifies extension case-insensitively is NOT assumed — .SLDD upper falls through to sldd default', () => {
    // typeOf only matches lowercase .slx/.mat; anything else is 'sldd'. Documents current behavior.
    const s = buildGraphSource({ uriString: 'file:///X.MAT', path: '/X.MAT', bytes: new ArrayBuffer(0) });
    expect(s.type).toBe('sldd');
  });
});
