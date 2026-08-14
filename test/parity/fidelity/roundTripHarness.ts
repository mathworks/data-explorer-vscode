// Copyright 2026 The MathWorks, Inc.
//
// Shared fidelity round-trip harness for the MATLAB-parity test suite. Provides
// the UI-edit -> serialize -> re-parse loop for BOTH sldd formats, plus an
// optional live MATLAB value-equality gate (skipped automatically when MATLAB
// isn't reachable, so the suite stays green in CI).
//
// The MATLAB gate is the definitive proof that a UI edit produces data MATLAB
// agrees with: it writes the serialized dictionary to a temp file, opens it in
// MATLAB, reads the edited property back via the MATLAB API, and asserts the
// value AND type equal what we set. See verify_roundtrip.m.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes, invalidate } from '../../../src/host/SlddModel.js';
import { buildRows } from '../../../src/host/rowBuilder.js';
import { serializeBinarySldd } from '../../../src/dex/datamodel/parser/BinarySlddSerializer.js';
import '../../../src/dex/datamodel/node/NodeClassMap.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// MATLAB launcher, configured out-of-band so no environment-specific path is
// committed. Presence gates the live re-open assertions; when unset (CI /
// external contributors) the value-equality gate is skipped and only the
// in-process re-parse invariants run — so the suite stays green everywhere.
//   DEX_MATLAB_CMD : the matlab-launching executable + fixed args (e.g. "mw matlab")
//   DEX_MATLAB_CWD : optional working directory the launcher must run from
const MATLAB_LAUNCH = process.env.DEX_MATLAB_CMD || '';
const MATLAB_CWD = process.env.DEX_MATLAB_CWD || undefined;

export type SlddFormat = 'json' | 'binary';

/** Load a fresh model for a fixture in the given format. */
export function loadModel(format: SlddFormat, fixture: string, uri: string): any {
  invalidate(uri);
  const dir = format === 'json' ? 'text' : 'binary';
  const p = fileURLToPath(new URL(`../artifacts/${dir}/${fixture}`, import.meta.url));
  if (format === 'json') {
    return getModel(uri, fixture, readFileSync(p, 'utf8'));
  }
  const raw = readFileSync(p);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return getModelFromBytes(uri, fixture, ab);
}

/** Find a top-level entry node by name. */
export function entryByName(model: any, uri: string, name: string): any {
  const rows = buildRows(model);
  const row = rows.find(
    (r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'),
  );
  if (!row) throw new Error(`no entry "${name}"`);
  // findNode via the model cache
  const stack = [...(model.children ?? [])];
  while (stack.length) {
    const n = stack.shift();
    if (n?.id === row.ID) return n;
    if (n?.children) stack.push(...n.children);
  }
  throw new Error(`node not found for "${name}"`);
}

/** Serialize the whole model back to bytes/text for the given format. */
export function serializeModel(model: any, format: SlddFormat): Uint8Array {
  if (format === 'binary') {
    return new Uint8Array(serializeBinarySldd(model));
  }
  const json = JSON.stringify(model.serialize(), null, '\t');
  return new TextEncoder().encode(json);
}

/**
 * Full in-process round trip: reparse the serialized bytes and return the fresh
 * entry node, so a test can assert the edited value survived.
 */
export function reparseEntry(bytes: Uint8Array, format: SlddFormat, fixture: string, name: string): any {
  const uri = `test://rt-${Math.abs(hash(name + format))}.sldd`;
  invalidate(uri);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const model =
    format === 'json'
      ? getModel(uri, fixture, new TextDecoder().decode(bytes))
      : getModelFromBytes(uri, fixture, ab as ArrayBuffer);
  return entryByName(model, uri, name);
}

export function matlabAvailable(): boolean {
  return MATLAB_LAUNCH.length > 0;
}

/**
 * Live MATLAB value-equality gate. Writes `bytes` to a temp .sldd, runs
 * verify_roundtrip.m, and returns the per-assertion result lines. Throws if any
 * assertion FAILs. No-op (returns null) when MATLAB isn't configured.
 *
 * `expected` maps a property path to the value we set (see verify_roundtrip.m):
 *   { Min: 5, "CoderInfo.StorageClass": "ExportedGlobal", __class__: "Simulink.Parameter" }
 */
export function matlabAssertRoundTrip(
  bytes: Uint8Array,
  entryName: string,
  expected: Record<string, unknown>,
): string | null {
  if (!matlabAvailable()) return null;
  const dir = mkdtempSync(join(tmpdir(), 'dexfid-'));
  const slddPath = join(dir, 'rt.sldd');
  writeFileSync(slddPath, bytes);
  // MATLAB's jsondecode maps any non-identifier char in a JSON key to a plain
  // '_', destroying dotted/indexed paths. To survive the trip we pre-encode each
  // key's non-identifier chars as _0xHH_ (all valid identifier chars, so
  // jsondecode passes them through) and verify_roundtrip.m decodes them back.
  // Keys already in this form (e.g. "CoderInfo_0x2E_StorageClass") are untouched.
  const spec = JSON.stringify(encodeSpecKeys(expected));
  const cmd = `cd('${HERE}'); verify_roundtrip('${slddPath}','${entryName}','${spec.replace(/'/g, "''")}')`;
  const [bin, ...args] = MATLAB_LAUNCH.split(' ');
  const out = execFileSync(bin, [...args, '-nodesktop', '-batch', cmd], {
    encoding: 'utf8',
    cwd: MATLAB_CWD,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!/RESULT PASS/.test(out)) {
    throw new Error('MATLAB round-trip gate failed:\n' + out);
  }
  return out;
}

/**
 * Encode each spec key's non-identifier characters as _0xHH_ so it survives
 * MATLAB's jsondecode intact. Identifier chars (A-Z a-z 0-9 _) pass through, so
 * a key already hand-encoded on the JS side (e.g. "CoderInfo_0x2E_StorageClass")
 * is a fixed point of this transform. A leading underscore is left as-is:
 * jsondecode prefixes such keys with 'x' and verify_roundtrip.m strips it.
 */
function encodeSpecKeys(spec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    const enc = k.replace(/[^A-Za-z0-9_]/g, (c) => `_0x${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}_`);
    out[enc] = v;
  }
  return out;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
