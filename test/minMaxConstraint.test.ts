// Copyright 2026 The MathWorks, Inc.
//
// Min / Max accept exactly what Simulink.DataObject/setPropValue accepts: a
// "finite real double scalar value". These cases are pinned against real MATLAB
// (BR2025ad) behavior captured by test/parity/gen_propconstraints_probe.m —
// notably that Inf/-Inf/NaN, arrays ([5 6]), complex (5+2i) and non-numeric text
// are REJECTED, empty/'[]' CLEARS the bound, and Min>Max is ALLOWED (MATLAB does
// not enforce the ordering, so we don't either).
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/dex/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/dex/datamodel/node/data/SignalNode.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

type Maker = () => any;
const makers: Array<[string, Maker]> = [
  ['Parameter', () => ParameterNode.createDefault('p', null)],
  ['Signal', () => SignalNode.createDefault('s', null)],
];

describe('Min/Max mirror the MATLAB "finite real double scalar" constraint', () => {
  for (const [label, make] of makers) {
    describe(label, () => {
      it('accepts a finite real scalar (integer, negative, decimal, exponent, padded)', () => {
        for (const [inp, want] of [['5', 5], ['-3.5', -3.5], ['0', 0], ['1e3', 1000], ['  7  ', 7]] as const) {
          const n = make();
          expect(n.setProperty('Min', inp)).toBe(true);
          expect(n.Min).toBe(want);
        }
      });

      it("clears the bound on '' or '[]' (MATLAB stores [])", () => {
        const n = make();
        n.setProperty('Min', '5');
        expect(n.setProperty('Min', '')).toBe(true);
        expect(n.Min).toBeUndefined();
        n.setProperty('Max', '5');
        expect(n.setProperty('Max', '[]')).toBe(true);
        expect(n.Max).toBeUndefined();
      });

      it('rejects non-finite (Inf, -Inf, NaN) with the MATLAB message', () => {
        for (const bad of ['Inf', '-Inf', 'NaN']) {
          const n = make();
          const r = n.setProperty('Min', bad);
          expect((r as any).error).toBe(true);
          expect((r as any).reason).toBe('Minimum must be a finite real double scalar value');
          expect(n.Min).toBeUndefined();
        }
      });

      it('rejects arrays, complex, and non-numeric text', () => {
        for (const bad of ['[5 6]', '[5;6]', '5+2i', 'abc']) {
          const n = make();
          expect((n.setProperty('Max', bad) as any).error).toBe(true);
          expect((n.setProperty('Max', bad) as any).reason).toBe('Maximum must be a finite real double scalar value');
          expect(n.Max).toBeUndefined();
        }
      });

      it('allows Min > Max (MATLAB does not enforce the ordering)', () => {
        const n = make();
        expect(n.setProperty('Min', '5')).toBe(true);
        expect(n.setProperty('Max', '1')).toBe(true);
        expect(n.Min).toBe(5);
        expect(n.Max).toBe(1);
      });

      it('a rejected edit preserves the previous value in validValue', () => {
        const n = make();
        n.setProperty('Min', '2');
        const r = n.setProperty('Min', 'Inf');
        expect((r as any).validValue).toBe('2');
        expect(n.Min).toBe(2);
      });
    });
  }
});
