// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The table's Description editor on the rows the hosts really post, read from Descriptions
// MATLAB itself wrote with line breaks (test-integration/fixtures/multiline): the same three
// Simulink.Parameter objects in a MAT-file, a text dictionary and a binary one. Opening one and
// committing it unchanged posts nothing, and an edit posts exactly the text the user sees, every
// line break as the file held it. Before, the editor was an <input>, which dropped the line breaks
// of the text it was seeded with, so a commit wrote the Description back as one line. The host's
// half (that edit message, written into each file and read back) is
// test-integration/suite/multiLineDescription.test.ts.
//
// happy-dom keeps a textarea's CRLF as given, where a browser reads it back as LF; `asBrowserReads`
// does to the editor what the browser would.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel, parseBinarySldd } from 'data-explorer-core';
import { buildRows } from '../src/host/rowBuilder.js';
import { buildMatRows } from '../src/host/matRowBuilder.js';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// import.meta.dirname, not a URL against import.meta.url: under happy-dom that resolves against
// the page's location.
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'multiline', name)));
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const LF = "two\nlines, it's";
const CRLF = 'first line\r\nsecond line';

// What MATLAB wrote, as core reads it. A text dictionary MATLAB saves writes a CRLF as LF.
const FORMATS: { name: string; rows: (srcId: string) => any[]; crlf: string }[] = [
  { name: 'MAT-file', rows: (srcId) => buildMatRows(DataModel.addMatSource(srcId, buffer(fixture('multiline_r2027a.mat')), { path: 'multiline.mat' })), crlf: CRLF },
  {
    name: 'text dictionary',
    rows: (srcId) =>
      buildRows(DataModel.addDataSource(srcId, JSON.parse(new TextDecoder().decode(fixture('multiline_r2027a_text.sldd'))), { path: 'multiline.sldd' })),
    crlf: 'first line\nsecond line',
  },
  {
    name: 'binary dictionary',
    rows: (srcId) => buildRows(DataModel.addDataSource(srcId, parseBinarySldd(buffer(fixture('multiline_r2027a_binary.sldd'))), { path: 'multiline.sldd' })),
    crlf: CRLF,
  },
];

let srcId = '';
let table: DexTreeTable;

beforeEach(() => {
  localStorage.clear();
  srcId = `multiline:${Math.random()}.sldd`;
});

afterEach(() => {
  table?.remove();
  DataModel.removeDataSource(srcId);
});

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType', 'Description'];
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  // A dictionary's entries are rows under its section rows, drawn once their section is open.
  (table as any)._expandedIds = new Set(rows.map((r: any) => r.parent).filter(Boolean));
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

type Edit = { rowId: string; columnId: string; oldValue: string; newValue: string };

function recordEdits(t: DexTreeTable): Edit[] {
  const edits: Edit[] = [];
  t.addEventListener('dex-edit-completed', (e) => edits.push((e as CustomEvent).detail));
  return edits;
}

const rowNamed = (rows: any[], name: string): any => {
  const row = rows.find((r) => r.Name?.label === name);
  expect(row, `a row for ${name}`).toBeTruthy();
  return row;
};

async function openDescription(t: DexTreeTable, row: any): Promise<HTMLTextAreaElement> {
  const td = t.shadowRoot!.querySelector(`tr[data-row-id="${CSS.escape(row.ID)}"] td.col-Description`) as HTMLElement;
  td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await t.updateComplete;
  return t.shadowRoot!.querySelector('.edit-input') as HTMLTextAreaElement;
}

const asBrowserReads = (editor: HTMLTextAreaElement): void => {
  editor.value = editor.value.replace(/\r\n?/g, '\n');
};

for (const format of FORMATS) {
  describe(`a multi-line Description in a ${format.name}, as MATLAB wrote it`, () => {
    it('is what the row holds', () => {
      const rows = format.rows(srcId);
      expect(rowNamed(rows, 'pLF').Description).toBe(LF);
      expect(rowNamed(rows, 'pCRLF').Description).toBe(format.crlf);
      expect(rowNamed(rows, 'pOne').Description).toBe('one line');
    });

    for (const [name, how] of [
      ['pLF', 'Enter'],
      ['pLF', 'blur'],
      ['pCRLF', 'Enter'],
      ['pCRLF', 'blur'],
      ['pOne', 'blur'],
    ] as const) {
      it(`${name}: opened and committed unchanged (${how}) posts nothing`, async () => {
        const rows = format.rows(srcId);
        const t = await mount(rows);
        const edits = recordEdits(t);
        const editor = await openDescription(t, rowNamed(rows, name));
        expect(editor.tagName).toBe('TEXTAREA');
        expect(editor.value).toBe(rowNamed(rows, name).Description);
        asBrowserReads(editor);
        if (how === 'Enter') editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        else editor.dispatchEvent(new Event('blur', { bubbles: true }));
        expect(edits).toEqual([]);
      });
    }

    it('pLF: an added line is posted with every line break', async () => {
      const rows = format.rows(srcId);
      const t = await mount(rows);
      const edits = recordEdits(t);
      const row = rowNamed(rows, 'pLF');
      const editor = await openDescription(t, row);
      editor.value = `${editor.value}\nand a third`;
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(edits).toEqual([{ rowId: row.ID, columnId: 'Description', oldValue: LF, newValue: `${LF}\nand a third` }]);
    });

    it("pCRLF: an edited line is posted with the file's own line break", async () => {
      const rows = format.rows(srcId);
      const t = await mount(rows);
      const edits = recordEdits(t);
      const row = rowNamed(rows, 'pCRLF');
      const editor = await openDescription(t, row);
      asBrowserReads(editor);
      editor.value = editor.value.replace('second line', 'second line, edited');
      editor.dispatchEvent(new Event('blur', { bubbles: true }));
      expect(edits).toEqual([
        { rowId: row.ID, columnId: 'Description', oldValue: format.crlf, newValue: format.crlf.replace('second line', 'second line, edited') },
      ]);
    });
  });
}
