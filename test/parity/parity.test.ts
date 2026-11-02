// Copyright 2026 The MathWorks, Inc.
// Parity check: read REAL MATLAB-generated dictionaries the way the host does and compare
// their content to the generator's ground_truth.json: params.sldd, in both on-disk formats,
// through view's host entry (getModel / getModelFromBytes) and core's DataModel.
//
// The rest of what this file once checked is proven upstream: the relationships the tree
// draws (Phase 1) by view's test/hierarchyParity.test.ts over the same artifacts, the two
// formats of params.sldd agreeing by view's test/parity/paramsTextBinary.test.ts, and the MAT
// and model content (Phase 4) by core's .slx layout parity. These content checks are being
// ported into core verbatim (task B2.9), and retire when they land there.
//
// Fixtures are produced by test/parity/generate.m (run under real MATLAB) into
// test/parity/artifacts/{text,binary}/. If they are absent the suite is skipped
// with a clear message rather than failing spuriously.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes, invalidate } from 'data-explorer-view/host';

const ART = (variant: string, name: string) =>
  fileURLToPath(new URL(`./artifacts/${variant}/${name}`, import.meta.url));
const GT_PATH = fileURLToPath(new URL('./ground_truth.json', import.meta.url));

const HAVE_FIXTURES = existsSync(GT_PATH) && existsSync(ART('text', 'params.sldd'));

function bytesOf(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function textOf(path: string): string {
  return readFileSync(path, 'utf8');
}

let GT: any = null;
beforeAll(() => {
  if (HAVE_FIXTURES) GT = JSON.parse(textOf(GT_PATH));
});

const VARIANTS = ['text', 'binary'] as const;

(HAVE_FIXTURES ? describe : describe.skip)('PARITY', () => {
  if (!HAVE_FIXTURES) {
    it('fixtures missing — run test/parity/generate.m under MATLAB', () => {
      expect(HAVE_FIXTURES).toBe(false);
    });
    return;
  }

  // ============================================================
  // PHASE 2 & 3 — Content parity (Tier-2 detailed parser)
  // ============================================================
  describe.each(VARIANTS)('Phase 2/3: sldd content [%s]', (variant) => {
    let node: any;
    let byEntry: Map<string, any>;
    beforeAll(() => {
      const uri = `test://content/${variant}/params.sldd`;
      const path = ART(variant, 'params.sldd');
      const raw = readFileSync(path);
      const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
      // Route through the same host entry point used in production.
      invalidate(uri);
      node = isZip
        ? getModelFromBytes(uri, 'params.sldd', bytesOf(path))
        : getModel(uri, 'params.sldd', raw.toString('utf8'));
      byEntry = new Map();
      for (const section of node.children ?? []) {
        for (const entry of section.children ?? []) byEntry.set(entry.name, entry);
      }
    });

    it('all ground-truth entries are present as nodes', () => {
      const expected: string[] = GT[variant].params.stored;
      const missing = expected.filter((n) => !byEntry.has(n));
      expect(missing).toEqual([]);
    });

    // ---- primitives (Phase 2) ----
    it('double scalar scalarD = 3.14', () => {
      expect(Number(byEntry.get('scalarD').Value)).toBeCloseTo(3.14, 10);
    });
    it('int32 scalar i32Scalar = 42', () => {
      expect(String(byEntry.get('i32Scalar').displayValue)).toContain('42');
    });
    it('uint8 scalar u8Scalar = 200', () => {
      expect(String(byEntry.get('u8Scalar').displayValue)).toContain('200');
    });
    it('logical scalar boolFlag = true', () => {
      const dv = String(byEntry.get('boolFlag').displayValue);
      expect(dv === 'true' || dv === '1').toBe(true);
    });
    it('char row charStr = hello', () => {
      expect(String(byEntry.get('charStr').displayValue)).toContain('hello');
    });
    it('string scalar strScalar = worldString', () => {
      expect(String(byEntry.get('strScalar').displayValue)).toContain('worldString');
    });
    it('row vector rowVec = [10 20 30 40]', () => {
      const dv = String(byEntry.get('rowVec').displayValue).replace(/[[\],]/g, ' ');
      for (const n of [10, 20, 30, 40]) expect(dv).toContain(String(n));
    });
    it('2x2 matrix mat2x2 preserves 1 2 3 4', () => {
      const dv = String(byEntry.get('mat2x2').displayValue).replace(/[[\];,]/g, ' ');
      for (const n of [1, 2, 3, 4]) expect(dv).toContain(String(n));
    });
    it('string array strArray has 3 elements a bb ccc', () => {
      const n = byEntry.get('strArray');
      const dv = String(n.displayValue);
      for (const s of ['a', 'bb', 'ccc']) expect(dv).toContain(s);
    });
    it('scalar struct myStruct has fields a b c', () => {
      const n = byEntry.get('myStruct');
      const childNames = (n.children ?? []).map((c: any) => c.name);
      expect(childNames).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    });

    // ---- Simulink object types (Phase 3) ----
    it('Simulink.Parameter gravity parses as object node with Value 9.81', () => {
      const n = byEntry.get('gravity');
      expect(n).toBeTruthy();
      // ObjectNode exposes properties; look for 9.81 in a row/property dump.
      const dump = JSON.stringify(safeRow(n)) + JSON.stringify(n.serial ?? {});
      expect(dump).toContain('9.81');
    });

    it.each([
      'gravity', 'pInt16', 'sig1', 'MyBus', 'MyConnBus', 'MyNumType', 'MyAlias',
      'MyValueType', 'MyEnum', 'MyLUT', 'MyBkpt', 'MyVarCtrl', 'MyVarExpr', 'MyVarVar',
    ])('Simulink object %s produces a non-crashing table row', (name) => {
      const n = byEntry.get(name);
      if (!n) {
        // Not stored by MATLAB in this variant — only fail if GT says it was.
        const stored: string[] = GT[variant].params.stored;
        expect(stored).not.toContain(name);
        return;
      }
      const row = safeRow(n);
      expect(row).not.toBeNull();
      expect(row.Name).toBeTruthy();
    });

    it('Simulink typed structure resolves correct className + children', () => {
      expect(byEntry.get('MyAlias').className).toBe('Simulink.AliasType');
      expect(byEntry.get('MyBus').children.map((c: any) => c.name)).toEqual(['x', 'y']);
      expect(byEntry.get('MyConnBus').children.map((c: any) => c.name)).toEqual(['c1']);
      expect(byEntry.get('sig1').className).toBe('Simulink.Signal');
    });
  });
});

function safeRow(n: any): any {
  try {
    return n.toRow();
  } catch {
    return null;
  }
}
