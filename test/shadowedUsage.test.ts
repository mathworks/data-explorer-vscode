// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A dictionary entry that a model workspace SHADOWS shows no usage — over real bytes, and
// with BOTH engines in play, which is the only place this could be pinned.
//
// MATLAB resolves a name once: model workspace, then the linked dictionary chain, then the
// external MATs. So a model whose own workspace defines `Kp` reads that value, and the
// dictionary's `Kp` is not used by that block at all — a Usage link on it points at code
// that does not read it, and a user following the link lands on a block whose value comes
// from somewhere else.
//
// Neither engine alone shows this. The workspace graph (core's file-summary index) resolved
// in order from the start and correctly answers "nothing" for the shadowed entry; the
// session (core's `findUsages`, which fills a row's `UsedBy` before this host annotates it)
// credited every definition a model could REACH, and answered "WsGain". And because
// `annotateVariableRows` LEAVES ALONE a row the graph has no answer for — deliberately, so
// that a model in the session but not on disk still reports its usages — "nothing" cannot
// overwrite "WsGain". The two policies compose into the defect: the graph declines to
// answer, and the session's wrong answer is what the user reads.
//
// So the fix is core's (v1.7.0 resolves in order in both engines) and the regression is
// THIS repo's to pin, because the composition is this repo's: fixtures → graph + session →
// annotated row → rendered cell.
//
// Fixture (test/fixtures/make-fixtures.mjs): shadow_ws.slx links params.sldd and defines
// `Kp` in its own model workspace; `WsGain` reads `Kp` and `DictOnly` reads `Uo`, which
// only the dictionary defines. That second block is the control — it proves the dictionary
// is genuinely linked and reachable, so an empty `Kp` cell means shadowing and not a link
// that failed to resolve.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  annotateModelViewRows,
  annotateVariableRows,
  buildUsageGraph,
  type RawSource,
} from '../src/host/usageCells.js';
import { getModel, getModelFromBytes } from '../src/host/SlddModel.js';
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
const SHADOW = 'file:///fx/shadow_ws.slx';

const source = (uriString: string, name: string): RawSource => ({
  uriString,
  path: `/fx/${name}`,
  bytes: bytes(name),
});

const FILES = [source(SHADOW, 'shadow_ws.slx'), source(DICT, 'params.sldd')];

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class', 'storageClass', 'Description'];

const rowNamed = (rows: any[], name: string): any => rows.find((r) => r.Name?.label === name);

const linkTexts = (cell: any): string[] => (cell?.links ?? []).map((l: any) => l.text);

beforeEach(() => localStorage.clear());

describe('the workspace graph over a model that shadows its dictionary', () => {
  const graph = () => buildUsageGraph(FILES);

  it('credits the model workspace variable, which is what the block reads', () => {
    // Keyed on the MODEL's uri: a model's own workspace is a source of definitions like
    // any other, and this is the cell the model view's workspace rows carry.
    //
    // The link names the block by its SID (`1`) and the CELL by its name — the target is
    // an identity and the text is a label, and they are not the same string. The path is
    // a third thing again: where the block is, which for a root-system block is its
    // label alone.
    expect(graph().blocksUsing(SHADOW, 'Kp')).toEqual([
      {
        blockName: 'WsGain',
        blockPath: 'WsGain',
        modelName: 'shadow_ws',
        modelUri: SHADOW,
        linkTarget: `blocks:1@${SHADOW}`,
      },
    ]);
  });

  it('credits the SHADOWED dictionary entry with nothing', () => {
    expect(graph().blocksUsing(DICT, 'Kp')).toEqual([]);
  });

  it('still credits the same dictionary for the name only IT defines', () => {
    // The control: the link resolves, the dictionary is reached, and shadowing is per
    // NAME. Without this the empty cell above would prove nothing.
    expect(graph().blocksUsing(DICT, 'Uo')).toEqual([
      {
        blockName: 'DictOnly',
        blockPath: 'DictOnly',
        modelName: 'shadow_ws',
        modelUri: SHADOW,
        linkTarget: `blocks:2@${SHADOW}`,
      },
    ]);
  });

  it('names the workspace as the origin of the block parameter, with no source suffix', () => {
    // The forward direction of the same resolution, and the other half of the fix: the
    // parameter must not be labelled `(params.sldd)`. A `workspace:` target is the
    // extension's routing prefix for a definition in the model's own workspace.
    // Asked by block KEY — `1` is WsGain's SID, `2` is DictOnly's — which is the join
    // `annotateModelRows` performs with the row's `_blockKey`.
    expect(graph().paramLinks(SHADOW, '1')).toEqual([
      { property: 'Gain', paramName: 'Kp', source: '', linkTarget: `workspace:Kp@${SHADOW}` },
    ]);
    expect(graph().paramLinks(SHADOW, '2')).toEqual([
      { property: 'Value', paramName: 'Uo', source: 'params.sldd', linkTarget: `Uo@${DICT}` },
    ]);
  });
});

