// Copyright 2026 The MathWorks, Inc.
// Host-integration coverage for `.mdl`, the OTHER container a Simulink model can
// live in. Three on-disk forms reach this host, and only two of them are a `.slx`:
//
//   .slx           a ZIP OPC package
//   .mdl MODERN    the SAME part set, written as text with __MWOPC_PART_BEGIN__
//                  delimiters and binary parts base64'd (what save_system writes)
//   .mdl CLASSIC   the pre-R2012 nested-brace text format (`Model { Name "x" ... }`)
//
// Which one a file holds is decided by its BYTES, in core's parseModel — never by
// its extension. These tests drive the host layers that call it (slxStructure,
// structuralIndex, SlddModel) so the wiring is pinned, not just core's parser
// (which the core repo tests directly, including the MATLAB parity suite).
//
// The fixtures come from test/fixtures/make-fixtures.mjs. model_with_refs.mdl is a
// deliberate TWIN of model_with_refs.slx — same parts, different framing — so the
// twin assertions below test the framing rather than two models that happen to
// agree.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseModel } from 'data-explorer-core';
import { extractSlxStructure } from '../src/host/slxStructure.js';
import { buildGraphSource } from '../src/host/structuralIndex.js';
import { getModelFromBytes } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { namesFromSlx } from '../src/host/nameExtract.js';

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const MODERN = 'model_with_refs.mdl';
const CLASSIC = 'legacy_ctrl.mdl';
const SLX_TWIN = 'model_with_refs.slx';

describe('extractSlxStructure on a MODERN .mdl', () => {
  it('reads the same relationships as its .slx twin, byte-for-byte identical parts', () => {
    // The two fixtures share one part set, so any difference here is the FRAMING:
    // if the delimiter walk lost a part or kept the framing newline as part data,
    // the JSON parts stop parsing and these fields go empty/null.
    const mdl = extractSlxStructure(bytes(MODERN), MODERN);
    const slx = extractSlxStructure(bytes(SLX_TWIN), SLX_TWIN);
    expect(mdl).toEqual(slx);
    expect(mdl.dataDictionary).toBe('params.sldd');
    expect(mdl.modelReferences).toEqual(['plant.slx']);
    expect(mdl.externalDataSources).toEqual(['signals.mat']);
  });

  it('decodes a BASE64 part, not just the plain-text ones', () => {
    // metadata/coreProperties.xml is base64 in the fixture, which is how a real
    // `.mdl` carries its binary parts (the .mxarray model workspace above all).
    // A missing decode leaves `release` empty rather than throwing, so nothing else
    // in the host would notice — the file would just quietly lose its workspace.
    const parsed = parseModel(bytes(MODERN), MODERN) as { release?: string };
    expect(parsed.release).toBe('R2026b');
  });
});

describe('extractSlxStructure on a CLASSIC .mdl', () => {
  it('reads the brace format’s dictionary, reference, and external data source', () => {
    const s = extractSlxStructure(bytes(CLASSIC), CLASSIC);
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.externalDataSources).toEqual(['signals.mat']);
  });

  it('completes a bare reference with .mdl — the PARENT’s extension, not .slx', () => {
    // The classic format records `legacy_ctrl/Plant|plant`, i.e. the model name
    // `plant` with no extension. A legacy hierarchy is legacy throughout, so the
    // file on disk is plant.mdl; naming it plant.slx would resolve to nothing and
    // the model would show a phantom unresolved reference.
    const s = extractSlxStructure(bytes(CLASSIC), CLASSIC);
    expect(s.modelReferences).toEqual(['plant.mdl']);
  });

  it('is not thrown off by the ZIP-shaped parser: no relationships would be empty', () => {
    // Guard against a regression to parseSlx here. parseSlx on classic-brace text
    // throws "invalid zip data", the catch returns the all-empty structure, and a
    // legacy model silently shows no relationships at all — no error anywhere.
    const s = extractSlxStructure(bytes(CLASSIC), CLASSIC);
    expect(s.dataDictionary).not.toBeNull();
    expect(s.modelReferences.length).toBeGreaterThan(0);
  });
});

