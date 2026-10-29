// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The not-applicable Description cell (descriptionNotApplicable.test.ts) through the webview
// entry point as it ships (table-main.ts): no `edit` message ever reaches the host for a
// Description the object does not have, an editable one still sends its edit, and a
// read-only view is gated exactly as before.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const posted: any[] = [];
let table: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const edits = () => posted.filter((m) => m.type === 'edit');

const rows = () => [
  { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
  { ID: 'd/design/x', parent: 'section:design', Name: { label: 'x', editable: true }, Value: '1', DataType: 'double', Description: '', Status: '', _descriptionApplies: false },
  { ID: 'd/design/K', parent: 'section:design', Name: { label: 'K', editable: true }, Value: '2', DataType: 'double', Description: 'gain', Status: '', _descriptionApplies: true, _descriptionEditable: true },
];

async function paint(editable: boolean): Promise<void> {
  send({ type: 'setRows', docUri: 'file:///fx/d.sldd', rows: rows(), columns: ['Name', 'Value', 'Description'], columnLabels: {}, editable });
  table._hiddenColumns = new Set<string>();
  table._expandedIds = new Set(['section:design']);
  table._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
}

const td = (rowId: string) => table.shadowRoot.querySelector(`tr[data-row-id="${rowId}"] td.col-Description`) as HTMLElement;

async function typeInto(rowId: string, text: string): Promise<boolean> {
  table._editingCell = null;
  // Composed, as the browser's is: the read-only gate listens on the table element, outside
  // the shadow root the cell is in.
  td(rowId).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  await table.updateComplete;
  const input = table.shadowRoot.querySelector('.edit-input') as HTMLInputElement | null;
  if (!input) return false;
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await table.updateComplete;
  return true;
}

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
}, 60_000);

beforeEach(() => {
  posted.length = 0;
});

describe('an editable view', () => {
  it('posts no edit for a Description the object does not have, and draws it not applicable', async () => {
    await paint(true);
    expect(td('d/design/x').className).toContain('cell-blank');
    expect(await typeInto('d/design/x', 'typed')).toBe(false);
    expect(edits()).toEqual([]);
  });

  it('still posts the edit of one it has', async () => {
    await paint(true);
    expect(await typeInto('d/design/K', 'loop gain')).toBe(true);
    expect(edits()).toEqual([{ type: 'edit', rowId: 'd/design/K', columnId: 'Description', oldValue: 'gain', newValue: 'loop gain' }]);
  });
});

describe('a read-only view is unchanged', () => {
  it('opens no editor on either row and posts nothing', async () => {
    await paint(false);
    expect(await typeInto('d/design/K', 'loop gain')).toBe(false);
    expect(await typeInto('d/design/x', 'typed')).toBe(false);
    expect(edits()).toEqual([]);
    // The cell still says which kind of empty it is: not applicable on the row without the
    // property, and the same cell state as before on the one with it.
    expect(td('d/design/x').className).toContain('cell-blank');
    expect(td('d/design/K').className).not.toContain('cell-blank');
  });
});
