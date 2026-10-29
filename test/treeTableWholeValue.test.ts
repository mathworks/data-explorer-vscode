// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A Value shown as a summary for its size (`<1x500 double>`) is edited as the whole of its text.
// The row carries only a marker that there is one (`_hasEditText`): the text can run to 200,000
// characters, so the table asks the host for it as the editor opens (`dex-edit-text-request`, which
// table-main.ts sends as `requestEditText`), and the host's answer opens the editor on it
// (openWholeValueEditor). The cell goes on showing the summary; the editor is the textarea, as the
// text is one long line; committed unchanged it posts nothing, and changed it posts the whole text.
// Before, such a Value took no editor, and a row whose value had been saved long was locked.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/view/widgets/tree-table/dex-tree-table.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LONG = '[' + Array.from({ length: 500 }, (_, i) => i + 1).join(' ') + ']';

beforeEach(() => localStorage.clear());

let table: DexTreeTable;
afterEach(() => table?.remove());

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType'];
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const summaryRow = (id = 'v'): TreeTableRow =>
  ({ ID: id, parent: null, Name: { label: id }, Value: '<1x500 double>', _valueEditable: true, _hasEditText: true, DataType: 'double' }) as any;

type Edit = { rowId: string; columnId: string; oldValue: string; newValue: string };
function record(t: DexTreeTable): { edits: Edit[]; requests: string[] } {
  const edits: Edit[] = [];
  const requests: string[] = [];
  t.addEventListener('dex-edit-completed', (e) => edits.push((e as CustomEvent).detail));
  t.addEventListener('dex-edit-text-request', (e) => requests.push((e as CustomEvent).detail.rowId));
  return { edits, requests };
}

const valueCell = (t: DexTreeTable, id = 'v'): HTMLElement =>
  t.shadowRoot!.querySelector(`tr[data-row-id="${CSS.escape(id)}"] td.col-Value`) as HTMLElement;
const editorOf = (t: DexTreeTable) => t.shadowRoot!.querySelector('.edit-input') as HTMLTextAreaElement | null;
const key = (k: string) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

/** Double-click the Value cell, and answer the request as the host does, with `text`. */
async function openWith(t: DexTreeTable, text: string, id = 'v'): Promise<HTMLTextAreaElement> {
  valueCell(t, id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await t.updateComplete;
  t.openWholeValueEditor(id, text);
  await t.updateComplete;
  return editorOf(t)!;
}

describe('a Value shown as a summary for its size', () => {
  it('shows the summary, and asks for its whole text as the editor opens, opening none until it comes', async () => {
    const t = await mount([summaryRow()]);
    const { requests } = record(t);
    expect(valueCell(t).textContent?.trim()).toBe('<1x500 double>');
    expect(valueCell(t).classList.contains('cell-editable')).toBe(true);
    valueCell(t).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await t.updateComplete;
    expect(requests).toEqual(['v']);
    expect(editorOf(t)).toBeNull();
  });

  it('opens a textarea seeded with the text the host sends', async () => {
    const t = await mount([summaryRow()]);
    const editor = await openWith(t, LONG);
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.value).toBe(LONG);
    expect(valueCell(t).querySelector('.edit-input')).toBe(editor);
  });

  for (const [how, commit] of [
    ['Enter', (e: HTMLElement) => e.dispatchEvent(key('Enter'))],
    ['blur', (e: HTMLElement) => e.dispatchEvent(new Event('blur', { bubbles: true }))],
  ] as const) {
    it(`committed unchanged (${how}) posts nothing`, async () => {
      const t = await mount([summaryRow()]);
      const { edits } = record(t);
      commit(await openWith(t, LONG));
      expect(edits).toEqual([]);
    });
  }

  it('an element changed posts the whole text, against the whole text it was seeded with', async () => {
    const t = await mount([summaryRow()]);
    const { edits } = record(t);
    const editor = await openWith(t, LONG);
    editor.value = LONG.replace('[1 2 ', '[7 2 ');
    editor.dispatchEvent(key('Enter'));
    expect(edits).toEqual([{ rowId: 'v', columnId: 'Value', oldValue: LONG, newValue: LONG.replace('[1 2 ', '[7 2 ') }]);
  });

  it('takes 200,000 characters, and set back unchanged posts nothing', async () => {
    const huge = '[' + '1 '.repeat(99_999) + ']';
    expect(huge.length).toBe(200_000);
    const t = await mount([summaryRow()]);
    const { edits } = record(t);
    const editor = await openWith(t, huge);
    expect(editor.value.length).toBe(200_000);
    editor.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(edits).toEqual([]);
  });

  it('Enter on the focused cell asks for the text too', async () => {
    const t = await mount([summaryRow()]);
    const { requests } = record(t);
    (t as any)._focusedRowId = 'v';
    (t as any)._focusedCol = (t as any)._visibleColumns.indexOf('Value');
    (t as any)._onTableKeyDown(key('Enter'));
    expect(requests).toEqual(['v']);
  });

  it('opens nothing for an answer to a request it did not make, or after the user moved on', async () => {
    const t = await mount([summaryRow('a'), summaryRow('b')]);
    t.openWholeValueEditor('a', LONG);
    await t.updateComplete;
    expect(editorOf(t)).toBeNull();
    // Asked for a, then for b: a's answer, arriving late, opens nothing; b's opens b.
    valueCell(t, 'a').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    valueCell(t, 'b').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    t.openWholeValueEditor('a', LONG);
    await t.updateComplete;
    expect(editorOf(t)).toBeNull();
    t.openWholeValueEditor('b', LONG);
    await t.updateComplete;
    expect((t as any)._editingCell).toMatchObject({ rowId: 'b', columnId: 'Value', value: LONG });
  });

  it('a Value with no marker still opens an input on its shown text, and asks for nothing', async () => {
    const t = await mount([{ ID: 'v', parent: null, Name: { label: 'v' }, Value: '[1 2 3]', _valueEditable: true } as any]);
    const { requests } = record(t);
    valueCell(t).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await t.updateComplete;
    expect(editorOf(t)?.tagName).toBe('INPUT');
    expect(editorOf(t)?.value).toBe('[1 2 3]');
    expect(requests).toEqual([]);
  });
});
