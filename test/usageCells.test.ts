// Copyright 2026 The MathWorks, Inc.
//
// The host's half of the Usage column: core answers WHO USES WHAT, this shapes the
// answer into a cell.
//
// The graph itself is no longer tested here, because it is no longer here — the
// summarising, the workspace → sldd → mat shadowing, the transitive dictionary chase
// and the edge build are core's `buildUsageIndex` as of v1.6.0, tested there against
// real MATLAB-written files (data-explorer-core test/usageIndex.test.ts). What is left
// for this file is the seam, and the seam has its own ways to be wrong: a link target
// missing its channel prefix navigates nowhere, a `(source)` suffix on a
// model-workspace param is noise a model view should not show, and a block named
// without its model is not identifiable when two models hold that name.
//
// The files below are built with `fflate` rather than mocked, so the graph these
// assertions read is the real one core produces from real bytes; only the questions
// are about this layer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import {
  annotateVariableRows,
  buildUsageGraph,
  type BlockLink,
  type RawSource,
  type UsageGraph,
} from '../src/host/usageCells.js';

const block = (name: string, type: string, prop: string, value: string): string =>
  `<Block BlockType="${type}" Name="${name}" SID="${name}"><P Name="${prop}">${value}</P></Block>`;

// A `.slx` holding just what a usage answer needs. Same shape as core's own test
// fixtures, because it goes through the same parser.
function slxBytes(opts: { dictionary?: string; blocks: string; workspaceMat?: Uint8Array }): ArrayBuffer {
  const diagram: Record<string, unknown> = { ModelUUID: 'u1' };
  if (opts.dictionary) diagram.DataDictionary = opts.dictionary;
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: diagram })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${opts.blocks}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8('<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>'),
  };
  // The pre-R2019b workspace part: a whole MAT-file, so a real one goes in rather than
  // a stand-in — a model workspace is the one origin kind the host renders differently.
  if (opts.workspaceMat) parts['simulink/modelworkspace.mat'] = opts.workspaceMat;
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

// nd_numeric.mat, whose variables are Mat/Nd/Nd4/Vec.
function matBytes(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('./fixtures/nd_numeric.mat', import.meta.url)));
}

function slddBytes(names: string[]): ArrayBuffer {
  const u8 = strToU8(
    JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: { entries: names.map((name) => ({ name, class: 'Simulink.Parameter' })) },
        },
      },
    }),
  );
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// A vscode uri and a path, which is the pair this layer exists to carry: core is handed
// bytes plus a FILENAME and answers with the srcId it was given, so the uri never has to
// be parsed to decide what a file is.
const source = (uriString: string, path: string, bytes: ArrayBuffer): RawSource => ({ uriString, path, bytes });

const DICT = 'file:///w/params.sldd';
const PLANT = 'file:///w/plant.slx';

function graphOf(files: RawSource[]): UsageGraph {
  return buildUsageGraph(files);
}

describe('blocksUsing — the cell a dictionary entry shows', () => {
  const files = [
    source(PLANT, '/w/plant.slx', slxBytes({ dictionary: 'params.sldd', blocks: block('Gain1', 'Gain', 'Gain', '2*Kp') })),
    source(DICT, '/w/params.sldd', slddBytes(['Kp', 'Unused'])),
  ];

  it('names the block, where it is, the model, and a target that navigates back to it', () => {
    expect(graphOf(files).blocksUsing(DICT, 'Kp')).toEqual([
      {
        blockName: 'Gain1',
        // In the root system, so its path is the label alone.
        blockPath: 'Gain1',
        modelName: 'plant',
        modelUri: PLANT,
        linkTarget: `blocks:Gain1@${PLANT}`,
      },
    ]);
  });

  it('tells two links reading the same name apart by the subsystem each is in', () => {
    // The cell the model view cannot fix by itself: one dictionary entry read by two
    // blocks named `Gain` renders `Gain, Gain` — two correct links a user cannot choose
    // between. The path is what the renderer hangs on each anchor, and it comes from
    // core rather than being re-derived here.
    const nested = source(
      PLANT,
      '/w/plant.slx',
      slxBytes({
        dictionary: 'params.sldd',
        blocks:
          `<Block BlockType="Gain" Name="Gain" SID="15"><P Name="Gain">Kp</P></Block>` +
          `<Block BlockType="SubSystem" Name="Controller" SID="20"><System>` +
          `<Block BlockType="Gain" Name="Gain" SID="24"><P Name="Gain">Kp</P></Block>` +
          `</System></Block>`,
      }),
    );
    expect(
      graphOf([nested, source(DICT, '/w/params.sldd', slddBytes(['Kp']))])
        .blocksUsing(DICT, 'Kp')
        .map((b) => `${b.blockName} @ ${b.blockPath}`),
    ).toEqual(['Gain @ Gain', 'Gain @ Controller/Gain']);
  });

  it('prefixes the CHANNEL, which is this extension’s grammar and not core’s', () => {
    // Core emits `name@srcId`; `blocks:` is what navTarget.ts routes on (a data row →
    // a block, rather than a block row → a variable). Without it the click is parsed
    // as the other direction and looks for a variable named after the block.
    const [link] = graphOf(files).blocksUsing(DICT, 'Kp');
    expect(link.linkTarget.startsWith('blocks:')).toBe(true);
    expect(link.linkTarget.slice('blocks:'.length)).toBe(`Gain1@${PLANT}`);
  });

  it('carries the full uri, not a basename, so two same-named models stay apart', () => {
    const other = 'file:///other/plant.slx';
    const both = [
      ...files,
      source(other, '/other/plant.slx', slxBytes({ dictionary: 'params.sldd', blocks: block('Gain9', 'Gain', 'Gain', 'Kp') })),
    ];
    expect(graphOf(both).blocksUsing(DICT, 'Kp').map((b) => [b.modelName, b.modelUri])).toEqual([
      ['plant', PLANT],
      ['plant', other],
    ]);
  });

  it('answers with an empty list, never undefined, for an entry nothing uses', () => {
    // The caller renders `.length`, so a missing key would be a crash rather than an
    // empty cell.
    expect(graphOf(files).blocksUsing(DICT, 'Unused')).toEqual([]);
    expect(graphOf(files).blocksUsing('file:///w/never-read.sldd', 'Kp')).toEqual([]);
  });
});

