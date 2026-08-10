// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeMcosBlob, type McosObjectData, type OpaqueVarRef } from '../src/dex/datamodel/parser/McosParser.js';
import { parseMat } from '../src/dex/datamodel/parser/MatParser.js';
import { parseSlx } from '../src/dex/datamodel/parser/SlxParser.js';
import type { MatVariable } from '../src/dex/datamodel/node/data/MatlabVariableNode.js';

// Direct unit tests for the MCOS decoder's OWN contract. mcosCrossFormat.test.ts
// exercises decodeMcosBlob transitively (asserting the resulting typed-node
// signature); here we call it directly and assert the raw McosObjectData it
// returns — the SLDD-shaped `_properties` bag, the Matrix(r,c) value form, the
// per-object linkage, and the confidence gate that skips (never guesses) an object
// whose located class disagrees with the declared class.
//
// The decoder takes the same two inputs both real callers build: the anonymous
// FileWrapper element's raw bytes (the blob), and one OpaqueVarRef per named opaque
// workspace variable. The helpers below reconstruct those inputs exactly as
// MatNode.fromParsed (.mat) and ModelNode.fromParsed (.slx) do.

function fixture(name: string): ArrayBuffer {
  const path = fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url));
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ---- .mat: one object per file. Mirrors MatNode.fromParsed's decode setup. ------
function decodeMat(name: string): Map<string, McosObjectData> {
  const { variables } = parseMat(fixture(`${name}.mat`));
  const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
  const opaque = variables.filter((v) => v.isOpaque && v.name);
  if (!anon?._rawBytes) return new Map();
  return decodeMcosBlob(
    anon._rawBytes,
    opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
  );
}

// ---- .slx: all objects share one blob. Mirrors ModelNode.fromParsed's setup. ----
function decodeSlx(): Map<string, McosObjectData> {
  const { workspace } = parseSlx(fixture('mcosfix.slx'), 'mcosfix.slx');
  const trailing = (workspace as unknown as { _trailingElements?: Uint8Array[] })._trailingElements;
  const opaque = (workspace as MatVariable[]).filter((v) => v.isOpaque && v.name);
  if (!trailing || trailing.length === 0) return new Map();
  return decodeMcosBlob(
    trailing[0],
    opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
  );
}

// Expected raw property values per entry, keyed as the decoder emits them. Note the
// binary path exposes `DocUnits` (the typed node maps it to Unit) — the decoder is
// NOT responsible for that rename, so we assert the raw name here.
interface Expected {
  className: string;
  props: Record<string, unknown>;
}
const EXPECTED: Record<string, Expected> = {
  Param: {
    className: 'Simulink.Parameter',
    props: { Value: 42, Min: -1, Max: 100, DataType: 'int32', DocUnits: 'm/s', Description: 'hello' },
  },
  ParamMat: {
    className: 'Simulink.Parameter',
    props: {
      Value: { _type: 'double', _value: 'Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]' },
      Description: 'matrix',
    },
  },
  Sig: {
    className: 'Simulink.Signal',
    props: { Min: -5, Max: 5, DataType: 'single', DocUnits: 'V', Description: 'sigdesc' },
  },
  Numeric: { className: 'Simulink.NumericType', props: { Description: 'numdesc' } },
  Alias: { className: 'Simulink.AliasType', props: { Description: 'aliasdesc' } },
  Bp: { className: 'Simulink.Breakpoint', props: {} },
  Lut: { className: 'Simulink.LookupTable', props: {} },
};
const ENTRY_NAMES = Object.keys(EXPECTED);

// The decoded object must carry the declared class + package/short split, dimensions,
// and every expected property with the exact value the manifest specifies. Extra
// default props (CoderInfo/Complexity/etc.) are allowed — we assert a superset match
// on the ones with known non-default values, plus the class/name identity.
function assertObject(name: string, obj: McosObjectData | undefined): void {
  const exp = EXPECTED[name];
  expect(obj, `decoder returned nothing for ${name}`).toBeDefined();
  expect(obj!.name).toBe(name);
  expect(obj!.className).toBe(exp.className);
  const lastDot = exp.className.lastIndexOf('.');
  expect(obj!.packageName).toBe(exp.className.slice(0, lastDot));
  expect(obj!.shortClassName).toBe(exp.className.slice(lastDot + 1));
  expect(obj!.dimensions).toEqual([1, 1]);
  for (const [k, v] of Object.entries(exp.props)) {
    expect(obj!.properties[k], `${name}.${k}`).toEqual(v);
  }
  // The `value` convenience mirror must equal properties.Value.
  expect(obj!.value).toEqual(obj!.properties.Value);
}

