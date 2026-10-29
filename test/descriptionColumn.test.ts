// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Description column, through the webview entry point as it ships (table-main.ts), on the rows
// and the columns the hosts really post. Every host posted columns that left it out, so no table
// showed a Description, although core says of every row whether its object has one and the table
// had the editor and the not-applicable wash for it. Now the column is posted, shown where the
// default order puts it, and: an object with a Description shows it and opens its editor (multi-
// line, test/treeTableMultiLineEdit.test.ts); one without shows the cell washed and opens none.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel } from 'data-explorer-core';
import { buildRows, COLUMNS, COLUMN_LABELS, buildMatRows } from 'data-explorer-view/model';

/* eslint-disable @typescript-eslint/no-explicit-any */

// import.meta.dirname, not a URL against import.meta.url: under happy-dom that resolves against
// the page's location.
const fixture = (...parts: string[]): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', ...parts)));
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const FILES: { name: string; rows: () => any[]; has: string; hasNot: string }[] = [
  {
    name: 'a MAT-file',
    rows: () => buildMatRows(DataModel.addMatSource('desc-col-mat', buffer(fixture('mat', 'pv_basic.mat')), { path: 'pv_basic.mat' })),
    has: 'p',
    hasNot: 'x',
  },
  {
    name: 'a dictionary',
    rows: () =>
      buildRows(
        DataModel.addDataSource('desc-col.sldd', JSON.parse(new TextDecoder().decode(fixture('workspace', 'params.sldd'))), { path: 'params.sldd' }),
      ),
    has: 'gravity',
    hasNot: 'cplxScalar',
  },
];

describe('the Description column, through the webview entry point', () => {
  let table: any;
  let posted: any[];

  beforeAll(async () => {
    localStorage.clear();
    posted = [];
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  }, 60_000);

  const show = async (rows: any[]) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'setRows', docUri: 'file:///fx/d', rows, columns: COLUMNS, columnLabels: COLUMN_LABELS, editable: true },
      }),
    );
    table._editingCell = null;
    // A dictionary's entries are rows under its section rows, drawn once their section is open.
    table._expandedIds = new Set(rows.map((r: any) => r.parent).filter(Boolean));
    table.requestUpdate();
    await table.updateComplete;
    posted.length = 0;
  };
  const cell = (row: any): HTMLElement => table.shadowRoot.querySelector(`tr[data-row-id="${CSS.escape(row.ID)}"] td.col-Description`);
  const rowNamed = (rows: any[], name: string): any => rows.find((r) => r.Name?.label === name && (r.parent == null || String(r.parent).startsWith('section:')));

  it('is posted by the hosts, labelled, after Class', () => {
    expect(COLUMNS).toContain('Description');
    expect(COLUMNS.indexOf('Description')).toBe(COLUMNS.indexOf('Class') + 1);
    expect(COLUMN_LABELS.Description).toBe('Description');
  });

  for (const file of FILES) {
    it(`in ${file.name}: is shown by default`, async () => {
      await show(file.rows());
      expect(table._visibleColumns).toContain('Description');
      const headers = [...table.shadowRoot.querySelectorAll('thead th')].map((th: Element) => th.textContent?.trim() ?? '');
      expect(headers.some((h) => h.startsWith('Description'))).toBe(true);
    });

    it(`in ${file.name}: an object with a Description shows it and opens its editor`, async () => {
      const rows = file.rows();
      await show(rows);
      const row = rowNamed(rows, file.has);
      expect(row._descriptionApplies).toBe(true);
      const td = cell(row);
      expect(td.classList.contains('cell-editable')).toBe(true);
      expect(td.textContent?.trim()).toBe(String(row.Description));
      td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await table.updateComplete;
      const editor = table.shadowRoot.querySelector('.edit-input') as HTMLTextAreaElement;
      expect(editor?.tagName).toBe('TEXTAREA');
      expect(editor.value).toBe(String(row.Description));
      editor.dispatchEvent(new Event('blur', { bubbles: true }));
      expect(posted.filter((m) => m.type === 'edit')).toEqual([]);
    });

    it(`in ${file.name}: an object without one shows the cell washed, and opens no editor`, async () => {
      const rows = file.rows();
      await show(rows);
      const row = rowNamed(rows, file.hasNot);
      expect(row._descriptionApplies).toBe(false);
      const td = cell(row);
      expect(td.classList.contains('cell-blank')).toBe(true);
      expect(td.classList.contains('cell-editable')).toBe(false);
      td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await table.updateComplete;
      expect(table.shadowRoot.querySelector('.edit-input')).toBeNull();
      expect(table._editingCell).toBeNull();
    });
  }
});
