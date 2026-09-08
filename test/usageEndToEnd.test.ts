// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Usage column over REAL FILES, end to end: bytes on disk → core's usage index →
// host cell shaping → annotated row → rendered cell. Every other test of this column
// stops at one of those joints — core's own tests end at the index, usageCells.test.ts
// asks only about the shaping, the webview tests feed hand-built cell payloads — and a
// column assembled from four correct pieces can still render nothing. This one starts
// from the fixtures and ends at the text in the cell, calling the same
// `buildUsageGraph` the extension calls (usageGraph.ts adds only the vscode file I/O in
// front of it).
//
// It is also what pins the CONTRACT with core across a version bump: the fixtures below
// are this repo's, the expectations are the cells a user reads, and a core release that
// changes what `buildUsageIndex` answers — or what shape it answers in — fails here
// rather than in a Usage column someone eventually notices is wrong.
//
// It also reproduces the DEFECT in process, which is the part that could not be
// pinned before. Two engines can fill this cell:
//
//   core's `_usedByCell`   answers from the DataModel SESSION — the models whose
//                          editor tab happened to be resolved in this window — and
//                          names the block WITHOUT its model
//   the workspace graph    answers from the files, whether or not anything is open,
//                          and names `block(model)`
//
// Honouring a cell the session had already filled made the column say different
// things about the same dictionary depending on the user's tab history: with one of
// two models registered, `Kp` read `Gain1` — no model, and two of its three users
// missing. Registering only legacy_ctrl below is exactly that state, and it is
// reachable here because `getModelFromBytes` is the same call the model editor makes.
//
// Fixtures (test/fixtures/make-fixtures.mjs): params.sldd holds Kp, Uo and an unused
// Ki; legacy_ctrl.mdl (classic .mdl) uses Kp and Uo; shared_gain.slx uses Kp twice
// and links the dictionary as `Params.SLDD`, so the case-insensitive match is
// exercised on a real file too.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { annotateVariableRows, buildUsageGraph, type RawSource } from '../src/host/usageCells.js';
import { getModel, getModelFromBytes } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

