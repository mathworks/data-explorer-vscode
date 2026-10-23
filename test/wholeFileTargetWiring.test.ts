// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A section-less table as ONE paste/drop target (design D2), through the webview entry point
// as it ships (table-main.ts), the way pasteOneSectionWiring.test.ts drives a dictionary's.
//
// A MAT-file's table has no section header rows: its variables are top-level rows. Its host
// posts one rule, for section '' (sectionRules.wholeFileRules), and that rule is what every
// row with no section ancestor — and no row at all — resolves to. So a paste on a variable, a
// paste on the empty body, Cmd+V with nothing selected and a drop on an empty file all land in
// the file. A dictionary posts no '' rule, so none of that reaches it: its empty space stays
// inert, exactly as before. And today's MAT host, which still sends `clipboard: false` and no
// rules, sees none of it either (matTableWiring.test.ts pins that half).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAT = 'file:///fx/gains.mat';
const SLDD = 'file:///fx/d.sldd';

const posted: any[] = [];
let table: any;
let contextMenu: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const sent = (type: string) => posted.filter((m) => m.type === type);

const PARAM = { className: 'Simulink.Parameter', arrayClass: 'Simulink.Parameter', kind: 'Parameter', isMatlabVariable: false, isScalarNumeric: false };
const BUS = { className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false };

const matRows = () => [
  { ID: 'm/x', parent: null, Name: { label: 'x' }, _canCopy: true, _canDelete: true },
  { ID: 'm/cfg', parent: null, Name: { label: 'cfg' }, _canCopy: true, _canDelete: true },
  { ID: 'm/cfg/gain', parent: 'm/cfg', Name: { label: 'gain' }, _canCopy: true, _canDelete: true },
];

/** A MAT-file payload as its host will send it once it offers the clipboard. */
function paintMat(rows: any[] = matRows()): void {
  send({ type: 'setRows', docUri: MAT, rows, columns: ['Name'], columnLabels: { Name: 'Name' }, editable: true });
  send({
    type: 'sectionRules',
    docUri: MAT,
    rules: [{ sectionName: '', sectionLabel: 'gains.mat', isDerived: false, allowedTypes: ['MatlabVariable', 'Simulink.Parameter'] }],
  });
}

function paintDictionary(): void {
  send({
    type: 'setRows',
    docUri: SLDD,
    rows: [
      { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
      { ID: 'd/design/A', parent: 'section:design', Name: { label: 'A' }, _canCopy: true, _canDelete: true },
    ],
    columns: ['Name'],
    columnLabels: { Name: 'Name' },
    editable: true,
  });
  send({ type: 'sectionRules', docUri: SLDD, rules: [{ sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] }] });
}

const holding = (...items: any[]) => send({ type: 'clipboardState', canPaste: true, mode: 'copy', items });

// Its own timeout: a cold import of the whole table-main webview is what a loaded machine stretches.
beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
  contextMenu = document.querySelector('dex-context-menu');
}, 60_000);

beforeEach(async () => {
  paintMat();
  holding(PARAM);
  table.selectedRowIds = [];
  await table.updateComplete;
  posted.length = 0;
});

afterEach(() => contextMenu.close());

async function openMenu(rowId: string | null): Promise<any[]> {
  table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId, x: 10, y: 10 } }));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await contextMenu.updateComplete;
  return contextMenu._open ? contextMenu._items : [];
}

function clickItem(label: string): HTMLElement {
  const item = [...contextMenu.shadowRoot.querySelectorAll('.item')].find(
    (el: any) => el.querySelector('.item-label')?.textContent === label,
  ) as HTMLElement;
  item.click();
  return item;
}

const pressPaste = () =>
  table.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true, composed: true }));

describe('every row of a section-less table pastes into the file', () => {
  it('a variable, and a field deep under one, both offer Paste', async () => {
    for (const rowId of ['m/x', 'm/cfg/gain']) {
      table.selectedRowIds = [rowId];
      const paste = (await openMenu(rowId)).find((i) => i.id === 'paste');
      expect(paste?.disabled, rowId).toBeFalsy();
      contextMenu.close();
    }
  });

  it('a selection over several variables is one target, not several', async () => {
    table.selectedRowIds = ['m/x', 'm/cfg/gain'];
    const paste = (await openMenu('m/x')).find((i) => i.id === 'paste');
    expect(paste?.disabled).toBeFalsy();
  });

  it("refuses what the file's rule does not admit, naming the file", async () => {
    holding(BUS);
    table.selectedRowIds = ['m/x'];
    const paste = (await openMenu('m/x')).find((i) => i.id === 'paste');
    expect(paste).toMatchObject({ disabled: true, reason: 'Bus cannot be in gains.mat' });
  });
});

