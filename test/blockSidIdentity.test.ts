// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A block is identified by its SID, and its NAME is only a label — over real bytes, from
// the parse to the text in the cell.
//
// Found in ~/delite/f/f14.slx, in two shapes at once. A block name is unique only inside
// its own system, and that model has four blocks named `Gain` in four different
// subsystems; keyed by name they collapsed into ONE row whose Usage read
// `Gain=Mq, Gain=Zw, Gain=Kf, Gain=Zw` — four blocks' parameters in one cell — and all
// four shared the row id `f14.slx/blocks/Gain`, so the Property Inspector, a selection,
// and a Usage link could not tell them apart. And the model holds a Constant whose `Name`
// attribute Simulink wrote as a lone line break (`Name="&#xA;"` SID 65): it normalizes to
// the empty string, so the row showed a BLANK Name, took the id `f14.slx/blocks/`, and its
// Usage link — whose text is the block name — was an empty anchor with nothing to click.
//
// Core v1.8.0 splits the two facts (`blockKey` = the SID, `blockLabel` = the name or
// `<SID: n>`) and this repo joins on the key: `_blockKey` is what a row publishes and what
// `annotateModelViewRows` asks the graph by. Both halves are needed for a correct cell, so
// neither repo can pin it alone — core's tests end at the index, and the join, the row id,
// the label and the rendered anchor are this repo's.
//
// Fixture (test/fixtures/make-fixtures.mjs): sid_blocks.slx links params.sldd and holds
// `Gain`(SID 15, reads `Kp`) in the root system, plus `Gain`(SID 24, reads `Ki`) and the
// nameless Constant (SID 65, reads `Uo`) in a subsystem of its own. The two same-named
// blocks read DIFFERENT variables on purpose: that is what makes a merge visible rather
// than merely plausible.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  annotateModelViewRows,
  buildUsageGraph,
  type RawSource,
} from '../src/host/usageCells.js';
import { parseNavTarget } from '../src/host/navTarget.js';
import { getModelFromBytes } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

