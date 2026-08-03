// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import {
  identifiers,
  resolveParam,
  buildEdges,
  type ModelSummary,
  type DataSummary,
} from '../src/host/usageResolve.js';

function model(over: Partial<ModelSummary> = {}): ModelSummary {
  return {
    uri: 'file:///w/plant.slx',
    label: 'plant',
    wsNames: new Set(),
    slddRefs: [],
    matRefs: [],
    blockParams: [],
    ...over,
  };
}
function data(uri: string, vars: string[], dictRefs: string[] = []): DataSummary {
  return { uri, varNames: new Set(vars), dictRefs };
}

describe('identifiers', () => {
  it('extracts variable names from an expression, dropping numbers/operators', () => {
    expect(identifiers('2*Kp + 1')).toEqual(['Kp']);
    expect(identifiers('Kp')).toEqual(['Kp']);
    expect(identifiers('-gain')).toEqual(['gain']);
    expect(identifiers('42')).toEqual([]);
    expect(identifiers('a*b+c')).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveParam — workspace -> sldd -> mat, first found wins', () => {
  const sldds = new Map([['d.sldd', data('file:///w/d.sldd', ['Kp', 'Shared'])]]);
  const mats = new Map([['m.mat', data('file:///w/m.mat', ['Mv', 'Shared'])]]);

  it('resolves a workspace var to the model itself', () => {
    const m = model({ wsNames: new Set(['Ts']), slddRefs: ['d.sldd'], matRefs: ['m.mat'] });
    expect(resolveParam(m, 'Ts', sldds, mats)).toEqual({ kind: 'workspace', uri: m.uri });
  });

  it('resolves an sldd var when not in the workspace', () => {
    const m = model({ slddRefs: ['d.sldd'], matRefs: ['m.mat'] });
    expect(resolveParam(m, 'Kp', sldds, mats)).toEqual({ kind: 'sldd', uri: 'file:///w/d.sldd' });
  });

  it('resolves a mat var when in neither workspace nor sldd', () => {
    const m = model({ slddRefs: ['d.sldd'], matRefs: ['m.mat'] });
    expect(resolveParam(m, 'Mv', sldds, mats)).toEqual({ kind: 'mat', uri: 'file:///w/m.mat' });
  });

  it('workspace SHADOWS a same-named sldd/mat var', () => {
    const m = model({ wsNames: new Set(['Shared']), slddRefs: ['d.sldd'], matRefs: ['m.mat'] });
    expect(resolveParam(m, 'Shared', sldds, mats)).toEqual({ kind: 'workspace', uri: m.uri });
  });

  it('sldd SHADOWS a same-named mat var (sldd checked first)', () => {
    const m = model({ slddRefs: ['d.sldd'], matRefs: ['m.mat'] });
    expect(resolveParam(m, 'Shared', sldds, mats)).toEqual({ kind: 'sldd', uri: 'file:///w/d.sldd' });
  });

  it('returns null when the param resolves nowhere', () => {
    const m = model({ slddRefs: ['d.sldd'], matRefs: ['m.mat'] });
    expect(resolveParam(m, 'Missing', sldds, mats)).toBeNull();
  });

  it('chases transitive dictionary references', () => {
    const chained = new Map([
      ['a.sldd', data('file:///w/a.sldd', [], ['b.sldd'])],
      ['b.sldd', data('file:///w/b.sldd', ['Deep'])],
    ]);
    const m = model({ slddRefs: ['a.sldd'] });
    expect(resolveParam(m, 'Deep', chained, new Map())).toEqual({ kind: 'sldd', uri: 'file:///w/b.sldd' });
  });

  it('does not loop on cyclic dictionary references', () => {
    const cyclic = new Map([
      ['a.sldd', data('file:///w/a.sldd', [], ['b.sldd'])],
      ['b.sldd', data('file:///w/b.sldd', [], ['a.sldd'])],
    ]);
    const m = model({ slddRefs: ['a.sldd'] });
    expect(resolveParam(m, 'Nope', cyclic, new Map())).toBeNull();
  });
});

describe('buildEdges', () => {
  const sldds = new Map([['d.sldd', data('file:///w/d.sldd', ['Kp'])]]);
  const mats = new Map<string, DataSummary>();

  it('builds a reverse edge from the winning source variable to the block', () => {
    const m = model({
      slddRefs: ['d.sldd'],
      blockParams: [{ blockName: 'Gain1', property: 'Gain', value: '2*Kp' }],
    });
    const g = buildEdges([m], sldds, mats);
    expect(g.reverse.get('file:///w/d.sldd\nKp')).toEqual([
      { blockName: 'Gain1', modelName: 'plant', modelUri: m.uri },
    ]);
  });

  it('builds a forward param link with source label + exact-uri target', () => {
    const m = model({
      slddRefs: ['d.sldd'],
      blockParams: [{ blockName: 'Gain1', property: 'Gain', value: 'Kp' }],
    });
    const g = buildEdges([m], sldds, mats);
    expect(g.forward.get(`${m.uri}\nGain1`)).toEqual([
      { property: 'Gain', paramName: 'Kp', source: 'd.sldd', linkTarget: 'Kp@file:///w/d.sldd' },
    ]);
  });

  it('labels a workspace param "Model Workspace" with a workspace: target', () => {
    const m = model({
      wsNames: new Set(['Ts']),
      blockParams: [{ blockName: 'B', property: 'SampleTime', value: 'Ts' }],
    });
    const g = buildEdges([m], sldds, mats);
    expect(g.forward.get(`${m.uri}\nB`)).toEqual([
      { property: 'SampleTime', paramName: 'Ts', source: 'Model Workspace', linkTarget: `workspace:Ts@${m.uri}` },
    ]);
    // Workspace vars key their reverse edge on the model uri (issue: model
    // workspace data shows the blocks that use it).
    expect(g.reverse.get(`${m.uri}\nTs`)).toEqual([{ blockName: 'B', modelName: 'plant', modelUri: m.uri }]);
  });

  it('keeps an unresolved param visible with an empty source/target', () => {
    const m = model({ blockParams: [{ blockName: 'B', property: 'Gain', value: 'ghost' }] });
    const g = buildEdges([m], sldds, mats);
    expect(g.forward.get(`${m.uri}\nB`)).toEqual([
      { property: 'Gain', paramName: 'ghost', source: '', linkTarget: '' },
    ]);
  });

  it('dedupes repeated block/param edges', () => {
    const m = model({
      slddRefs: ['d.sldd'],
      blockParams: [
        { blockName: 'Gain1', property: 'Gain', value: 'Kp' },
        { blockName: 'Gain1', property: 'Gain', value: 'Kp' },
      ],
    });
    const g = buildEdges([m], sldds, mats);
    expect(g.reverse.get('file:///w/d.sldd\nKp')).toHaveLength(1);
  });
});