describe('the empty body is the file too', () => {
  it('a right-click there offers Paste and Undo/Redo, whatever is selected, and pastes with no row', async () => {
    table.selectedRowIds = ['m/x'];
    await table.updateComplete;
    const items = await openMenu(null);
    expect(items.filter((i) => !i.separator).map((i) => i.id)).toEqual(['paste', 'undo', 'redo']);
    clickItem('Paste');
    expect(sent('paste')).toEqual([{ type: 'paste', rowId: '' }]);
  });

  it('on an EMPTY file, Paste is offered and Cmd+V with nothing selected pastes', async () => {
    paintMat([]);
    await table.updateComplete;
    expect((await openMenu(null)).find((i) => i.id === 'paste')?.disabled).toBeFalsy();
    contextMenu.close();
    pressPaste();
    expect(sent('paste')).toEqual([{ type: 'paste', rowId: '' }]);
  });

  it('Cmd+V with nothing selected pastes into a file that has rows, too', () => {
    pressPaste();
    expect(sent('paste')).toEqual([{ type: 'paste', rowId: '' }]);
  });

  it('with nothing on the clipboard the body offers a disabled Paste and sends nothing', async () => {
    send({ type: 'clipboardState', canPaste: false, mode: null, items: [] });
    expect((await openMenu(null)).find((i) => i.id === 'paste')).toMatchObject({ disabled: true, reason: 'Nothing to paste' });
    pressPaste();
    expect(sent('paste')).toEqual([]);
  });
});

describe('a drag onto a section-less table predicts against the file', () => {
  const fire = (el: Element, type: string) => {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
    Object.assign(ev, { dataTransfer: { dropEffect: '', effectAllowed: '', setData() {}, getData: () => '', setDragImage() {} }, altKey: false, ctrlKey: false, clientX: 0, clientY: 0 });
    el.dispatchEvent(ev);
    return ev;
  };
  const dragging = (items: any[], docUri = SLDD) => send({ type: 'dragState', descriptor: { docUri, items } });
  afterEach(() => send({ type: 'dragState', descriptor: null }));

  it("a dictionary entry dragged over a variable may land; one the file refuses may not", async () => {
    await table.updateComplete;
    const row = table.shadowRoot.querySelector('tr[data-row-id="m/x"]');
    dragging([{ ...PARAM, sectionName: 'design' }]);
    expect(fire(row, 'dragover').defaultPrevented).toBe(true);
    dragging([{ ...BUS, sectionName: 'design' }]);
    expect(fire(row, 'dragover').defaultPrevented).toBe(false);
  });

  it("moving a variable within its own file is the same-section no-op", async () => {
    await table.updateComplete;
    dragging([{ ...PARAM, sectionName: '' }], MAT);
    const row = table.shadowRoot.querySelector('tr[data-row-id="m/cfg"]');
    expect(fire(row, 'dragover').defaultPrevented).toBe(false);
  });

  it('an EMPTY file takes a drop on its body, with no row', async () => {
    paintMat([]);
    table.loading = false;
    await table.updateComplete;
    dragging([{ ...PARAM, sectionName: 'design' }]);
    const body = table.shadowRoot.querySelector('.empty-state');
    expect(fire(body, 'dragover').defaultPrevented).toBe(true);
    fire(body, 'drop');
    expect(sent('drop')).toEqual([{ type: 'drop', rowId: '', mode: 'move' }]);
  });
});

describe("a table whose rows do not travel has no row-less target, even with a '' rule", () => {
  // Today's MAT host sends `clipboard: false`; one that also posted its rule must still offer
  // nothing on the empty body — the rule is about where a paste or a drop lands.
  beforeEach(async () => {
    send({ type: 'setRows', docUri: MAT, rows: matRows(), columns: ['Name'], columnLabels: { Name: 'Name' }, editable: true, clipboard: false });
    send({ type: 'sectionRules', docUri: MAT, rules: [{ sectionName: '', sectionLabel: 'gains.mat', isDerived: false, allowedTypes: [] }] });
    await table.updateComplete;
    posted.length = 0;
  });

  it('opens no menu on the empty body and pastes nothing on Cmd+V', async () => {
    expect(await openMenu(null)).toEqual([]);
    pressPaste();
    expect(sent('paste')).toEqual([]);
  });
});

describe("a dictionary's table is unchanged: no '' rule, no row-less target", () => {
  beforeEach(async () => {
    paintDictionary();
    await table.updateComplete;
    posted.length = 0;
  });

  it('a right-click on its empty space opens no menu', async () => {
    expect(await openMenu(null)).toEqual([]);
  });

  it('Cmd+V with nothing selected sends nothing', () => {
    pressPaste();
    expect(sent('paste')).toEqual([]);
  });

  it('a drag over its empty space is refused', async () => {
    send({ type: 'dragState', descriptor: { docUri: MAT, items: [{ ...PARAM, sectionName: '' }] } });
    const ev = new Event('dragover', { bubbles: true, cancelable: true }) as any;
    Object.assign(ev, { dataTransfer: { dropEffect: '' }, altKey: false, ctrlKey: false, clientX: 0, clientY: 0 });
    table.shadowRoot.querySelector('.table-container').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    send({ type: 'dragState', descriptor: null });
  });
});