// The composition, in the state that produced the bug: the shadowing model registered in
// the session (which is what opening its editor does), the dictionary's own rows built and
// then annotated. The session answers first, the graph annotates second, and neither on its
// own can be trusted to have got the cell right.
describe('the dictionary’s own rows, session first and graph second', () => {
  let sessionRows: any[];

  beforeAll(() => {
    // Exactly what BinaryEditorProvider does when a model editor resolves, and what a
    // user's click on a Usage link does too — a registration is never withdrawn, so this
    // is the state a session drifts into by being used.
    getModelFromBytes(SHADOW, 'shadow_ws.slx', bytes('shadow_ws.slx'));
    // And what SlddTextEditorProvider does for a JSON dictionary.
    sessionRows = buildRows(getModel(DICT, 'params.sldd', readFileSync(fixture('params.sldd'), 'utf8')));
  });

  it('arrives from the session with NO cell on the shadowed entry', () => {
    // The bug, as the user met it: this cell used to read `WsGain`, a link to a block
    // whose gain comes from the model workspace and never from here.
    expect(rowNamed(sessionRows, 'Kp').UsedBy).toBeUndefined();
  });

  it('arrives from the session WITH a cell on the entry the model really uses', () => {
    // So the empty cell above is shadowing and not a session that resolves nothing: the
    // same session, the same dictionary, the same model, one name away. The session names
    // the block without its model, which is why the graph overwrites this cell.
    expect(linkTexts(rowNamed(sessionRows, 'Uo').UsedBy)).toEqual(['DictOnly']);
  });

  it('survives the annotation pass, which has nothing to overwrite it with', () => {
    // `annotateVariableRows` leaves a row the graph cannot answer for ALONE, so this is
    // where the session's answer used to reach the user unopposed. It now agrees.
    expect(annotateVariableRows(DICT, sessionRows, buildUsageGraph(FILES))).toBe(true);
    expect(rowNamed(sessionRows, 'Kp').UsedBy).toBeUndefined();
    expect(rowNamed(sessionRows, 'Uo').UsedBy).toEqual({
      blockLinks: [
        {
          blockName: 'DictOnly',
          blockPath: 'DictOnly',
          modelName: 'shadow_ws',
          modelUri: SHADOW,
          linkTarget: `blocks:2@${SHADOW}`,
        },
      ],
    });
  });

  it('renders as an empty cell, with no link for the user to follow', async () => {
    // The far end: a Usage cell is only wrong if it is read, and a link is only wrong if
    // it is there to click.
    annotateVariableRows(DICT, sessionRows, buildUsageGraph(FILES));
    const table = new DexTreeTable();
    table.columns = HOST_COLUMNS;
    document.body.appendChild(table);
    (table as any)._hiddenColumns = new Set<string>();
    // The design section starts collapsed — expanding it is what a user does to read the
    // column at all.
    (table as any)._expandedIds = new Set(['section:design']);
    table.rows = sessionRows as TreeTableRow[];
    table.requestUpdate();
    await table.updateComplete;
    const cellOf = (name: string): HTMLElement =>
      table.shadowRoot!.querySelector(
        `tr[data-row-id="${rowNamed(sessionRows, name).ID}"] td.col-UsedBy`,
      ) as HTMLElement;
    expect(cellOf('Kp').textContent!.trim()).toBe('');
    expect(cellOf('Kp').querySelectorAll('a.value-link').length).toBe(0);
    // And the row beside it still renders its usage, so an empty cell is a statement
    // about this entry and not a column that stopped working.
    expect(cellOf('Uo').textContent!.trim()).toBe('DictOnly(shadow_ws)');
    // The link's tooltip is where the block is, so two links printing one name can still
    // be told apart. Not part of the text above, deliberately: the path belongs on hover
    // rather than in a column this narrow.
    expect(cellOf('Uo').querySelector('a.value-link')!.getAttribute('title')).toBe('DictOnly');
    table.remove();
  });
});

