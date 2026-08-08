// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Importing the class map registers the NodeRegistry the parsers route through.
import '../src/dex/datamodel/node/NodeClassMap.js';
import * as NodeRegistry from '../src/dex/datamodel/node/NodeRegistry.js';
import MatNode from '../src/dex/datamodel/node/container/MatNode.js';
import ModelNode from '../src/dex/datamodel/node/container/ModelNode.js';
import { parseMat } from '../src/dex/datamodel/parser/MatParser.js';
import { parseSlx } from '../src/dex/datamodel/parser/SlxParser.js';

// The unification guarantee: one node class per Simulink entry type, with the SAME
// property values, regardless of source format. Parsing is format-specific (the
// SLDD path reads JSON; the .slx/.mat paths decode the binary MCOS blob) but all
// paths converge on the same typed data-model node via NodeRegistry.parseValue.
//
// These fixtures were generated in MATLAB with KNOWN non-default values (see
// test/tools/mcos/gen_fixtures.m and manifest.json) and saved in every format, so
// the binary MCOS decoder can be validated against both the manifest and the SLDD
// (JSON) path acting as an oracle.

function fixture(name: string): ArrayBuffer {
  const path = fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url));
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// A stable signature of the user-visible node state, compared across formats.
interface NodeSig {
  className: string;
  displayValue: string;
  Min: unknown;
  Max: unknown;
  Unit: unknown;
  Description: unknown;
  childCount: number;
}
function sigOf(n: any): NodeSig {
  return {
    className: n.className,
    displayValue: n.displayValue,
    Min: n.Min,
    Max: n.Max,
    Unit: n.Unit,
    Description: n.Description,
    childCount: n.children.length,
  };
}

const ENTRY_NAMES = ['Param', 'ParamMat', 'Sig', 'Numeric', 'Alias', 'Bp', 'Lut'];

// ---- SLDD (JSON) oracle: parse each entry's value straight through parseValue ---
function slddSignatures(): Record<string, NodeSig> {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/mcos/all.sldd', import.meta.url)), 'utf8'));
  const entries: any[] = [];
  (function walk(o: any): void {
    if (Array.isArray(o)) {
      o.forEach(walk);
    } else if (o && typeof o === 'object') {
      if (Array.isArray(o.entries)) {
        for (const e of o.entries) {
          if (e && e.name && e.value) entries.push(e);
        }
      }
      for (const k of Object.keys(o)) walk(o[k]);
    }
  })(json);
  const out: Record<string, NodeSig> = {};
  for (const e of entries) {
    const node = NodeRegistry.parseValue(e.value, e.name, null);
    out[e.name] = sigOf(node);
  }
  return out;
}

// ---- MCOS .mat: one object per file, decoded through the real MatNode pipeline --
function matSignature(name: string): NodeSig {
  const node = MatNode.fromParsed(parseMat(fixture(`${name}.mat`)), `${name}.mat`) as any;
  const child = node.children.find((c: any) => c.name === name);
  return sigOf(child);
}

// ---- MCOS .slx: all objects in the model workspace, via ModelNode pipeline -------
function slxSignatures(): Record<string, NodeSig> {
  const model = ModelNode.fromParsed(parseSlx(fixture('mcosfix.slx'), 'mcosfix.slx'), 'mcosfix.slx') as any;
  const ws = model.getSection('workspace');
  const out: Record<string, NodeSig> = {};
  for (const c of ws.children) out[c.name] = sigOf(c);
  return out;
}

describe('MCOS cross-format unification — same node class + values in every format', () => {
  const sldd = slddSignatures();
  const slx = slxSignatures();

  it.each(ENTRY_NAMES)('%s decodes identically from SLDD-JSON, .mat, and .slx', (name) => {
    const oracle = sldd[name];
    const mat = matSignature(name);
    expect(oracle, `SLDD oracle missing ${name}`).toBeDefined();
    expect(slx[name], `.slx missing ${name}`).toBeDefined();
    // The binary (.mat / .slx) decode must reproduce the SLDD (JSON) values exactly.
    expect(mat).toEqual(oracle);
    expect(slx[name]).toEqual(oracle);
  });

  it('decodes the Parameter scalar value, min, max, unit, description (Param)', () => {
    const p = matSignature('Param');
    expect(p.className).toBe('Simulink.Parameter');
    expect(p.displayValue).toBe('42');
    expect(p.Min).toBe(-1);
    expect(p.Max).toBe(100);
    expect(p.Unit).toBe('m/s');
    expect(p.Description).toBe('hello');
  });

  it('decodes a matrix Parameter value in row-major display form (ParamMat)', () => {
    const p = matSignature('ParamMat');
    expect(p.className).toBe('Simulink.Parameter');
    expect(p.displayValue).toBe('[1 2 3; 4 5 6]');
    expect(p.Description).toBe('matrix');
  });

  it('decodes Signal min/max/unit/description (Sig)', () => {
    const s = matSignature('Sig');
    expect(s.className).toBe('Simulink.Signal');
    expect(s.Min).toBe(-5);
    expect(s.Max).toBe(5);
    expect(s.Unit).toBe('V');
    expect(s.Description).toBe('sigdesc');
  });

  it('decodes NumericType and AliasType descriptions', () => {
    expect(matSignature('Numeric').Description).toBe('numdesc');
    expect(matSignature('Alias').Description).toBe('aliasdesc');
  });

  it('routes Breakpoint and LookupTable to their typed classes', () => {
    expect(matSignature('Bp').className).toBe('Simulink.Breakpoint');
    expect(matSignature('Lut').className).toBe('Simulink.LookupTable');
  });
});