describe('decodeMcosBlob — direct decoder contract (.mat, one object per file)', () => {
  it.each(ENTRY_NAMES)('%s decodes to the expected McosObjectData', (name) => {
    const data = decodeMat(name);
    assertObject(name, data.get(name));
  });

  it('emits a matrix Value as the SLDD Matrix(r,c) string form (row-major)', () => {
    const obj = decodeMat('ParamMat').get('ParamMat')!;
    expect(obj.properties.Value).toEqual({
      _type: 'double',
      _value: 'Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]',
    });
  });

  it('leaves properties with no confidently-resolved value out of the bag', () => {
    // Bp/Lut carry no known non-default scalar props in the manifest; the decoder
    // must not fabricate Value/Min/Max for them.
    const bp = decodeMat('Bp').get('Bp')!;
    expect(bp.properties.Min).toBeUndefined();
    expect(bp.properties.Max).toBeUndefined();
  });
});

describe('decodeMcosBlob — direct decoder contract (.slx, all objects share one blob)', () => {
  const slx = decodeSlx();

  it('decodes every named workspace object from the shared blob', () => {
    // Multi-object linkage: each named var must map to its OWN root object id, so
    // all seven come back distinctly from one metadata table.
    expect(new Set(slx.keys())).toEqual(new Set(ENTRY_NAMES));
  });

  it.each(ENTRY_NAMES)('%s decodes to the expected McosObjectData', (name) => {
    assertObject(name, slx.get(name));
  });
});

describe('decodeMcosBlob — .mat and .slx paths agree on the meaningful values', () => {
  // Both formats must decode the SAME class and the SAME known non-default values.
  // Their FULL property bags are NOT byte-identical: the two binary encodings
  // represent some *default* nested props differently (e.g. .slx carries
  // CoderInfo.CustomAttributes as [] plus HasCoderInfo:false, while .mat carries
  // CustomAttributes as a default object handle). Those defaults never surface in
  // the typed-node columns, so display parity holds regardless — asserting them
  // equal would lock down an encoding accident, not the contract.
  const slx = decodeSlx();
  it.each(ENTRY_NAMES)('%s agrees on class + known values across formats', (name) => {
    const fromMat = decodeMat(name).get(name)!;
    const fromSlx = slx.get(name)!;
    expect(fromSlx.className).toBe(fromMat.className);
    for (const k of Object.keys(EXPECTED[name].props)) {
      expect(fromSlx.properties[k], `${name}.${k}`).toEqual(fromMat.properties[k]);
    }
    expect(fromSlx.value).toEqual(fromMat.value);
  });
});

describe('decodeMcosBlob — refuses to guess (confidence gate + defensive returns)', () => {
  it('returns an empty map when no opaque vars are requested', () => {
    const { variables } = parseMat(fixture('Param.mat'));
    const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
    expect(decodeMcosBlob(anon!._rawBytes!, []).size).toBe(0);
  });

  it('returns an empty map for empty/garbage blob bytes', () => {
    expect(decodeMcosBlob(new Uint8Array(0), [{ name: 'x', className: 'Simulink.Parameter' }]).size).toBe(0);
    expect(decodeMcosBlob(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), [
      { name: 'x', className: 'Simulink.Parameter' },
    ]).size).toBe(0);
  });

  it('skips a var whose declared class disagrees with the located object (never guesses)', () => {
    // The blob genuinely contains a Simulink.Parameter at Param's root id, but we
    // lie about the class. The confidence gate must refuse it rather than return a
    // mislabeled object — a wrong value is worse than an absent one.
    const { variables } = parseMat(fixture('Param.mat'));
    const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
    const real = variables.filter((v) => v.isOpaque && v.name);
    const lied = real.map((v): OpaqueVarRef => ({ name: v.name, className: 'Simulink.Signal', rawBytes: v._rawBytes }));
    expect(decodeMcosBlob(anon!._rawBytes!, lied).size).toBe(0);
  });

  it('drops a var whose raw bytes carry no object handle (no root id)', () => {
    const { variables } = parseMat(fixture('Param.mat'));
    const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
    const orphan: OpaqueVarRef = { name: 'Param', className: 'Simulink.Parameter', rawBytes: new Uint8Array(64) };
    expect(decodeMcosBlob(anon!._rawBytes!, [orphan]).has('Param')).toBe(false);
  });
});
