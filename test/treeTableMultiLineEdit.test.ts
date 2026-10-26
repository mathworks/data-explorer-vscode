// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A cell's editor writes exactly what the user sees, and an editor the user only opened writes
// nothing at all, whichever editor it is.
//
// Every editor of the table used to be an <input> but the coder info's two statements, and an
// <input> drops the line breaks from the value it is given. So a Description of two lines (one
// is in MATLAB's own variantbank_r2027a dictionaries) opened in it and clicked away from, or
// committed with Enter, was written back as one line: a change the user never made. Now a text
// holding a line break, and every Description, is edited in a textarea, which keeps them; and as
// a textarea reads every line break back as LF, its commit writes the breaks the cell held
// (lineBreaks.ts). A <select> whose value is not in its list opened on its first option, and a
// click away wrote that over the value.
//
// happy-dom keeps a textarea's CRLF as given, where a browser reads it back as LF; `asBrowserReads`
// does to the editor what the browser would, so the tests see what a user's commit sees.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { hasLineBreak, withHeldLineBreaks } from '../src/webview/components/lineBreaks.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'Status', 'Description', 'headerFile', 'storageClass', 'preStatement'];

beforeEach(() => localStorage.clear());

const LF = "two\nlines, it's";
const CRLF = 'first line\r\nsecond line\r\nthird';

function row(id: string, extra: Partial<TreeTableRow> = {}): TreeTableRow {
  return {
    ID: id,
    parent: null,
    Name: { label: id, editable: true },
    Value: { text: '[1 2 3]', editable: true },
    DataType: '',
    Status: '',
    Description: '',
    _descriptionEditable: true,
    headerFile: { text: 'h.h', editable: true, editor: 'text' },
    storageClass: { text: 'Auto', editable: true, editor: 'select', options: ['Auto', 'ExportedGlobal'] },
    preStatement: { text: 'int a;\nint b;', editable: true, editor: 'textArea' },
    ...extra,
  } as unknown as TreeTableRow;
}

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
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

type Editor = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