// import.meta.dirname, not a URL relative to import.meta.url: under happy-dom that
// resolves against a document base rather than the file, and every read fails as
// `/test/fixtures/...` (same trap as ndMatFixture.test.ts).
const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name);

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fixture(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// The uris are synthetic, but the paths carry the real extensions — which is what
// the summariser dispatches on — and every link target below is built from them.
const DICT = 'file:///fx/params.sldd';
const CTRL = 'file:///fx/legacy_ctrl.mdl';
const GAIN = 'file:///fx/shared_gain.slx';

const source = (uriString: string, name: string): RawSource => ({
  uriString,
  path: `/fx/${name}`,
  bytes: bytes(name),
});

// The order the extension hands its files over in (uris order, not read-completion
// order), which is the order the blocks appear in a cell.
const FILES = [
  source(CTRL, 'legacy_ctrl.mdl'),
  source(GAIN, 'shared_gain.slx'),
  source(DICT, 'params.sldd'),
];

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class', 'storageClass', 'Description'];

// These are the provider's own rows, so they are a TREE: the entries sit under
// `section:design`, which starts collapsed (a dictionary can hold thousands of
// entries). Expanding it is what a user does to read the column at all.
async function mount(rows: TreeTableRow[], expanded: string[] = []): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  (table as any)._expandedIds = new Set(expanded);
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const rowNamed = (rows: any[], name: string): any => rows.find((r) => r.Name?.label === name);

beforeEach(() => localStorage.clear());

describe('the usage graph over the real fixture files', () => {
  const graph = () => buildUsageGraph(FILES);

  it('credits a dictionary entry to every block in every model that uses it', () => {
    // Kp is used once in the classic .mdl and twice in the .slx. Three usages across
    // two models is the shape a dictionary exists for, and the one a bare block name
    // cannot report. Each carries the model AND a `blocks:`-channelled target back to
    // the block, which is the whole cell — no second lookup on click.
    //
    // The target names the block by its SID (core v1.8.0), which is why the two
    // shared_gain blocks read `1`/`2` while the classic `.mdl`'s reads `Gain1` — a
    // pre-R2010b file records no SID at all, so there the name IS the key. Both
    // grammars are live on disk and both land here, over the same call.
    expect(graph().blocksUsing(DICT, 'Kp')).toEqual([
      { blockName: 'Gain1', modelName: 'legacy_ctrl', modelUri: CTRL, linkTarget: `blocks:Gain1@${CTRL}` },
      { blockName: 'PlantGain', modelName: 'shared_gain', modelUri: GAIN, linkTarget: `blocks:1@${GAIN}` },
      { blockName: 'Trim', modelName: 'shared_gain', modelUri: GAIN, linkTarget: `blocks:2@${GAIN}` },
    ]);
  });

  it('keeps an entry only one model uses to that model, and an unused one empty', () => {
    const g = graph();
    expect(g.blocksUsing(DICT, 'Uo')).toEqual([
      { blockName: 'Setpoint', modelName: 'legacy_ctrl', modelUri: CTRL, linkTarget: `blocks:Setpoint@${CTRL}` },
    ]);
    // Ki is a real entry in the real dictionary that nothing references. The absence
    // has to come from the files, not from a fixture that omits the entry.
    expect(g.blocksUsing(DICT, 'Ki')).toEqual([]);
  });

  it('resolves an EXPRESSION through a differently-cased dictionary link', () => {
    // Two things at once, both of which only a real file can pin: `Trim`'s value is
    // `2*Kp`, so identifiersIn has to reduce it to `Kp`; and shared_gain.slx records
    // its dictionary as `Params.SLDD` while the file is `params.sldd`, so the ref
    // match has to be case-insensitive. Either failing leaves the param unresolved —
    // rendered with no source and no link, indistinguishable from an unused one.
    // `'2'` is Trim's SID, the key this direction is asked by — see the block-key note
    // on the first test in this describe.
    expect(graph().paramLinks(GAIN, '2')).toEqual([
      { property: 'Value', paramName: '2*Kp', source: 'params.sldd', linkTarget: `Kp@${DICT}` },
    ]);
  });

  it('summarises a dictionary whose own FILENAME is upper-cased', () => {
    // The same real dictionary bytes, at `/fx/Params.SLDD`. Everything that admits a
    // file to this graph — the findFiles glob, `isGraphPath` over the open tabs — is
    // case-insensitive, so the summariser has to be too. While it dispatched on
    // `endsWith('.sldd')` the file was accepted and then classified as neither
    // dictionary nor MAT: it contributed no variables, so BOTH models' `Kp` went
    // unresolved (rendered with no source and no link, like an unused parameter) and
    // the dictionary's own Usage column came up empty.
    const UPPER = 'file:///fx/Params.SLDD';
    const graph = buildUsageGraph([
      FILES[0],
      FILES[1],
      { uriString: UPPER, path: '/fx/Params.SLDD', bytes: bytes('params.sldd') },
    ]);
    expect(graph.blocksUsing(UPPER, 'Kp').map((r) => r.blockName)).toEqual([
      'Gain1',
      'PlantGain',
      'Trim',
    ]);
    // And the forward direction names the file as it is actually spelled on disk,
    // rather than the lower-cased key the refs are matched through.
    expect(graph.paramLinks(GAIN, '1')).toEqual([
      { property: 'Gain', paramName: 'Kp', source: 'Params.SLDD', linkTarget: `Kp@${UPPER}` },
    ]);
  });

  it('lists the blocks in file order, not in read-completion order', () => {
    // usageGraph reads the files concurrently but preserves the uri order, so the
    // same dictionary renders the same cell on every open. Reversing the input must
    // be the only thing that reverses the output.
    const swapped = buildUsageGraph([FILES[1], FILES[0], FILES[2]]);
    expect(swapped.blocksUsing(DICT, 'Kp').map((r) => r.blockName)).toEqual([
      'PlantGain',
      'Trim',
      'Gain1',
    ]);
  });
});

// One engine has to settle this column. These tests put the OTHER one in the state
// that made it answer — one model registered in the session, one not — and pin that
// the graph's answer is the one that survives.
describe('a dictionary row whose Usage the session already answered', () => {
  let sessionRows: any[];

  beforeAll(() => {
    // Exactly what BinaryEditorProvider does when a model editor resolves. Only
    // legacy_ctrl is registered; shared_gain never is, so anything the session says
    // about it is impossible and anything the graph says about it is provably the
    // graph's.
    getModelFromBytes(CTRL, 'legacy_ctrl.mdl', bytes('legacy_ctrl.mdl'));
    // And what SlddTextEditorProvider does for a JSON dictionary: parse, build rows,
    // then annotate. These rows are the ones the webview would receive.
    sessionRows = buildRows(getModel(DICT, 'params.sldd', readFileSync(fixture('params.sldd'), 'utf8')));
  });

  it('arrives from the session naming NO model, and knowing only the open one', () => {
    // The bug as the user meets it: `Kp` is used by three blocks in two models, and
    // this cell claims one block and no model — because the session holds one model.
    const usedBy = rowNamed(sessionRows, 'Kp').UsedBy;
    expect('blockLinks' in usedBy).toBe(false);
    expect(usedBy.links.map((l: any) => l.text)).toEqual(['Gain1']);
  });

  it('is OVERWRITTEN with every model-qualified usage the files hold', () => {
    expect(annotateVariableRows(DICT, sessionRows, buildUsageGraph(FILES))).toBe(true);
    const usedBy = rowNamed(sessionRows, 'Kp').UsedBy;
    expect('links' in usedBy).toBe(false);
    expect(usedBy.blockLinks).toEqual([
      { blockName: 'Gain1', modelName: 'legacy_ctrl', modelUri: CTRL, linkTarget: `blocks:Gain1@${CTRL}` },
      { blockName: 'PlantGain', modelName: 'shared_gain', modelUri: GAIN, linkTarget: `blocks:1@${GAIN}` },
      { blockName: 'Trim', modelName: 'shared_gain', modelUri: GAIN, linkTarget: `blocks:2@${GAIN}` },
    ]);
  });

  it('leaves the row nothing uses exactly as the node layer left it', () => {
    // Ki gets no answer from either engine. Overwriting it with an empty cell would
    // turn "no model here says so" into the emphatic "unused" that neither engine is
    // entitled to claim.
    annotateVariableRows(DICT, sessionRows, buildUsageGraph(FILES));
    expect(rowNamed(sessionRows, 'Ki').UsedBy).toBeUndefined();
  });

  it('renders as one qualifier per model, over the blocks it owns', async () => {
    // The far end of the path: what the user reads. Three usages, two models, two
    // qualifiers — and three separate links, because grouping is presentational and
    // must not cost a navigable target.
    annotateVariableRows(DICT, sessionRows, buildUsageGraph(FILES));
    const table = await mount(sessionRows as TreeTableRow[], ['section:design']);
    const td = table.shadowRoot!.querySelector(
      `tr[data-row-id="${rowNamed(sessionRows, 'Kp').ID}"] td.col-UsedBy`,
    ) as HTMLElement;
    expect(td.textContent!.trim()).toBe('Gain1(legacy_ctrl); PlantGain, Trim(shared_gain)');
    expect([...td.querySelectorAll('a.value-link')].map((a) => a.textContent!.trim())).toEqual([
      'Gain1',
      'PlantGain',
      'Trim',
    ]);
    // Sorting and copying read the same text the cell shows.
    expect((table as any)._getCellText(rowNamed(sessionRows, 'Kp'), 'UsedBy')).toBe(
      'Gain1(legacy_ctrl); PlantGain, Trim(shared_gain)',
    );
    table.remove();
  });
});
