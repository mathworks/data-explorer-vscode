// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Ruling V-019, driven through the webview entry point: a selection that spans two sections
// sends no paste, from the menu or from Cmd+V.
//
// The two triggers anchor differently: the menu at the right-clicked row, the keyboard at the
// first selected row (table-main.ts). Before the ruling a selected section header did not
// count as a section, so with [Design header, Architectural header] selected the menu pasted
// into Architectural Data and Cmd+V into Design Data, from one selection. menuItems.test.ts
// pins the builder; this pins the shipped listeners that read it, so it imports table-main
// rather than copying them (see tableMainChildRows.test.ts for the pattern).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESIGN = 'section:design';
const ARCH = 'section:arch';

const posted: any[] = [];
let table: any;
let contextMenu: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const pastes = () => posted.filter((m) => m.type === 'paste');

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
  contextMenu = document.querySelector('dex-context-menu');
});

beforeEach(async () => {
  // Two sections with one entry each, the rules for both, and a clipboard both accept
  // (allowedTypes [] restricts nothing), so a paste refused below is refused for the
  // one-section rule and nothing else.
  send({
    type: 'setRows',
    docUri: 'file:///fx/d.sldd',
    rows: [
      { ID: DESIGN, parent: null, Name: { label: 'Design Data' } },
      { ID: 'doc/design/A', parent: DESIGN, Name: { label: 'A' }, _canCopy: true, _canDelete: true },
      { ID: ARCH, parent: null, Name: { label: 'Architectural Data' } },
      { ID: 'doc/arch/V', parent: ARCH, Name: { label: 'V' }, _canCopy: true, _canDelete: true },
    ],
    columns: ['Name', 'Value'],
    columnLabels: { Name: 'Name', Value: 'Value' },
    editable: true,
  });
  send({
    type: 'sectionRules',
    docUri: 'file:///fx/d.sldd',
    rules: [
      { sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] },
      { sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, allowedTypes: [] },
    ],
  });
  send({
    type: 'clipboardState',
    canPaste: true,
    mode: 'copy',
    items: [{ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false }],
  });
  await table.updateComplete;
  posted.length = 0;
});

afterEach(() => {
  // show() wires document-level listeners; close() removes them before the next case.
  contextMenu.close();
});

/** Cmd+V on the table with `selection` selected, as the user presses it. */
async function pressPaste(selection: string[]): Promise<void> {
  table.selectedRowIds = selection;
  await table.updateComplete;
  table.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true, composed: true }));
}

/** Right-click `rowId` with `selection` selected, then click the menu's Paste item. */
async function rightClickPaste(selection: string[], rowId: string): Promise<HTMLElement> {
  table.selectedRowIds = selection;
  await table.updateComplete;
  table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId, x: 10, y: 10 } }));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await contextMenu.updateComplete;
  const item = [...contextMenu.shadowRoot.querySelectorAll('.item')].find(
    (el: any) => el.querySelector('.item-label')?.textContent === 'Paste',
  ) as HTMLElement;
  item.click();
  return item;
}

describe('a selection over two sections pastes nowhere', () => {
  it('Cmd+V with two headers selected sends no paste', async () => {
    await pressPaste([DESIGN, ARCH]);
    expect(pastes()).toEqual([]);
  });

  it('the menu on either header offers a disabled Paste that sends nothing', async () => {
    for (const rowId of [DESIGN, ARCH]) {
      const item = await rightClickPaste([DESIGN, ARCH], rowId);
      expect(item.getAttribute('aria-disabled'), `right-clicked ${rowId}`).toBe('true');
      expect(item.getAttribute('title'), `right-clicked ${rowId}`).toBe('Select rows in one section to paste');
      contextMenu.close();
    }
    expect(pastes()).toEqual([]);
  });

  it('Cmd+V with a header and another section’s row selected sends no paste', async () => {
    await pressPaste([DESIGN, 'doc/arch/V']);
    expect(pastes()).toEqual([]);
  });
});

describe('a selection in one section still pastes there', () => {
  it('Cmd+V on a lone header pastes into that section', async () => {
    await pressPaste([ARCH]);
    expect(pastes()).toEqual([{ type: 'paste', rowId: ARCH }]);
  });

  it('the menu on a header selected with its own rows pastes into that section', async () => {
    const item = await rightClickPaste([DESIGN, 'doc/design/A'], DESIGN);
    expect(item.getAttribute('aria-disabled')).toBe('false');
    expect(pastes()).toEqual([{ type: 'paste', rowId: DESIGN }]);
  });
});