describe('the BYTES decide the format, not the filename', () => {
  it('parses modern-.mdl text handed over under a .slx name', () => {
    // Real workspaces contain renamed and mislabelled files. parseModel sniffs the
    // ZIP magic and falls back to the text reader, so this opens rather than
    // failing with "invalid zip data".
    const s = extractSlxStructure(bytes(MODERN), 'mislabelled.slx');
    expect(s.dataDictionary).toBe('params.sldd');
  });

  it('parses a real ZIP .slx handed over under a .mdl name', () => {
    const s = extractSlxStructure(bytes(SLX_TWIN), 'mislabelled.mdl');
    expect(s.dataDictionary).toBe('params.sldd');
    // The reference is already suffixed in the fixture, so the parent-extension
    // rule does not fire and cannot double-suffix it.
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('still returns empty relationships for bytes that are neither', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.mdl');
    expect(s).toEqual({ dataDictionary: null, modelReferences: [], externalDataSources: [] });
  });
});

describe('buildGraphSource classifies a .mdl as a model', () => {
  const raw = (name: string) => ({
    uriString: `file:///${name}`,
    path: `/${name}`,
    bytes: bytes(name),
  });

  it('gives a modern .mdl the model type and its full relationship set', () => {
    // Before this, typeOf fell through to the 'sldd' default: the file appeared in
    // the Sections tree with a dictionary icon and NO children, because the sldd
    // branch looked for dictionary references in a model.
    const s = buildGraphSource(raw(MODERN));
    expect(s.type).toBe('model');
    expect(s.modelRefs).toEqual(['plant.slx']);
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.dataSources).toEqual(['signals.mat']);
  });

  it('gives a classic .mdl the model type too', () => {
    const s = buildGraphSource(raw(CLASSIC));
    expect(s.type).toBe('model');
    expect(s.modelRefs).toEqual(['plant.mdl']);
    expect(s.dataDictionary).toBe('params.sldd');
  });

  it('classifies an upper-cased .MDL as a model as well', () => {
    // The extension matchers are case-insensitive because these files live on
    // case-insensitive filesystems; a .MDL classified as 'sldd' would be the same
    // wrong-icon/no-children failure as above.
    const s = buildGraphSource({ uriString: 'file:///L.MDL', path: '/L.MDL', bytes: bytes(CLASSIC) });
    expect(s.type).toBe('model');
  });

  it('yields an empty model node for a corrupt .mdl rather than aborting the scan', () => {
    const s = buildGraphSource({ uriString: 'file:///c.mdl', path: '/c.mdl', bytes: new ArrayBuffer(4) });
    expect(s.type).toBe('model');
    expect(s.modelRefs).toEqual([]);
    expect(s.dataDictionary).toBeNull();
  });
});

describe('getModelFromBytes opens a .mdl as a model tree', () => {
  it('builds the same section rows for a modern .mdl as for its .slx twin', () => {
    const mdlRows = buildRows(getModelFromBytes(`test://a/${MODERN}`, MODERN, bytes(MODERN)));
    const slxRows = buildRows(getModelFromBytes(`test://a/${SLX_TWIN}`, SLX_TWIN, bytes(SLX_TWIN)));
    const sections = (rows: any[]) =>
      rows.filter((r) => String(r.ID).startsWith('section:')).map((r) => r.ID);
    expect(sections(mdlRows)).toEqual(sections(slxRows));
    expect(sections(mdlRows)).toContain('section:references');
    expect(sections(mdlRows)).toContain('section:dataSources');
  });

  it('names a classic .mdl’s reference row plant.mdl, matching the graph', () => {
    // Core's ModelSectionNode.addReferenceEntry completes the bare name for the
    // TREE; slxStructure.refModelExt completes it for the GRAPH. They have to agree
    // or the tree row and the graph edge point at two different files.
    const node = getModelFromBytes(`test://a/${CLASSIC}`, CLASSIC, bytes(CLASSIC));
    const rows = buildRows(node);
    const refNames = rows
      .filter((r: any) => r.parent === 'section:references')
      .map((r: any) => (typeof r.Name === 'object' ? r.Name.label : r.Name));
    expect(refNames).toContain('plant.mdl');
  });

  it('surfaces a classic .mdl’s blocks, so its parameters are searchable', () => {
    // namesFromSlx is what feeds the workspace name index. A classic model whose
    // blocks never arrive is a file you can open but cannot find anything in.
    const parsed = parseModel(bytes(CLASSIC), CLASSIC) as any;
    const names = namesFromSlx(parsed, `file:///${CLASSIC}`);
    const blocks = names.filter((n) => n.kind === 'block').map((n) => n.name);
    expect(blocks).toEqual(['Gain1', 'Setpoint']);
  });

  it('records the classic block parameters that reference variables', () => {
    const parsed = parseModel(bytes(CLASSIC), CLASSIC) as any;
    const usages = (parsed.blockParamUsages ?? []).map(
      (u: any) => `${u.blockName}/${u.paramProperty}=${u.paramValue}`,
    );
    // Gain "Kp" and Value "Uo" are the two variable-valued params in the fixture;
    // identity props (Name, BlockType) must not be mistaken for parameters.
    expect(usages).toEqual(['Gain1/Gain=Kp', 'Setpoint/Value=Uo']);
  });
});