// import.meta.dirname, not a URL against import.meta.url: under happy-dom that resolves
// against a document base rather than the file (same trap as usageEndToEnd.test.ts).
const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name);

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fixture(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const DICT = 'file:///fx/params.sldd';
const MODEL = 'file:///fx/sid_blocks.slx';

const source = (uriString: string, name: string): RawSource => ({
  uriString,
  path: `/fx/${name}`,
  bytes: bytes(name),
});

const FILES = [source(MODEL, 'sid_blocks.slx'), source(DICT, 'params.sldd')];

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class', 'storageClass', 'Description'];

const NAMELESS = '<SID: 65>';

beforeEach(() => localStorage.clear());

describe('the workspace graph over same-named and nameless blocks', () => {
  const graph = () => buildUsageGraph(FILES);

  it('credits two same-named blocks separately, each by its own SID', () => {
    // Same label, same model, different systems, different variables. The cells read the
    // same word twice — that part IS the model — but the TARGETS differ, so the two rows
    // are reachable independently. Keyed by name there was one target for both.
    expect(graph().blocksUsing(DICT, 'Kp')).toEqual([
      { blockName: 'Gain', modelName: 'sid_blocks', modelUri: MODEL, linkTarget: `blocks:15@${MODEL}` },
    ]);
    expect(graph().blocksUsing(DICT, 'Ki')).toEqual([
      { blockName: 'Gain', modelName: 'sid_blocks', modelUri: MODEL, linkTarget: `blocks:24@${MODEL}` },
    ]);
  });

  it('gives the nameless block a printable label and a followable link', () => {
    // The f14 block the user asked about, over the same `Uo` it reads there. The cell text
    // was empty — an anchor with no characters in it cannot be clicked — and the target
    // named no block at all.
    expect(graph().blocksUsing(DICT, 'Uo')).toEqual([
      { blockName: NAMELESS, modelName: 'sid_blocks', modelUri: MODEL, linkTarget: `blocks:65@${MODEL}` },
    ]);
  });

  it('resolves a block’s parameters by SID, and knows nothing of the label', () => {
    const g = graph();
    expect(g.paramLinks(MODEL, '15')).toEqual([
      { property: 'Gain', paramName: 'Kp', source: 'params.sldd', linkTarget: `Kp@${DICT}` },
    ]);
    expect(g.paramLinks(MODEL, '24')).toEqual([
      { property: 'Gain', paramName: 'Ki', source: 'params.sldd', linkTarget: `Ki@${DICT}` },
    ]);
    expect(g.paramLinks(MODEL, '65')).toEqual([
      { property: 'Value', paramName: 'Uo', source: 'params.sldd', linkTarget: `Uo@${DICT}` },
    ]);
    // The label is not a key, and asking by it must MISS rather than answer for whichever
    // block happens to be first. A host that joined on the Name cell would get `[]` here
    // and render an empty Usage column — which is how this join is kept honest.
    expect(g.paramLinks(MODEL, 'Gain')).toEqual([]);
    expect(g.paramLinks(MODEL, NAMELESS)).toEqual([]);
  });
});

describe('the model view’s own rows, from the parse through the annotation', () => {
  let rows: any[];

  beforeAll(() => {
    // Exactly what BinaryEditorProvider does when a model editor resolves.
    rows = buildRows(getModelFromBytes(MODEL, 'sid_blocks.slx', bytes('sid_blocks.slx')));
  });

  const blockRows = (): any[] => rows.filter((r) => r._isBlockRow);

  it('gives every block its own row, with the SID in the id', () => {
    // Three blocks, three rows. Two of them are named `Gain`, which used to make one row
    // with one id — the merge the user saw. The id is the internal identity: selection,
    // the Property Inspector, expansion state and every edit are keyed by it.
    expect(blockRows().map((r) => r.ID)).toEqual([
      `${MODEL}/blocks/15`,
      `${MODEL}/blocks/24`,
      `${MODEL}/blocks/65`,
    ]);
    expect(new Set(blockRows().map((r) => r.ID)).size).toBe(3);
  });

  it('labels the nameless block by its SID and never with an empty Name', () => {
    expect(blockRows().map((r) => r.Name?.label)).toEqual(['Gain', 'Gain', NAMELESS]);
  });

  it('publishes the key beside the label, so no consumer has to read the text', () => {
    expect(blockRows().map((r) => r._blockKey)).toEqual(['15', '24', '65']);
  });

  it('annotates each row with its OWN parameter', () => {
    // The defect, in the shape it reached the user: two rows labelled `Gain` must not both
    // resolve to the same block. Joining on `Name.label` gives BOTH rows the first block's
    // `Kp` (or, before the rows were split at all, one row carrying every `Gain`'s params),
    // and gives the nameless row nothing, because `<SID: 65>` matches no block in the index.
    expect(annotateModelViewRows(MODEL, rows, buildUsageGraph(FILES))).toBe(true);
    expect(blockRows().map((r) => r.UsedBy)).toEqual([
      { paramLinks: [{ property: 'Gain', paramName: 'Kp', source: 'params.sldd', linkTarget: `Kp@${DICT}` }] },
      { paramLinks: [{ property: 'Gain', paramName: 'Ki', source: 'params.sldd', linkTarget: `Ki@${DICT}` }] },
      { paramLinks: [{ property: 'Value', paramName: 'Uo', source: 'params.sldd', linkTarget: `Uo@${DICT}` }] },
    ]);
  });

  it('renders three distinguishable rows, each with a clickable usage', async () => {
    // The far end: a Usage cell is only right if it is read, and a link only exists if
    // there are characters to click. `<SID: 65>` is the whole point of the label — a blank
    // Name cell beside a filled Usage cell is what the user reported.
    annotateModelViewRows(MODEL, rows, buildUsageGraph(FILES));
    const table = new DexTreeTable();
    table.columns = HOST_COLUMNS;
    document.body.appendChild(table);
    (table as any)._hiddenColumns = new Set<string>();
    (table as any)._expandedIds = new Set(['section:blocks']);
    table.rows = rows as TreeTableRow[];
    table.requestUpdate();
    await table.updateComplete;
    const cell = (id: string, col: string): HTMLElement =>
      table.shadowRoot!.querySelector(`tr[data-row-id="${id}"] td.col-${col}`) as HTMLElement;
    const text = (id: string, col: string): string => cell(id, col).textContent!.trim();

    expect(text(`${MODEL}/blocks/15`, 'Name')).toBe('Gain');
    expect(text(`${MODEL}/blocks/15`, 'UsedBy')).toBe('Gain=Kp(params.sldd)');
    expect(text(`${MODEL}/blocks/24`, 'Name')).toBe('Gain');
    expect(text(`${MODEL}/blocks/24`, 'UsedBy')).toBe('Gain=Ki(params.sldd)');
    expect(text(`${MODEL}/blocks/65`, 'Name')).toBe(NAMELESS);
    expect(text(`${MODEL}/blocks/65`, 'UsedBy')).toBe('Value=Uo(params.sldd)');
    // Every one of the three has an anchor with text in it. The nameless block's used to
    // render as an empty `<a>`: present in the DOM, invisible, and unclickable.
    for (const sid of ['15', '24', '65']) {
      const links = [...cell(`${MODEL}/blocks/${sid}`, 'UsedBy').querySelectorAll('a.value-link')];
      expect(links.length).toBe(1);
      expect(links[0].textContent!.trim().length).toBeGreaterThan(0);
    }
    table.remove();
  });

  // The other end of the same link: a click on `blocks:65@…` in the DICTIONARY's Usage
  // column opens this model and asks it to select that block. What travels is the KEY, so
  // the webview cannot find the row by its Name cell — nothing is labelled `65` — and
  // table-main.ts matches `_blockKey` for exactly this reason. Pinning the two facts the
  // matcher depends on: what the target parses to, and that only the key can meet it.
  it('leaves a navigation nothing to match but the key', () => {
    const target = buildUsageGraph(FILES).blocksUsing(DICT, 'Uo')[0].linkTarget;
    const parsed = parseNavTarget(target)!;
    expect(parsed).toEqual({ name: '65', source: MODEL });
    expect(rows.filter((r) => r.Name?.label === parsed.name)).toEqual([]);
    expect(rows.filter((r) => r._blockKey === parsed.name).map((r) => r.ID)).toEqual([
      `${MODEL}/blocks/65`,
    ]);
  });

  // And that the matcher itself looks there. table-main.ts is a webview ENTRY module — it
  // builds the table and wires `window.addEventListener('message')` at import — so it is
  // read rather than run, the same way webviewOverlays.test.ts reads it.
  it('is matched by a webview that considers the key', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src/webview/table-main.ts'), 'utf8');
    expect(src).toContain('r._blockKey === pendingSelectName');
  });
});
