// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// "A section heading is never a search match" over a REAL file, because that rule spans
// two paths and is held by a convention rather than by a type: the HOST stamps a
// heading's row id (`rowBuilder` → `buildSectionRowId`), and the WEBVIEW's filter decides
// from that prefix alone which rows it is allowed to match. Both halves are already
// tested against hand-authored rows (rowFilter.test.ts, treeTableFilter.test.ts) — and
// those tests pass just as well if the host stops spelling the ids that way, at which
// point every heading becomes searchable again and the entries under it come back with
// it. So the ids here are the ones the parser really produces.
//
// Picked up from: searching `data` in a dictionary listed every entry in Architectural
// Data, because the HEADING matched and a match keeps its whole subtree.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { buildRows, COLUMNS, COLUMN_LABELS } from '../src/host/rowBuilder.js';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { isSectionRowId } from '../src/common/sectionRowId.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// `import.meta.dirname`, not a URL resolved against `import.meta.url`: under happy-dom
// that base is not a file: URL and the read fails (same trap as ndMatFixture.test.ts).
const archText = readFileSync(join(import.meta.dirname, 'fixtures', 'arch.sldd'), 'utf8');

beforeEach(() => localStorage.clear());

function realRows(): TreeTableRow[] {
  const uri = 'test://section-heading-filter.sldd';
  invalidate(uri);
  return buildRows(getModel(uri, 'arch.sldd', archText)) as TreeTableRow[];
}

// The real table, with every column revealed and every section open, so a bare term is
// read against the whole row and nothing is missing merely because it was collapsed.
async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = COLUMNS;
  table.columnLabels = COLUMN_LABELS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  (table as any)._expandedIds = new Set(rows.map((r) => r.ID));
  (table as any)._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

/** Type into the real box and commit with a real Enter, then read back what survived. */
async function search(table: DexTreeTable, text: string): Promise<string[]> {
  const bar = table.shadowRoot!.querySelector('dex-filter-bar') as HTMLElement & { updateComplete: Promise<unknown> };
  const input = bar.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await bar.updateComplete;
  await table.updateComplete;
  return (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);
}

const idOf = (rows: TreeTableRow[], name: string): string =>
  rows.find((r) => r.Name?.label === name && !isSectionRowId(r.ID))!.ID;

describe('a section heading of a real dictionary is not a searchable row', () => {
  it('the host stamps headings, and only headings, with the id the filter keys on', () => {
    // The whole rule rests on this. An entry whose id happened to start with `section:`
    // would silently become unsearchable; a heading that stopped starting with it would
    // silently become searchable again.
    const rows = realRows();
    const headings = rows.filter((r) => isSectionRowId(r.ID)).map((r) => r.ID);
    expect(headings).toEqual(['section:design', 'section:arch', 'section:config', 'section:other']);
    expect(rows.filter((r) => r.parent === null).map((r) => r.ID)).toEqual(headings);
    expect(rows.filter((r) => !isSectionRowId(r.ID)).every((r) => r.parent !== null)).toBe(true);
  });

  it('searching a word only a heading holds narrows the section instead of opening it', async () => {
    const rows = realRows();
    const table = await mount(rows);
    expect(await search(table, 'data')).toContain(idOf(rows, 'DataInterface'));
    const visible = await search(table, 'data');
    // `Architectural Data` contains `data`, and these entries do not. Before the fix all
    // of them were listed, since the heading's match kept its whole subtree.
    for (const name of ['AliasType', 'NumericType', 'ValueType', 'ServiceInterface']) {
      expect(visible, name).not.toContain(idOf(rows, name));
    }
    // And the headings holding nothing that matches are gone outright, rather than
    // standing there on the strength of their own names.
    expect(visible.filter(isSectionRowId)).toEqual(['section:arch']);
    table.remove();
  });

  it('with no search every heading is still there, counts and all', async () => {
    // The opposite failure: making headings unmatchable must not make them unreachable.
    const rows = realRows();
    const table = await mount(rows);
    const visible = (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);
    expect(visible.filter(isSectionRowId)).toEqual([
      'section:design', 'section:arch', 'section:config', 'section:other',
    ]);
    const cell = table.shadowRoot!.querySelector('tr[data-row-id="section:arch"] td.col-Name') as HTMLElement;
    expect(cell.textContent).toContain('Architectural Data');
    table.remove();
  });
});
