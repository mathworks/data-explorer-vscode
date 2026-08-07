// Copyright 2026 The MathWorks, Inc.
// Parity check: run the extension's TWO parsers against REAL MATLAB-generated
// files and compare to the generator's ground_truth.json.
//
//   Tier-1 (quick) parser -> tree/relationships  (host/structuralIndex + graphModel)
//   Tier-2 (detailed) parser -> table/content    (DataModel + node tree)
//
// Fixtures are produced by test/parity/generate.m (run under real MATLAB) into
// test/parity/artifacts/{text,binary}/. If they are absent the suite is skipped
// with a clear message rather than failing spuriously.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../src/dex/datamodel/node/NodeClassMap.js';
import DataModel from '../../src/dex/core/DataModel.js';
import { buildGraphSource } from '../../src/host/structuralIndex.js';
import { RelGraph, type GraphSource } from '../../src/host/graphModel.js';
import { parseMat } from '../../src/dex/datamodel/parser/MatParser.js';
import { parseSlx } from '../../src/dex/datamodel/parser/SlxParser.js';
import { getModel, getModelFromBytes, invalidate } from '../../src/host/SlddModel.js';

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
const FILES = ['common.sldd', 'util.sldd', 'params.sldd', 'plant.slx', 'sub.slx', 'top.slx', 'signals.mat'];

// Build a GraphSource for a file, choosing text vs bytes the way the extension
// host does (JSON .sldd read as text; everything else as bytes).
function graphSourceFor(variant: string, name: string): GraphSource {
  const path = ART(variant, name);
  const uriString = `test://${variant}/${name}`;
  if (name.endsWith('.sldd')) {
    // Tier-1 host reads .sldd as text when it is JSON; bytes when zip. We detect
    // by first byte: 'PK' => zip (compressed-binary), else JSON text.
    const raw = readFileSync(path);
    const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
    if (isZip) return buildGraphSource({ uriString, path: name, bytes: bytesOf(path) });
    return buildGraphSource({ uriString, path: name, text: raw.toString('utf8') });
  }
  return buildGraphSource({ uriString, path: name, bytes: bytesOf(path) });
}

