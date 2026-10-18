// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A cell whose object says `editor: 'textArea'` is edited in a <textarea>, which keeps its line
// breaks. data-explorer-core 1.41.0 sends one for a Simulink.VariantBankCoderInfo's PreStatement
// and PostStatement, which MATLAB takes as any text, a line break included (C-169B, ruled
// 2026-10-18, group F).
//
// The table used to open every non-select generic cell in an <input>, and an <input> drops the
// line breaks from any value it is given. So a two-line statement opened in one, and merely
// clicked away from, was written back as one line: a change the user never made, saved
// without a word. Enter still commits, as in every other cell, and Shift+Enter starts a new line.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'preStatement', 'headerFile', 'qualifier'];

beforeEach(() => localStorage.clear());

const TWO_LINES = 'int a = 1;\nint b = 2;';

function coderInfoRow(): TreeTableRow {
  return {
    ID: 'ci',
    parent: null,
    Name: { label: 'ci' },
    Value: '',
    DataType: '',
    Description: '',
    Status: '',
    preStatement: { text: TWO_LINES, editable: true, editor: 'textArea' },
    headerFile: { text: 'h.h', editable: true, editor: 'text' },
    qualifier: { text: 'None', editable: true, editor: 'select', options: ['None', 'Const', 'Volatile', 'ConstVolatile'] },
  } as unknown as TreeTableRow;
}

async function mount(): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = [coderInfoRow()];
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

type Edit = { rowId: string; columnId: string; oldValue: string; newValue: string };

function recordEdits(table: DexTreeTable): Edit[] {
  const edits: Edit[] = [];
  table.addEventListener('dex-edit-completed', (e) => edits.push((e as CustomEvent).detail));
  return edits;
}

async function open(table: DexTreeTable, columnId: string): Promise<HTMLInputElement | HTMLTextAreaElement> {
  const td = table.shadowRoot!.querySelector(`tr[data-row-id="ci"] td.col-${columnId}`) as HTMLElement;
  td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await table.updateComplete;
  return table.shadowRoot!.querySelector('.edit-input') as HTMLInputElement | HTMLTextAreaElement;
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

describe("a textArea cell (a coder info's Pre or Post Statement)", () => {
  it('opens a textarea seeded with the text, line breaks and all', async () => {
    const table = await mount();
    const editor = await open(table, 'preStatement');
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.value).toBe(TWO_LINES);
    expect((table as any)._editingCell).toMatchObject({ rowId: 'ci', columnId: 'preStatement', editor: 'textArea' });
    table.remove();
  });

  it('clicking away without typing writes nothing', async () => {
    const table = await mount();
    const edits = recordEdits(table);
    const editor = await open(table, 'preStatement');
    editor.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).toBeNull();
    table.remove();
  });

  it('Enter commits the text with its line breaks', async () => {
    const table = await mount();
    const edits = recordEdits(table);
    const editor = await open(table, 'preStatement');
    editor.value = `${TWO_LINES}\nint c = 3;`;
    const enter = key('Enter');
    editor.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(edits).toEqual([
      { rowId: 'ci', columnId: 'preStatement', oldValue: TWO_LINES, newValue: `${TWO_LINES}\nint c = 3;` },
    ]);
    table.remove();
  });

  it('Shift+Enter is left to the textarea, to start a new line, and commits nothing', async () => {
    const table = await mount();
    const edits = recordEdits(table);
    const editor = await open(table, 'preStatement');
    const shiftEnter = key('Enter', { shiftKey: true });
    editor.dispatchEvent(shiftEnter);
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).not.toBeNull();
    table.remove();
  });

  it('Escape discards what was typed', async () => {
    const table = await mount();
    const edits = recordEdits(table);
    const editor = await open(table, 'preStatement');
    editor.value = 'changed';
    editor.dispatchEvent(key('Escape'));
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).toBeNull();
    table.remove();
  });
});

describe('the other editors of a coder info row are unchanged', () => {
  it('a text cell (Header File) still opens an input', async () => {
    const table = await mount();
    const editor = await open(table, 'headerFile');
    expect(editor.tagName).toBe('INPUT');
    expect(editor.value).toBe('h.h');
    table.remove();
  });

  it("a select cell (Qualifier) still opens a dropdown of the host's options", async () => {
    const table = await mount();
    const editor = await open(table, 'qualifier');
    expect(editor.tagName).toBe('SELECT');
    const options = Array.from(editor.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['None', 'Const', 'Volatile', 'ConstVolatile']);
    table.remove();
  });
});
