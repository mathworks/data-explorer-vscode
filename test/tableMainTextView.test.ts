// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Location in Text, through the webview entry point as it ships (table-main.ts). A JSON .sldd has a
// plain-text view a row can be revealed in, and a compressed-binary one has none; each setRows says
// which (`hasTextView`). The table's paint does not carry it, so the shell reads it off the message
// itself and hands connectTable({editing}) a text view that is available exactly then, and that
// posts `locateInText` for the row. The menu item and Cmd/Ctrl+L are the editing half's (view's);
// what this holds is the shell's wiring of them: the flag read, and the message posted.
import { describe, it, expect, beforeAll } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SLDD = 'file:///fx/d.sldd';
const ENTRY = 'd/x';
const posted: any[] = [];
let table: any;
let contextMenu: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const sent = (type: string) => posted.filter((m) => m.type === type);
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

async function paint(hasTextView: boolean): Promise<void> {
  send({
    type: 'setRows',
    docUri: SLDD,
    rows: [
      { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
      { ID: ENTRY, parent: 'section:design', Name: { label: 'x' }, Value: '1', _canCopy: true, _canDelete: true },
    ],
    columns: ['Name', 'Value'],
    columnLabels: { Name: 'Name', Value: 'Value' },
    editable: true,
    hasTextView,
  });
  await settle();
  await table.updateComplete;
  table.selectedRowIds = [ENTRY];
}

/** The labels of the menu a right-click on the entry opens. */
async function menuLabels(): Promise<string[]> {
  table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId: ENTRY, x: 1, y: 1 } }));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await contextMenu.updateComplete;
  const labels = [...contextMenu.shadowRoot.querySelectorAll('.item .item-label')].map((el: any) => el.textContent as string);
  contextMenu.close();
  return labels;
}

/** Choose the menu's Location in Text, as a click on it does. */
function chooseLocate(): void {
  table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId: ENTRY, x: 1, y: 1 } }));
  contextMenu.dispatchEvent(new CustomEvent('dex-action', { detail: { actionId: 'locateInText' } }));
}

const cmdL = () =>
  table.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));

describe('Location in Text, through the webview entry point', () => {
  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => void posted.push(JSON.parse(JSON.stringify(m))) });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
    contextMenu = document.querySelector('dex-context-menu');
  }, 60_000);

  it('a document with a text view offers the item, and the item and Cmd/Ctrl+L post locateInText for the row', async () => {
    await paint(true);
    expect(await menuLabels()).toContain('Location in Text');
    posted.length = 0;
    chooseLocate();
    expect(sent('locateInText')).toEqual([{ type: 'locateInText', rowId: ENTRY }]);
    posted.length = 0;
    cmdL();
    expect(sent('locateInText')).toEqual([{ type: 'locateInText', rowId: ENTRY }]);
  });

  it('a document with none offers no item, and Cmd/Ctrl+L posts nothing', async () => {
    await paint(false);
    expect(await menuLabels()).not.toContain('Location in Text');
    posted.length = 0;
    cmdL();
    expect(sent('locateInText')).toEqual([]);
  });

  it('follows each setRows: a text view that goes away takes the item with it, and one that comes back brings it', async () => {
    await paint(true);
    expect(await menuLabels()).toContain('Location in Text');
    await paint(false);
    expect(await menuLabels()).not.toContain('Location in Text');
    await paint(true);
    expect(await menuLabels()).toContain('Location in Text');
  });
});