async function open(table: DexTreeTable, rowId: string, columnId: string): Promise<Editor> {
  const td = table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] td.col-${columnId}`) as HTMLElement;
  td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await table.updateComplete;
  const editor = table.shadowRoot!.querySelector('.edit-input') as Editor;
  expect(editor, `${columnId} opens an editor`).toBeTruthy();
  return editor;
}

/** The editor's text as a browser reads a textarea back: every CRLF and lone CR as LF. */
function asBrowserReads(editor: Editor): void {
  if (editor.tagName === 'TEXTAREA') editor.value = editor.value.replace(/\r\n?/g, '\n');
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

// The three ways a commit is made: Enter, and the blur that Tab or a click elsewhere causes.
const COMMITS: [string, (editor: Editor) => void][] = [
  ['Enter', (editor) => editor.dispatchEvent(key('Enter'))],
  ['a blur (Tab, a click away)', (editor) => editor.dispatchEvent(new Event('blur', { bubbles: true }))],
];

describe('an editor the user only opened writes nothing', () => {
  // Every editor kind the table has, each on text that tempts it to change something.
  const CASES: [string, string, Partial<TreeTableRow>][] = [
    ['a one-line Value (input)', 'Value', {}],
    ['a Name (input)', 'Name', {}],
    ['a text column (input)', 'headerFile', {}],
    ['a Description of two LF lines (textarea)', 'Description', { Description: LF }],
    ['a Description of CRLF lines (textarea)', 'Description', { Description: CRLF }],
    ['a Description of one line (textarea)', 'Description', { Description: 'one line' }],
    ['a textArea column (textarea)', 'preStatement', {}],
    ['a select on one of its options', 'storageClass', {}],
    [
      'a select on a value its list does not have',
      'storageClass',
      { storageClass: { text: 'Custom', editable: true, editor: 'select', options: ['Auto', 'ExportedGlobal'] } } as any,
    ],
  ];

  for (const [what, columnId, extra] of CASES) {
    for (const [how, commit] of COMMITS) {
      it(`${what}, committed by ${how}`, async () => {
        const table = await mount([row('r', extra)]);
        const edits = recordEdits(table);
        const editor = await open(table, 'r', columnId);
        asBrowserReads(editor);
        commit(editor);
        expect(edits).toEqual([]);
        expect((table as any)._editingCell).toBeNull();
        table.remove();
      });
    }
  }
});

describe('a text holding a line break is edited in a textarea that keeps every one', () => {
  it('a Description of two lines opens a textarea seeded with both', async () => {
    const table = await mount([row('r', { Description: LF })]);
    const editor = await open(table, 'r', 'Description');
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.value).toBe(LF);
    table.remove();
  });

  it('so does any other cell whose text holds one', async () => {
    const table = await mount([row('r', { Value: { text: 'a\nb', editable: true }, headerFile: { text: 'x\r\ny', editable: true } } as any)]);
    const value = await open(table, 'r', 'Value');
    expect(value.tagName).toBe('TEXTAREA');
    value.dispatchEvent(key('Escape'));
    await table.updateComplete;
    expect((await open(table, 'r', 'headerFile')).tagName).toBe('TEXTAREA');
    table.remove();
  });

  it('a one-line Value still opens an input', async () => {
    const table = await mount([row('r')]);
    expect((await open(table, 'r', 'Value')).tagName).toBe('INPUT');
    table.remove();
  });

  it('an edit of an LF text posts the typed text, line breaks and all', async () => {
    const table = await mount([row('r', { Description: LF })]);
    const edits = recordEdits(table);
    const editor = await open(table, 'r', 'Description');
    editor.value = "two\nlines, it's\nand a third";
    editor.dispatchEvent(key('Enter'));
    expect(edits).toEqual([{ rowId: 'r', columnId: 'Description', oldValue: LF, newValue: "two\nlines, it's\nand a third" }]);
    table.remove();
  });

  it('an edit of a CRLF text posts its line breaks as CRLF, as the cell held them', async () => {
    const table = await mount([row('r', { Description: CRLF })]);
    const edits = recordEdits(table);
    const editor = await open(table, 'r', 'Description');
    asBrowserReads(editor);
    editor.value = editor.value.replace('third', 'third, edited');
    editor.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(edits).toEqual([
      { rowId: 'r', columnId: 'Description', oldValue: CRLF, newValue: 'first line\r\nsecond line\r\nthird, edited' },
    ]);
    table.remove();
  });
});

describe('the keys of a textarea', () => {
  it('Shift+Enter is left to the textarea, to start a new line, and commits nothing', async () => {
    const table = await mount([row('r', { Description: 'one line' })]);
    const edits = recordEdits(table);
    const editor = await open(table, 'r', 'Description');
    const shiftEnter = key('Enter', { shiftKey: true });
    editor.dispatchEvent(shiftEnter);
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).not.toBeNull();
    table.remove();
  });

  it('so a one-line Description takes a second line, and Enter commits both', async () => {
    const table = await mount([row('r', { Description: 'one line' })]);
    const edits = recordEdits(table);
    const editor = await open(table, 'r', 'Description');
    expect(editor.tagName).toBe('TEXTAREA');
    editor.value = 'one line\nand another';
    const enter = key('Enter');
    editor.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(edits).toEqual([{ rowId: 'r', columnId: 'Description', oldValue: 'one line', newValue: 'one line\nand another' }]);
    table.remove();
  });

  it('Escape discards what was typed', async () => {
    const table = await mount([row('r', { Description: LF })]);
    const edits = recordEdits(table);
    const editor = await open(table, 'r', 'Description');
    editor.value = 'changed';
    editor.dispatchEvent(key('Escape'));
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).toBeNull();
    table.remove();
  });

  it('an Enter that confirms an IME candidate is not a commit', async () => {
    const table = await mount([row('r', { Description: 'one line' })]);
    const edits = recordEdits(table);
    const editor = await open(table, 'r', 'Description');
    editor.value = 'one line, 日本';
    const composing = key('Enter', { isComposing: true });
    editor.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).not.toBeNull();
    editor.dispatchEvent(key('Enter'));
    expect(edits).toEqual([{ rowId: 'r', columnId: 'Description', oldValue: 'one line', newValue: 'one line, 日本' }]);
    table.remove();
  });
});

describe('a select whose value its list does not have', () => {
  it('opens on that value, and choosing an option commits it', async () => {
    const table = await mount([
      row('r', { storageClass: { text: 'Custom', editable: true, editor: 'select', options: ['Auto', 'ExportedGlobal'] } } as any),
    ]);
    const edits = recordEdits(table);
    const select = (await open(table, 'r', 'storageClass')) as HTMLSelectElement;
    expect(select.value).toBe('Custom');
    select.value = 'ExportedGlobal';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(edits).toEqual([{ rowId: 'r', columnId: 'storageClass', oldValue: 'Custom', newValue: 'ExportedGlobal' }]);
    table.remove();
  });
});

describe('withHeldLineBreaks', () => {
  it('answers the held text where only the spelling of its line breaks differs', () => {
    expect(withHeldLineBreaks('a\nb\nc', 'a\r\nb\rc')).toBe('a\r\nb\rc');
    expect(withHeldLineBreaks('same', 'same')).toBe('same');
  });

  it("spells each line break of an edited text as the held text's at the same place", () => {
    expect(withHeldLineBreaks('a\nb!\nc', 'a\r\nb\rc')).toBe('a\r\nb!\rc');
  });

  it('spells line breaks past the last held one as that one, and as LF where none was held', () => {
    expect(withHeldLineBreaks('a\nb\nc\nd', 'a\r\nb')).toBe('a\r\nb\r\nc\r\nd');
    expect(withHeldLineBreaks('a\nb', 'ab')).toBe('a\nb');
    expect(withHeldLineBreaks('a\r\nb', 'ab')).toBe('a\nb');
  });

  it('an edit that removes every line break leaves none', () => {
    expect(withHeldLineBreaks('ab', 'a\r\nb')).toBe('ab');
  });

  it('hasLineBreak sees LF, CRLF and a lone CR', () => {
    expect([hasLineBreak('a\nb'), hasLineBreak('a\r\nb'), hasLineBreak('a\rb'), hasLineBreak('ab')]).toEqual([true, true, true, false]);
  });
});
