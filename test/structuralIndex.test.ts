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

// A minimal but REAL project store (resources/project/**/*.xml), mirroring the
// hash-linked layout parseProject expects. Kept local so this test drives the
// buildGraphSource -> parseProject integration end-to-end with genuine input,
// not a stub: two member files under two folders, plus a project->project
// reference, so we can assert basenames, folder filtering, and refs.
function projectStore(): Record<string, string> {
  const DECL = '<?xml version="1.0" encoding="UTF-8"?>';
  const info = (body: string): string => `${DECL}\n${body}`;
  const p = (rel: string): string => `resources/project/${rel}`;
  const store: Record<string, string> = {};

  // root/ entry pointers.
  store[p('root/AAAAAAAAAAAAAAAAAAAAAAAAAAAAp.xml')] = info('<Info location="ProjectData" type="Info"/>');
  store[p('root/AAAAAAAAAAAAAAAAAAAAAAAAAAAAd.xml')] = info('<Info Name="Widget"/>');
  store[p('root/BBBBBBBBBBBBBBBBBBBBBBBBBBBBp.xml')] = info('<Info location="Root" type="Files"/>');
  // A genuine project->project reference living directly in root.
  store[p('root/GGGGGGGGGGGGGGGGGGGGGGGGGGGGp.xml')] = info('<Info location="ref-uuid" type="Reference"/>');
  store[p('root/GGGGGGGGGGGGGGGGGGGGGGGGGGGGd.xml')] = info('<Info Ref="SharedLib" Type="Relative"/>');
  // A reference whose def carries no Ref → its name is null, so buildGraphSource
  // falls back to the id (the pointer location). Exercises `r.name ?? r.id`.
  store[p('root/HHHHHHHHHHHHHHHHHHHHHHHHHHHHp.xml')] = info('<Info location="nameless-uuid" type="Reference"/>');
  store[p('root/HHHHHHHHHHHHHHHHHHHHHHHHHHHHd.xml')] = info('<Info Type="Relative"/>');

  // Files collection (hash BBB...): one File 'models', one File 'helper.m'.
  const files = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  store[p(`${files}/DDDDDDDDDDDDDDDDDDDDDDDDDDDDp.xml`)] = info('<Info location="models" type="File"/>');
  store[p(`${files}/DDDDDDDDDDDDDDDDDDDDDDDDDDDDd.xml`)] = info('<Info/>');
  store[p(`${files}/EEEEEEEEEEEEEEEEEEEEEEEEEEEEp.xml`)] = info('<Info location="helper.m" type="File"/>');
  store[p(`${files}/EEEEEEEEEEEEEEEEEEEEEEEEEEEEd.xml`)] = info('<Info/>');

  // 'models' File entity's own dir (hash DDD...) carries a DIR_SIGNIFIER → folder.
  const models = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDD';
  store[p(`${models}/FFFFFFFFFFFFFFFFFFFFFFFFFFFFp.xml`)] = info('<Info location="1" type="DIR_SIGNIFIER"/>');
  store[p(`${models}/FFFFFFFFFFFFFFFFFFFFFFFFFFFFd.xml`)] = info('<Info/>');

  return store;
}

describe('buildGraphSource — .prj project branch', () => {
  it('maps a project to member basenames (files only, folders excluded) and its references', () => {
    const s = buildGraphSource({
      uriString: 'file:///proj/Widget.prj',
      path: '/proj/Widget.prj',
      projectFiles: projectStore(),
    });

    expect(s.type).toBe('project');
    // helper.m is a File (basename); 'models' is a folder and must be excluded.
    expect(s.projectFiles).toContain('helper.m');
    expect(s.projectFiles).not.toContain('models');
    // The project->project reference name is surfaced.
    expect(s.projectRefs).toContain('SharedLib');
    // A reference with no resolvable name falls back to its id (location).
    expect(s.projectRefs).toContain('nameless-uuid');
    // Base GraphSource fields stay intact.
    expect(s.slddRefs).toEqual([]);
    expect(s.modelRefs).toEqual([]);
  });

  it('returns an empty project node when a .prj has no projectFiles map', () => {
    // Without projectFiles the project branch is skipped and the base node
    // (no members/refs) is returned — never a throw.
    const s = buildGraphSource({ uriString: 'file:///p.prj', path: '/p.prj' });
    expect(s.type).toBe('project');
    expect(s.projectFiles).toBeUndefined();
    expect(s.projectRefs).toBeUndefined();
    expect(s.dataDictionary).toBeNull();
  });

  it('tolerates an empty project store, yielding no members and no refs', () => {
    const s = buildGraphSource({
      uriString: 'file:///empty/Empty.prj',
      path: '/empty/Empty.prj',
      projectFiles: {},
    });
    expect(s.type).toBe('project');
    expect(s.projectFiles).toEqual([]);
    expect(s.projectRefs).toEqual([]);
  });
});

describe('buildGraphSource — error path returns the base node', () => {
  it('returns the base node (no throw) when a JSON .sldd getter throws mid-extract', () => {
    // Force an exception inside the try: a text property whose getter throws.
    // buildGraphSource must catch it and return the empty base node for the URI.
    const file = {
      uriString: 'file:///boom.sldd',
      path: '/boom.sldd',
    } as RawFile;
    Object.defineProperty(file, 'text', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });

    const s = buildGraphSource(file);
    expect(s.type).toBe('sldd');
    expect(s.uriString).toBe('file:///boom.sldd');
    expect(s.slddRefs).toEqual([]);
    expect(s.modelRefs).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });
});
