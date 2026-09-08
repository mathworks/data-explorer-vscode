// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { identifiersIn as coreIdentifiersIn } from 'data-explorer-core';
import {
  identifiersIn,
  resolveParam,
  buildEdges,
  annotateVariableRows,
  type BlockRef,
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

// The scope of this module is its own — core resolves usages within a session, this
// resolves them across a workspace of files on disk — but the reading of an expression
// is not, and this is where the host stops having a second opinion about it.
describe('identifiersIn is core’s rule, not a second copy of it', () => {
  it('extracts variable names from an expression, dropping numbers/operators', () => {
    expect(identifiersIn('2*Kp + 1')).toEqual(['Kp']);
    expect(identifiersIn('Kp')).toEqual(['Kp']);
    expect(identifiersIn('-gain')).toEqual(['gain']);
    expect(identifiersIn('42')).toEqual([]);
    expect(identifiersIn('a*b+c')).toEqual(['a', 'b', 'c']);
  });

  it('credits a dotted reference to the base name only', () => {
    // What the host's own copy got wrong: it credited `mode` as well, so any dictionary
    // entry named `mode` collected a usage from every model with a `cfg.mode` parameter
    // — a link the user follows to a block that does not refer to that entry at all.
    expect(identifiersIn('cfg.mode')).toEqual(['cfg']);
  });

  it('does not read the tail of a numeric literal as a name', () => {
    // The other drift: `1e5` offered `e5`, so a model full of scientific-notation
    // parameters advertised usages of an entry nobody has.
    expect(identifiersIn('1e5')).toEqual([]);
    expect(identifiersIn('2.5e-3')).toEqual([]);
  });

  it('IS core’s function, not a same-named one that agrees today', () => {
    // Identity, not equivalence: two implementations that agree on the cases a test
    // happens to list is exactly the state this replaced. The re-export is checked in
    // the source too, because an inlined copy would pass every assertion above on the
    // day it was written.
    expect(identifiersIn).toBe(coreIdentifiersIn);
    const src = readFileSync(new URL('../src/host/usageResolve.ts', import.meta.url), 'utf8');
    expect(src).toContain("export { identifiersIn } from 'data-explorer-core';");
    expect(src).not.toMatch(/\[A-Za-z_\]\\w\*/);
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

  it('keeps searching past a dictionary that is not in the workspace', () => {
    // A model can name a dictionary that was never scanned — it lives outside the
    // workspace, or the link is stale/broken. That must not stop the search: the
    // params from the dictionaries that DO resolve still have to be found, or the
    // Usage view would show them as unresolved purely because of an unrelated
    // broken link listed ahead of them.
    const m = model({ slddRefs: ['gone.sldd', 'd.sldd'] });
    expect(resolveParam(m, 'Kp', sldds, mats)).toEqual({ kind: 'sldd', uri: 'file:///w/d.sldd' });
  });

  it('survives a chain into a dictionary that is not in the workspace', () => {
    // Same hazard one level down: a resolved dictionary referencing an unscanned
    // one must not throw or abort the BFS.
    const chained = new Map([['a.sldd', data('file:///w/a.sldd', [], ['offWorkspace.sldd'])]]);
    expect(resolveParam(model({ slddRefs: ['a.sldd'] }), 'Kp', chained, new Map())).toBeNull();
  });

  // The keys of these maps are FILENAMES; the refs in slddRefs/matRefs/dictRefs
  // are strings a model recorded, which MATLAB stores as the user typed them. So
  // the two sides routinely differ in case for the same file. usageGraph now keys
  // and looks up through refBasename (lower-cased) for exactly this reason — the
  // sections tree already resolved refs case-insensitively (RelGraph.byBasename),
  // so a case-sensitive match here made the SAME reference resolve in the tree and
  // silently not in the Usage column, showing a used parameter as unused.
  //
  // These pin the resolver's half of that contract: it must not re-introduce any
  // case-sensitive comparison of its own, which would defeat the normalisation.
  describe('case-insensitive reference matching', () => {
    it('resolves a differently-cased .sldd reference', () => {
      const m = model({ slddRefs: ['params.sldd'] });
      const lower = new Map([['params.sldd', data('file:///w/Params.sldd', ['Kp'])]]);
      expect(resolveParam(m, 'Kp', lower, new Map())).toEqual({ kind: 'sldd', uri: 'file:///w/Params.sldd' });
    });

    it('resolves a differently-cased .mat reference', () => {
      const m = model({ matRefs: ['tuning.mat'] });
      const lower = new Map([['tuning.mat', data('file:///w/Tuning.MAT', ['Mv'])]]);
      expect(resolveParam(m, 'Mv', new Map(), lower)).toEqual({ kind: 'mat', uri: 'file:///w/Tuning.MAT' });
    });

    it('chases a differently-cased chained dictionary reference', () => {
      // The chained refs come from a DIFFERENT file than the model, so this leg
      // has its own normalisation and its own chance to be missed.
      const chained = new Map([
        ['a.sldd', data('file:///w/A.sldd', [], ['b.sldd'])],
        ['b.sldd', data('file:///w/B.SLDD', ['Deep'])],
      ]);
      expect(resolveParam(model({ slddRefs: ['a.sldd'] }), 'Deep', chained, new Map())).toEqual({
        kind: 'sldd',
        uri: 'file:///w/B.SLDD',
      });
    });

    it('builds usage edges through a differently-cased reference', () => {
      // The end-to-end consequence: without normalisation this block's Gain shows
      // no source and no link at all, which reads as "this parameter is unused".
      const m = model({
        slddRefs: ['params.sldd'],
        blockParams: [{ blockName: 'plant/Gain', property: 'Gain', value: 'Kp' }],
      });
      const sldds2 = new Map([['params.sldd', data('file:///w/Params.sldd', ['Kp'])]]);
      const g = buildEdges([m], sldds2, new Map());
      expect(g.forward.get(`${m.uri}\nplant/Gain`)).toEqual([
        { property: 'Gain', paramName: 'Kp', source: 'Params.sldd', linkTarget: 'Kp@file:///w/Params.sldd' },
      ]);
      expect(g.reverse.get('file:///w/Params.sldd\nKp')).toEqual([
        { blockName: 'plant/Gain', modelName: 'plant', modelUri: m.uri },
      ]);
    });
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

  it('gives a workspace param an EMPTY source (no suffix) but keeps the workspace: target', () => {
    // Own-model-workspace params render as just `SampleTime=Ts` — no `(...)`
    // qualifier. The source is empty for display, but the linkTarget is intact so
    // the value still hyperlinks to the Model Workspace row.
    const m = model({
      wsNames: new Set(['Ts']),
      blockParams: [{ blockName: 'B', property: 'SampleTime', value: 'Ts' }],
    });
    const g = buildEdges([m], sldds, mats);
    expect(g.forward.get(`${m.uri}\nB`)).toEqual([
      { property: 'SampleTime', paramName: 'Ts', source: '', linkTarget: `workspace:Ts@${m.uri}` },
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

  it('links a multi-variable expression to its FIRST resolved variable', () => {
    // `Kp*Ki` uses two dictionary variables. Both get a reverse edge (the Usage
    // view must list the block under each), but the forward link can only carry
    // one hyperlink target, and it has to be the first — clicking `Gain=Kp*Ki`
    // otherwise jumped to whichever variable happened to be resolved last.
    const two = new Map([['d.sldd', data('file:///w/d.sldd', ['Kp', 'Ki'])]]);
    const m = model({
      slddRefs: ['d.sldd'],
      blockParams: [{ blockName: 'Gain1', property: 'Gain', value: 'Kp*Ki' }],
    });
    const g = buildEdges([m], two, mats);
    expect(g.forward.get(`${m.uri}\nGain1`)).toEqual([
      { property: 'Gain', paramName: 'Kp*Ki', source: 'd.sldd', linkTarget: 'Kp@file:///w/d.sldd' },
    ]);
    // Both variables still know about the block.
    expect(g.reverse.get('file:///w/d.sldd\nKp')).toHaveLength(1);
    expect(g.reverse.get('file:///w/d.sldd\nKi')).toHaveLength(1);
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

// One engine settles a variable's Usage cell. The rows arrive carrying whatever the
// node layer put there, and the node layer answers from the session — the models whose
// editor happens to be open — so honouring that cell made the column say different
// things about the same dictionary depending on the user's tab history.
describe('annotateVariableRows names the model in every usage', () => {
  const SRC = 'file:///w/d.sldd';
  const refs = (...rs: [string, string, string][]): BlockRef[] =>
    rs.map(([blockName, modelName, modelUri]) => ({ blockName, modelName, modelUri }));
  const row = (name: string, UsedBy?: unknown): any => ({ Name: { label: name }, UsedBy });

  it('shapes each ref as block + model + an exact-uri link target', () => {
    const rows = [row('Kp')];
    expect(annotateVariableRows(SRC, rows, new Map([[`${SRC}\nKp`, refs(['Gain1', 'plant', 'file:///w/plant.slx'])]]))).toBe(
      true,
    );
    expect(rows[0].UsedBy).toEqual({
      blockLinks: [
        {
          blockName: 'Gain1',
          modelName: 'plant',
          // The uri as well as the label: the webview groups blocks by model, and two
          // models can share a stripped-basename label.
          modelUri: 'file:///w/plant.slx',
          linkTarget: 'blocks:Gain1@file:///w/plant.slx',
        },
      ],
    });
  });

  it('keeps same-named blocks in different models apart', () => {
    // The case a bare block name cannot express: SharedTypes' DragCoeff is used by a
    // `DragCalc` in MainVehicle AND a `DragCalc` in SubChassis. Without the model the
    // cell reads `DragCalc, DragCalc` and neither link is identifiable.
    const rows = [row('DragCoeff')];
    annotateVariableRows(
      SRC,
      rows,
      new Map([
        [
          `${SRC}\nDragCoeff`,
          refs(['DragCalc', 'MainVehicle', 'file:///w/MainVehicle.slx'], ['DragCalc', 'SubChassis', 'file:///w/SubChassis.slx']),
        ],
      ]),
    );
    expect(rows[0].UsedBy.blockLinks.map((b: any) => `${b.blockName}(${b.modelName})`)).toEqual([
      'DragCalc(MainVehicle)',
      'DragCalc(SubChassis)',
    ]);
  });

  it('OVERWRITES a session-supplied cell that names no model and knows fewer blocks', () => {
    // The regression. `node.toRow()` had already answered from the session, which held
    // FuelInjector.slx but not EngineCtrl.slx, so AFRTarget read `AFRConst, AFRCheck`:
    // no model, and three of its five users missing. The workspace graph knows all five
    // whether or not either model is open, so it wins outright.
    const rows = [
      row('AFRTarget', {
        links: [
          { text: 'AFRConst', linkTarget: 'AFRConst@file:///w/FuelInjector.slx' },
          { text: 'AFRCheck', linkTarget: 'AFRCheck@file:///w/FuelInjector.slx' },
        ],
      }),
    ];
    const E = 'file:///w/EngineCtrl.slx';
    const F = 'file:///w/FuelInjector.slx';
    expect(
      annotateVariableRows(
        SRC,
        rows,
        new Map([
          [
            `${SRC}\nAFRTarget`,
            refs(
              ['AFR', 'EngineCtrl', E],
              ['AFRMonitor', 'EngineCtrl', E],
              ['MixTarget', 'EngineCtrl', E],
              ['AFRConst', 'FuelInjector', F],
              ['AFRCheck', 'FuelInjector', F],
            ),
          ],
        ]),
      ),
    ).toBe(true);
    expect('links' in rows[0].UsedBy).toBe(false);
    expect(rows[0].UsedBy.blockLinks.map((b: any) => `${b.blockName}(${b.modelName})`)).toEqual([
      'AFR(EngineCtrl)',
      'AFRMonitor(EngineCtrl)',
      'MixTarget(EngineCtrl)',
      'AFRConst(FuelInjector)',
      'AFRCheck(FuelInjector)',
    ]);
  });

  it('leaves a row the graph has no answer for exactly as it was', () => {
    // Not emptied: the graph cannot see a model opened from outside the workspace and
    // since closed, and overwriting with nothing would turn "I do not know" into the
    // emphatic "unused" that core's _usedByCell refuses to say. An untouched row also
    // means `changed` stays false, so nothing repaints.
    const kept = { links: [{ text: 'Ghost', linkTarget: 'Ghost@file:///elsewhere/m.slx' }] };
    const rows = [row('Orphan', kept), row('NeverUsed')];
    expect(annotateVariableRows(SRC, rows, new Map())).toBe(false);
    expect(rows[0].UsedBy).toBe(kept);
    expect(rows[1].UsedBy).toBeUndefined();
  });

  it('ignores rows with no name (section rows and the like)', () => {
    const rows: any[] = [{ Name: { label: '' } }, {}];
    expect(annotateVariableRows(SRC, rows, new Map([[`${SRC}\n`, refs(['B', 'plant', 'file:///w/plant.slx'])]]))).toBe(false);
    expect(rows[0].UsedBy).toBeUndefined();
  });
});