describe('paramLinks — the cell a block row shows', () => {
  it('labels an external source with its basename and links the resolved name', () => {
    const g = graphOf([
      source(PLANT, '/w/plant.slx', slxBytes({ dictionary: 'params.sldd', blocks: block('Gain1', 'Gain', 'Gain', '2*Kp') })),
      source(DICT, '/w/params.sldd', slddBytes(['Kp'])),
    ]);
    // The value is what the file says; the TARGET is the name that resolved. Linking
    // `2*Kp` would offer a link to a name no dictionary holds.
    expect(g.paramLinks(PLANT, 'Gain1')).toEqual([
      { property: 'Gain', paramName: '2*Kp', source: 'params.sldd', linkTarget: `Kp@${DICT}` },
    ]);
  });

  it('names the file as it is spelled on DISK, not as the model recorded it', () => {
    // The model links `Params.SLDD` and the file is `params.sldd`; core matches those,
    // and the cell has to show the one a user can find in the explorer.
    const g = graphOf([
      source(PLANT, '/w/plant.slx', slxBytes({ dictionary: 'Params.SLDD', blocks: block('Gain1', 'Gain', 'Gain', 'Kp') })),
      source(DICT, '/w/params.sldd', slddBytes(['Kp'])),
    ]);
    expect(g.paramLinks(PLANT, 'Gain1')[0].source).toBe('params.sldd');
  });

  it('gives a model-workspace param NO source suffix but keeps its workspace: target', () => {
    // `Gain=2*Vec` where `Vec` is the model's OWN workspace variable. In a model view
    // that needs no `(...)` qualifier — the model is the thing being looked at, so
    // naming it in every cell is noise. The link still has to work, which is what
    // distinguishes this arm from the unresolved one below, and it needs the
    // `workspace:` channel because the target file is the model itself: without the
    // prefix the click looks for a BLOCK named `Vec`.
    const g = graphOf([
      source(
        PLANT,
        '/w/plant.slx',
        slxBytes({ blocks: block('Gain1', 'Gain', 'Gain', '2*Vec'), workspaceMat: matBytes() }),
      ),
    ]);
    expect(g.paramLinks(PLANT, 'Gain1')).toEqual([
      { property: 'Gain', paramName: '2*Vec', source: '', linkTarget: `workspace:Vec@${PLANT}` },
    ]);
  });

  it('keeps an unresolved param visible, with no source AND no target', () => {
    // A model linked to a dictionary nobody read. The row stays — the parameter is
    // really there — and the empty target is what tells the renderer not to offer a
    // link. Dropping it instead would read as "this block has no parameters".
    const g = graphOf([
      source(PLANT, '/w/plant.slx', slxBytes({ dictionary: 'absent.sldd', blocks: block('Gain1', 'Gain', 'Gain', 'Kp') })),
    ]);
    expect(g.paramLinks(PLANT, 'Gain1')).toEqual([
      { property: 'Gain', paramName: 'Kp', source: '', linkTarget: '' },
    ]);
  });

  it('answers with an empty list for a block or a model it has nothing about', () => {
    const g = graphOf([
      source(PLANT, '/w/plant.slx', slxBytes({ blocks: block('Gain1', 'Gain', 'Gain', 'Kp') })),
    ]);
    expect(g.paramLinks(PLANT, 'NoSuchBlock')).toEqual([]);
    expect(g.paramLinks('file:///w/other.slx', 'Gain1')).toEqual([]);
  });
});

