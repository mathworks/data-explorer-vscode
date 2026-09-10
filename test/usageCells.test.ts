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
  annotateModelViewRows,
  annotateVariableRows,
  buildUsageGraph,
  type BlockLink,
  type ParamLink,
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

// A MASK is the origin that is not a file, so it is the one the two fields of a ParamLink
// mean something else for — see `toParamLink`. Core's rule (v1.14.0) is that a masked
// subsystem's parameters are a scope its inner blocks resolve in, and that each mask
// parameter's VALUE is an expression evaluated outside the mask, which makes it a
// parameter of the masked block itself. Both halves reach a cell, and they reach
// different ones: the inner block's row shows `Gain=g1 (MulAdd)` and the masked block's
// own row shows `g1=g1_param`.
//
// Which is exactly MATLAB's answer for the model this came from. `Simulink.findVars` on
// it reports `g1` in the mask workspace `mWhereUsedRefVars/MulAdd` used by
// `mWhereUsedRefVars/MulAdd/Gain`, and `g1_param` in the model workspace used by
// `mWhereUsedRefVars/MulAdd` — the inner Gain is NOT a user of `g1_param`. The two-hop
// chain is the fact; the tests below are that both hops land in a cell.
describe('paramLinks — a mask parameter, the origin that is not a file', () => {
  // A masked subsystem: `MulAdd` (SID 158) declares `g1 = g1_param` and holds an inner
  // `Gain` (SID 154) whose gain is `g1`. Written as raw part XML, the same shape core's
  // own fixtures use, because a mask lives in `<Mask>` next to the `<P>` list rather
  // than in it.
  const MASKED =
    `<Block BlockType="SubSystem" Name="MulAdd" SID="158">` +
    `<Mask><MaskParameter Name="g1" Type="edit"><Value>g1_param</Value></MaskParameter></Mask>` +
    `<System><Block BlockType="Gain" Name="Gain" SID="154"><P Name="Gain">g1</P></Block></System>` +
    `</Block>`;
  // `g1_param` has to be a real model-workspace variable for the outer hop to resolve,
  // and `Vec` is what the committed workspace MAT holds — so the mask parameter is
  // valued `2*Vec` in the outer-hop test below and `g1_param` only where the row's own
  // resolution is beside the point.
  const withWorkspace = (blocks: string): RawSource =>
    source(PLANT, '/w/plant.slx', slxBytes({ blocks, workspaceMat: matBytes() }));

  it('names the masked BLOCK as the source and routes the click to the blocks channel', () => {
    // The inner hop. `(MulAdd)` rather than `(plant.slx)`: the file would be the open
    // model, the qualifier a model view drops as noise, while the block is the thing a
    // reader cannot see from the row. And `blocks:` because core answered with the
    // block's KEY — its SID — so the `workspace:` channel would send the click looking
    // for a variable named `158`.
    const g = graphOf([withWorkspace(MASKED)]);
    expect(g.paramLinks(PLANT, '154')).toEqual([
      { property: 'Gain', paramName: 'g1', source: 'MulAdd', linkTarget: `blocks:158@${PLANT}` },
    ]);
  });

  it('shows the mask parameter itself on the masked block’s row, resolved outward', () => {
    // The outer hop, and the one that gives `Vec` a user at all. It is an ordinary
    // model-workspace param — the mask does not resolve its own values — so it takes the
    // plain arm: no source, `workspace:` channel.
    const g = graphOf([
      withWorkspace(
        `<Block BlockType="SubSystem" Name="MulAdd" SID="158">` +
          `<Mask><MaskParameter Name="g1" Type="edit"><Value>2*Vec</Value></MaskParameter></Mask>` +
          `<System><Block BlockType="Gain" Name="Gain" SID="154"><P Name="Gain">g1</P></Block></System>` +
          `</Block>`,
      ),
    ]);
    expect(g.paramLinks(PLANT, '158')).toEqual([
      { property: 'g1', paramName: '2*Vec', source: '', linkTarget: `workspace:Vec@${PLANT}` },
    ]);
    // And the credit lands on the MASKED block, not on the inner Gain that reads `g1`.
    expect(g.blocksUsing(PLANT, 'Vec').map((b) => b.blockPath)).toEqual(['MulAdd']);
  });

  it('labels a masked block the file left nameless the way its own row reads', () => {
    // `blockLabel` is core's, so the source here and the Name cell of the row the link
    // reaches are the same string. Spelling `<SID: 158>` a second time in this file is
    // how the two come to disagree about a block Simulink recorded without a name.
    const g = graphOf([
      withWorkspace(
        `<Block BlockType="SubSystem" Name="" SID="158">` +
          `<Mask><MaskParameter Name="g1" Type="edit"><Value>g1_param</Value></MaskParameter></Mask>` +
          `<System><Block BlockType="Gain" Name="Gain" SID="154"><P Name="Gain">g1</P></Block></System>` +
          `</Block>`,
      ),
    ]);
    expect(g.paramLinks(PLANT, '154')[0].source).toBe('<SID: 158>');
  });

  it('resolves the innermost mask when two of them declare the same name', () => {
    // Nested masks both declaring `g1`: the inner one wins, so the cell has to name IT.
    // A cell that named the outer mask would point a reader at a value the block never
    // reads.
    const g = graphOf([
      withWorkspace(
        `<Block BlockType="SubSystem" Name="Outer" SID="6">` +
          `<Mask><MaskParameter Name="g1" Type="edit"><Value>g1_param</Value></MaskParameter></Mask>` +
          `<System><Block BlockType="SubSystem" Name="Inner" SID="8">` +
          `<Mask><MaskParameter Name="g1" Type="edit"><Value>g1_param</Value></MaskParameter></Mask>` +
          `<System><Block BlockType="Gain" Name="Gain" SID="9"><P Name="Gain">g1</P></Block></System>` +
          `</Block></System>` +
          `</Block>`,
      ),
    ]);
    expect(g.paramLinks(PLANT, '9')).toEqual([
      { property: 'Gain', paramName: 'g1', source: 'Inner', linkTarget: `blocks:8@${PLANT}` },
    ]);
  });

  it('renders as `property=name(source)` in the text a user copies and sorts by', () => {
    // The cell's payload is only half the answer: the Usage column's TEXT — what the
    // filter bar, the sort and a copy see — is built from the same three fields, and a
    // mask source that only reached the template would copy as `Gain=g1`.
    const g = graphOf([withWorkspace(MASKED)]);
    const rows: any[] = [{ Name: { label: 'Gain' }, _isBlockRow: true, _blockKey: '154' }];
    annotateModelViewRows(PLANT, rows, g);
    const links: ParamLink[] = rows[0].UsedBy.paramLinks;
    expect(links.map((p) => `${p.property}=${p.paramName}(${p.source})`)).toEqual(['Gain=g1(MulAdd)']);
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

// A MODEL view's block rows are the other half of the same column, and they are joined to
// the graph by the block's KEY — its SID. The two properties below are about what happens
// when that join comes back empty, which is the direction a wrong answer is silent in: the
// row arrives already carrying a paramLinks-shaped Usage cell from core's own
// `ModelBlockNode.toRow` remap, so a block the workspace graph could not answer for keeps
// showing parameters that were never cross-file resolved unless the cell is actively
// cleared. That is the opposite rule to a variable row — which is LEFT ALONE when the graph
// is silent, because a variable's absence from the graph is a gap in what was read rather
// than an answer — and the two are only distinguishable if both are pinned.
describe('annotateModelViewRows — a block row the graph cannot answer for', () => {
  const MODEL = 'file:///w/plant.slx';
  const blockRow = (name: string, blockKey: string | undefined, UsedBy?: unknown): any => ({
    Name: { label: name },
    UsedBy,
    _isBlockRow: true,
    ...(blockKey === undefined ? {} : { _blockKey: blockKey }),
  });
  const param = (property: string, paramName: string): ParamLink => ({
    property,
    paramName,
    source: 'params.sldd',
    linkTarget: `${paramName}@file:///w/params.sldd`,
  });
  // A stub, because these two are about the JOIN and not about what core knows: the
  // shaping of a real param link is asserted over real bytes further up this file. It
  // records the keys it was asked with, which is the only way to state "asked by SID and
  // never by the Name label" as an assertion rather than as a hope.
  const graphAsked = (answers: Record<string, ParamLink[]>, asked: string[]): UsageGraph => ({
    blocksUsing: () => [],
    paramLinks: (modelUri, blockKey) => {
      asked.push(blockKey);
      return answers[`${modelUri}\n${blockKey}`] ?? [];
    },
  });

  it('EMPTIES the cell rather than leaving the parameters the row arrived with', () => {
    // `Gain1` resolves and keeps its links; `Probe` is a block of this same model that
    // resolved nothing, so the graph has SEEN it and "no parameters" is an answer about it.
    // Leaving its inherited cell would show `Gain=Kp (params.sldd)` for a block whose
    // parameter never resolved to that file — a claim about where a value comes from that
    // nothing in the workspace supports.
    const stale = { paramLinks: [param('Gain', 'Kp')] };
    const rows = [blockRow('Gain1', '15'), blockRow('Probe', '20', stale)];
    const asked: string[] = [];
    expect(
      annotateModelViewRows(MODEL, rows, graphAsked({ [`${MODEL}\n15`]: [param('Gain', 'Kp')] }, asked)),
    ).toBe(true);
    expect(rows[0].UsedBy).toEqual({ paramLinks: [param('Gain', 'Kp')] });
    // Emptied to the string the renderer treats as a blank cell — not left as `stale`, and
    // not `{ paramLinks: [] }`, which the Usage template renders as an empty link list.
    expect(rows[1].UsedBy).toBe('');
    expect(asked).toEqual(['15', '20']);
  });

  it('asks with an empty key for a block row that carries none, never with its Name', () => {
    // A block row without a `_blockKey` is what a model written before SIDs existed, or a
    // future row shape that stops publishing it, looks like. The tempting fallback is the
    // Name label, and that is the documented bug: a label is unique only inside one system,
    // so two `Gain` blocks in different subsystems would take each other's parameters. An
    // empty key answers nothing, which empties the cell — visibly missing beats confidently
    // wrong.
    const rows = [blockRow('Gain', undefined)];
    const asked: string[] = [];
    const answers = { [`${MODEL}\nGain`]: [param('Gain', 'Kp')], [`${MODEL}\n15`]: [param('Gain', 'Kp')] };
    expect(annotateModelViewRows(MODEL, rows, graphAsked(answers, asked))).toBe(true);
    expect(asked, 'the key asked for is the empty one, not the label').toEqual(['']);
    expect(rows[0].UsedBy).toBe('');
  });
});