// The same `Kp`, read from the model's own side. The dictionary view above is where
// `(shadow_ws)` earns its place — a dictionary is shared, so the model is what tells one
// `Gain` from another. A MODEL WORKSPACE is shared with nobody: every block that can read
// `Kp` is a block of shadow_ws, so the qualifier named the file already open in the tab,
// once for every link in the column.
describe('the model’s own view, where a workspace variable’s users can only be here', () => {
  let rows: any[];

  beforeAll(() => {
    // What BinaryEditorProvider does when the MODEL's editor resolves: its own rows, then
    // the same annotation pass the dictionary got.
    rows = buildRows(getModelFromBytes(SHADOW, 'shadow_ws.slx', bytes('shadow_ws.slx')));
    annotateModelViewRows(SHADOW, rows, buildUsageGraph(FILES));
  });

  it('keeps everything that identifies the block and drops only the printed qualifier', () => {
    expect(rowNamed(rows, 'Kp').UsedBy).toEqual({
      blockLinks: [
        {
          blockName: 'WsGain',
          blockPath: 'WsGain',
          // Blank, not absent: the link is fully answered, and the uri below still says
          // which model — so grouping, the tooltip and the target are all as they were.
          modelName: '',
          modelUri: SHADOW,
          linkTarget: `blocks:1@${SHADOW}`,
        },
      ],
    });
  });

  it('reads as the block alone, in the cell and in the text the cell copies as', async () => {
    const table = new DexTreeTable();
    table.columns = HOST_COLUMNS;
    document.body.appendChild(table);
    (table as any)._hiddenColumns = new Set<string>();
    (table as any)._expandedIds = new Set(['section:workspace', 'section:blocks']);
    table.rows = rows as TreeTableRow[];
    table.requestUpdate();
    await table.updateComplete;
    const cellOf = (name: string): HTMLElement =>
      table.shadowRoot!.querySelector(
        `tr[data-row-id="${rowNamed(rows, name).ID}"] td.col-UsedBy`,
      ) as HTMLElement;

    expect(cellOf('Kp').textContent!.trim()).toBe('WsGain');
    expect(cellOf('Kp').querySelector('.param-source')).toBeNull();
    // The link itself is untouched — still followable, and still saying where the block is.
    expect(cellOf('Kp').querySelectorAll('a.value-link').length).toBe(1);
    expect(cellOf('Kp').querySelector('a.value-link')!.getAttribute('title')).toBe('WsGain');
    // The column's TEXT, which is what sorting, copying and the filter bar see. Built from
    // `modelName` as well, which is why the qualifier had to come off the payload rather
    // than be hidden in the template: otherwise this still read `WsGain(shadow_ws)`.
    expect((table as any)._getCellText(rowNamed(rows, 'Kp'), 'UsedBy')).toBe('WsGain');

    // The styling this now matches, two rows up: the block that reads `Kp` has never said
    // `Gain=Kp(shadow_ws)`, because a param resolved to the model's own workspace carries
    // no source. One edge, both directions, one view, and now one convention.
    expect(cellOf('WsGain').textContent!.trim()).toBe('Gain=Kp');
    // And the control, unchanged: `Uo` comes from the linked dictionary, so the block that
    // reads it still names where the value is from. Dropping a qualifier that disambiguates
    // is the failure this test would otherwise permit.
    expect(cellOf('DictOnly').textContent!.trim()).toBe('Value=Uo(params.sldd)');
    table.remove();
  });
});