// One engine settles a variable's Usage cell. The rows arrive carrying whatever the
// node layer put there, and the node layer answers from core's SESSION — the models
// whose editor happens to be open — so honouring that cell made the column say
// different things about the same dictionary depending on the user's tab history.
describe('annotateVariableRows names the model in every usage', () => {
  const row = (name: string, UsedBy?: unknown): any => ({ Name: { label: name }, UsedBy });

  // A graph stub, because these tests are about the OVERWRITE decision and not about
  // what the graph knows. The shaping above is tested on real bytes; here the answer
  // has to be arbitrary — including "five usages across two models", which no
  // two-file fixture would produce.
  const graphSaying = (answers: Record<string, BlockLink[]>): UsageGraph => ({
    blocksUsing: (sourceUri, varName) => answers[`${sourceUri}\n${varName}`] ?? [],
    paramLinks: () => [],
  });
  // `blockPath` defaults to the name, which is what a root-system block's path is; the
  // tests below that care about the path pass one.
  const link = (blockName: string, modelName: string, modelUri: string, blockPath?: string): BlockLink => ({
    blockName,
    blockPath: blockPath ?? blockName,
    modelName,
    modelUri,
    linkTarget: `blocks:${blockName}@${modelUri}`,
  });

  const SRC = 'file:///w/d.sldd';

  it('replaces the cell with the graph’s block links', () => {
    const rows = [row('Kp')];
    const graph = graphSaying({
      [`${SRC}\nKp`]: [link('Gain1', 'plant', 'file:///w/plant.slx', 'Controller/Gain1')],
    });
    expect(annotateVariableRows(SRC, rows, graph)).toBe(true);
    expect(rows[0].UsedBy).toEqual({
      blockLinks: [
        {
          blockName: 'Gain1',
          // Passed through whole: the renderer hangs it on the anchor as a tooltip, and
          // it is the only field that separates two links printing the same name.
          blockPath: 'Controller/Gain1',
          modelName: 'plant',
          // The uri as well as the name: the webview groups blocks by model, and two
          // models can share a stripped-basename name.
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
      graphSaying({
        [`${SRC}\nDragCoeff`]: [
          link('DragCalc', 'MainVehicle', 'file:///w/MainVehicle.slx'),
          link('DragCalc', 'SubChassis', 'file:///w/SubChassis.slx'),
        ],
      }),
    );
    expect(rows[0].UsedBy.blockLinks.map((b: any) => `${b.blockName}(${b.modelName})`)).toEqual([
      'DragCalc(MainVehicle)',
      'DragCalc(SubChassis)',
    ]);
  });

  it('drops the model qualifier from a usage inside the file being viewed', () => {
    // A MODEL view's model-workspace row asks with the MODEL's uri, and a model workspace
    // is private to its model — so every block the graph can answer with is in the file
    // already open, and `(plant)` was the open file's own name printed once per link. The
    // block view has never qualified the same edge read the other way (`Gain=Kp`, not
    // `Gain=Kp (plant)`), so this is the two directions agreeing.
    const MODEL = 'file:///w/plant.slx';
    const rows = [row('Ts')];
    annotateVariableRows(
      MODEL,
      rows,
      graphSaying({
        [`${MODEL}\nTs`]: [link('Gain1', 'plant', MODEL), link('Probe', 'harness', 'file:///w/harness.slx')],
      }),
    );
    // The second link cannot arise from a real model workspace; it is here because the rule
    // is "not the file being viewed" rather than "blank them all", which is exactly what
    // leaves the dictionary view above untouched — a .sldd's uri is never a model's.
    const links = rows[0].UsedBy.blockLinks;
    expect(links.map((b: any) => `${b.blockName}${b.modelName ? `(${b.modelName})` : ''}`)).toEqual([
      'Gain1',
      'Probe(harness)',
    ]);
    // Only the printed qualifier goes. The uri is what the webview groups on and what the
    // target resolves through, so blanking the name must leave both standing.
    expect(links[0].modelUri).toBe(MODEL);
    expect(links[0].linkTarget).toBe(`blocks:Gain1@${MODEL}`);
    expect(links[0].blockPath).toBe('Gain1');
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
        graphSaying({
          [`${SRC}\nAFRTarget`]: [
            link('AFR', 'EngineCtrl', E),
            link('AFRMonitor', 'EngineCtrl', E),
            link('MixTarget', 'EngineCtrl', E),
            link('AFRConst', 'FuelInjector', F),
            link('AFRCheck', 'FuelInjector', F),
          ],
        }),
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
    // emphatic "unused" that neither engine is entitled to say. An untouched row also
    // means `changed` stays false, so nothing repaints.
    const kept = { links: [{ text: 'Ghost', linkTarget: 'Ghost@file:///elsewhere/m.slx' }] };
    const rows = [row('Orphan', kept), row('NeverUsed')];
    expect(annotateVariableRows(SRC, rows, graphSaying({}))).toBe(false);
    expect(rows[0].UsedBy).toBe(kept);
    expect(rows[1].UsedBy).toBeUndefined();
  });

  it('ignores rows with no name (section rows and the like)', () => {
    const rows: any[] = [{ Name: { label: '' } }, {}];
    const graph = graphSaying({ [`${SRC}\n`]: [link('B', 'plant', 'file:///w/plant.slx')] });
    expect(annotateVariableRows(SRC, rows, graph)).toBe(false);
    expect(rows[0].UsedBy).toBeUndefined();
  });
});