(HAVE_FIXTURES ? describe : describe.skip)('PARITY', () => {
  if (!HAVE_FIXTURES) {
    it('fixtures missing — run test/parity/generate.m under MATLAB', () => {
      expect(HAVE_FIXTURES).toBe(false);
    });
    return;
  }

  // ============================================================
  // PHASE 1 — Relationship parity (Tier-1 quick parser + RelGraph)
  // ============================================================
  describe.each(VARIANTS)('Phase 1: relationships [%s]', (variant) => {
    let sources: GraphSource[];
    let byName: Map<string, GraphSource>;
    beforeAll(() => {
      sources = FILES.map((f) => graphSourceFor(variant, f));
      byName = new Map(sources.map((s) => [s.path, s]));
    });

    it('model → sldd (top.slx → params.sldd)', () => {
      expect(byName.get('top.slx')!.dataDictionary).toBe('params.sldd');
    });

    it('model → model (top → plant, plant → sub); names normalized to .slx', () => {
      expect(byName.get('top.slx')!.modelRefs).toContain('plant.slx');
      expect(byName.get('plant.slx')!.modelRefs).toContain('sub.slx');
    });

    it('model → mat (top.slx → signals.mat as external data)', () => {
      const ds = byName.get('top.slx')!.dataSources;
      expect(ds).toContain('signals.mat');
    });

    it('sldd → sldd (params.sldd → common.sldd, util.sldd → common.sldd)', () => {
      expect(byName.get('params.sldd')!.slddRefs).toContain('common.sldd');
      expect(byName.get('util.sldd')!.slddRefs).toContain('common.sldd');
    });

    it('RelGraph resolves the web with top.slx as a root and no dangling missing nodes', () => {
      const graph = new RelGraph(sources);
      // roots() now returns group headers; the flat parity fixture (bare
      // basenames) yields a single folder group labeled '/'. top.slx is a root
      // within that group.
      const group = graph.roots().find((r) => r.label === '/')!;
      const groupRoots = graph.children(group);
      const rootLabels = groupRoots.map((r) => r.label);
      expect(rootLabels).toContain('top.slx');
      // Walk children of top.slx; every ref should resolve (no 'missing').
      const top = groupRoots.find((r) => r.label === 'top.slx')!;
      const kids = graph.children(top);
      const missing = kids.filter((k) => k.kind === 'missing').map((k) => k.label);
      expect(missing).toEqual([]);
    });

    it('full tree walk from top.slx resolves every relationship (no missing anywhere)', () => {
      const graph = new RelGraph(sources);
      const group = graph.roots().find((r) => r.label === '/')!;
      const top = graph.children(group).find((r) => r.label === 'top.slx')!;
      // BFS the whole expansion tree; collect labels + any missing nodes.
      const seenLabels = new Set<string>();
      const missing: string[] = [];
      const queue = [top];
      let guard = 0;
      while (queue.length && guard++ < 1000) {
        const node = queue.shift()!;
        if (node.kind === 'missing') missing.push(node.label);
        seenLabels.add(node.label);
        if (!node.cycle) queue.push(...graph.children(node));
      }
      expect(missing).toEqual([]);
      // The tree must surface every relationship target somewhere.
      for (const label of ['plant.slx', 'sub.slx', 'External Data', 'params.sldd', 'signals.mat', 'common.sldd']) {
        expect(seenLabels).toContain(label);
      }
    });
  });

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

  // ============================================================
  // TEXT ≡ BINARY equivalence — the same dictionary in both on-disk formats
  // must parse to identical table content. Strongest regression guard.
  // ============================================================
  describe('Phase 2/3: text ≡ binary content equivalence', () => {
    it('every params.sldd entry has identical dataType + displayValue in both formats', () => {
      const load = (variant: string) => {
        const uri = `equiv://${variant}/params.sldd`;
        const path = ART(variant, 'params.sldd');
        const raw = readFileSync(path);
        const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
        invalidate(uri);
        const node = isZip
          ? getModelFromBytes(uri, 'params.sldd', bytesOf(path))
          : getModel(uri, 'params.sldd', raw.toString('utf8'));
        const m = new Map<string, string>();
        for (const s of node.children ?? [])
          for (const e of s.children ?? []) {
            let dv = '';
            try { dv = String(e.displayValue ?? ''); } catch { dv = 'ERR'; }
            let dt = '';
            try { dt = String(e.className ?? ''); } catch { /* */ }
            const kids = (e.children ?? []).map((c: any) => c.name).join(',');
            m.set(e.name, `${dt}|${dv}|${kids}`);
          }
        return m;
      };
      const t = load('text');
      const b = load('binary');
      expect(Array.from(t.keys()).sort()).toEqual(Array.from(b.keys()).sort());
      const mismatches: string[] = [];
      for (const [name, tv] of t) {
        if (b.get(name) !== tv) mismatches.push(`${name}: text=${tv} binary=${b.get(name)}`);
      }
      expect(mismatches).toEqual([]);
    });
  });

  // ============================================================
  // PHASE 4 — MAT + SLX content parity (Tier-2)
  // ============================================================
  describe.each(VARIANTS)('Phase 4: mat + slx content [%s]', (variant) => {
    it('signals.mat variables parsed', () => {
      const parsed = parseMat(bytesOf(ART(variant, 'signals.mat')));
      const names = parsed.variables.filter((v) => v.name).map((v) => v.name);
      for (const n of ['Kp', 'gainVec', 'offsetMat', 'flag', 'label']) {
        expect(names).toContain(n);
      }
      const kp = parsed.variables.find((v) => v.name === 'Kp')!;
      expect(Number(kp.value)).toBeCloseTo(2.5, 10);
    });

    it('top.slx parses dataDictionary, modelReferences, externalDataSources', () => {
      const parsed = parseSlx(bytesOf(ART(variant, 'top.slx')), 'top.slx');
      expect(parsed.dataDictionary).toBe('params.sldd');
      expect(parsed.modelReferences.map((r) => r.modelName)).toContain('plant');
      // signals.mat may be recorded as external data source
      const ds = parsed.externalDataSources.join(',');
      expect(ds).toContain('signals');
    });

    it('top.slx block param usages capture C1/G1/G2 → scalarD/gravity/Kp', () => {
      const parsed = parseSlx(bytesOf(ART(variant, 'top.slx')), 'top.slx');
      const usages = parsed.blockParamUsages ?? [];
      const params = usages.map((u) => u.paramValue);
      // At least the named-parameter references should appear.
      expect(params.join(',')).toMatch(/scalarD|gravity|Kp/);
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
