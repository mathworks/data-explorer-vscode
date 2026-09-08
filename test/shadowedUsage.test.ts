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
import { annotateVariableRows, buildUsageGraph, type RawSource } from '../src/host/usageCells.js';
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
    // an identity and the text is a label, and they are not the same string.
    expect(graph().blocksUsing(SHADOW, 'Kp')).toEqual([
      { blockName: 'WsGain', modelName: 'shadow_ws', modelUri: SHADOW, linkTarget: `blocks:1@${SHADOW}` },
    ]);
  });

  it('credits the SHADOWED dictionary entry with nothing', () => {
    expect(graph().blocksUsing(DICT, 'Kp')).toEqual([]);
  });

  it('still credits the same dictionary for the name only IT defines', () => {
    // The control: the link resolves, the dictionary is reached, and shadowing is per
    // NAME. Without this the empty cell above would prove nothing.
    expect(graph().blocksUsing(DICT, 'Uo')).toEqual([
      { blockName: 'DictOnly', modelName: 'shadow_ws', modelUri: SHADOW, linkTarget: `blocks:2@${SHADOW}` },
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
        { blockName: 'DictOnly', modelName: 'shadow_ws', modelUri: SHADOW, linkTarget: `blocks:2@${SHADOW}` },
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
    table.remove();
  });
});
