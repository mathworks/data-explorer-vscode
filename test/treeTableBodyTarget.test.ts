// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The table's empty body as a target. A MAT-file is ONE paste/drop target (design D2): its
// host posts a single rule for the whole file, so a paste or a drop needs no row to anchor it
// — and an EMPTY MAT-file has no row to offer. So the component reports a right-click, a
// dragover and a drop on space that holds no row, with no row (`null` for the menu, '' for a
// drop, the spelling the predictor and the protocol take), and leaves the deciding to the
// glue (table-main), which only says yes for a document that posted a whole-file rule. A
// dictionary's glue says no, so its empty space stays as inert as it always was.
//
// happy-dom has no drag implementation, so drags are DragEvent-shaped events with a stub
// dataTransfer, as in treeTableDragDrop.test.ts.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

function makeRow(id: string, parent: string | null, name = id): TreeTableRow {
  return { ID: id, parent, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '' };
}

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType', 'Status'];
  document.body.appendChild(table);
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

function stubTransfer() {
  return { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '', setDragImage: () => {} };
}

function drag(el: Element, type: string) {
  const dt = stubTransfer();
  const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
  Object.assign(ev, { dataTransfer: dt, altKey: false, ctrlKey: false, clientX: 5, clientY: 6 });
  el.dispatchEvent(ev);
  return { ev, dt };
}

const ROWS = [makeRow('m/x', null, 'x'), makeRow('m/y', null, 'y')];
const container = (t: DexTreeTable) => (t as any)._container as HTMLElement;
const emptyState = (t: DexTreeTable) => t.shadowRoot!.querySelector('.empty-state') as HTMLElement;
const rowEl = (t: DexTreeTable, id: string) => t.shadowRoot!.querySelector(`tr[data-row-id="${id}"]`) as HTMLElement;

function recordMenus(t: DexTreeTable): any[] {
  const menus: any[] = [];
  t.addEventListener('dex-table-context-menu', (e) => menus.push((e as CustomEvent).detail));
  return menus;
}

describe('a right-click on no row', () => {
  it('on the blank space under the rows asks for a menu, with no row', async () => {
    const table = await mount(ROWS);
    const menus = recordMenus(table);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 90 });
    container(table).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(menus).toEqual([{ x: 40, y: 90, rowId: null }]);
    table.remove();
  });

  it('on a row asks once, for that row — the body does not answer it again', async () => {
    const table = await mount(ROWS);
    const menus = recordMenus(table);
    rowEl(table, 'm/x').querySelector('td')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menus.map((m) => m.rowId)).toEqual(['m/x']);
    table.remove();
  });

  it('on an EMPTY table — "No data" — asks for a menu too, and suppresses the browser one', async () => {
    const table = await mount([]);
    table.loading = false;
    await table.updateComplete;
    const menus = recordMenus(table);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 3, clientY: 4 });
    emptyState(table).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(menus).toEqual([{ x: 3, y: 4, rowId: null }]);
    table.remove();
  });

  it('an empty table can take focus, so a key pressed there reaches the table', async () => {
    // Cmd+V on an empty MAT-file pastes into it; with nothing focusable in the table the
    // keystroke would land on <body> and never reach the table's listeners. -1 keeps it out
    // of the tab order: a click focuses it, Tab does not stop on "No data".
    const table = await mount([]);
    table.loading = false;
    await table.updateComplete;
    expect(emptyState(table).getAttribute('tabindex')).toBe('-1');
    table.remove();
  });
});

describe('a drag over no row', () => {
  it('asks the predictor about the body (\'\') and accepts the drop it allows', async () => {
    const table = await mount(ROWS);
    const asked: string[] = [];
    table.dropPredictor = (rowId: string) => {
      asked.push(rowId);
      return { canDrop: true, cursor: 'copy', tooltip: 'Copy Simulink Parameter', noop: false };
    };
    const { ev, dt } = drag(container(table), 'dragover');
    await table.updateComplete;
    expect(asked).toEqual(['']);
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('copy');
    expect(table.shadowRoot!.querySelector('.drop-tooltip')!.textContent).toContain('Copy Simulink Parameter');
    table.remove();
  });

  it('a drop there reports no row, in the mode the dragover saw', async () => {
    const table = await mount([]);
    table.loading = false;
    await table.updateComplete;
    table.dropPredictor = () => ({ canDrop: true, cursor: 'move', tooltip: 'Move', noop: false });
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));
    drag(emptyState(table), 'dragover');
    const { ev } = drag(emptyState(table), 'drop');
    expect(ev.defaultPrevented).toBe(true);
    expect(drops).toEqual([{ targetRowId: '', mode: 'move' }]);
    table.remove();
  });

  it('refuses where the predictor has no answer, which is every dictionary', async () => {
    const table = await mount(ROWS);
    table.dropPredictor = () => null;
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));
    const { ev, dt } = drag(container(table), 'dragover');
    expect(ev.defaultPrevented).toBe(false);
    expect(dt.dropEffect).toBe('none');
    drag(container(table), 'drop');
    expect(drops).toEqual([]);
    table.remove();
  });

  it('refuses a drop the predictor forbids, and says why', async () => {
    const table = await mount(ROWS);
    table.dropPredictor = () => ({ canDrop: false, cursor: 'no-drop', tooltip: 'Simulink Bus cannot be in d.mat', noop: false });
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));
    const { ev } = drag(container(table), 'dragover');
    await table.updateComplete;
    expect(ev.defaultPrevented).toBe(false);
    expect(table.shadowRoot!.querySelector('.drop-tooltip')!.className).toContain('forbidden');
    drag(container(table), 'drop');
    expect(drops).toEqual([]);
    table.remove();
  });

  it('without a predictor the body is no target at all', async () => {
    // The permissive fallback a ROW keeps for a table with no host glue has nothing to
    // stand on here: there is no row to report.
    const table = await mount(ROWS);
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));
    const { ev } = drag(container(table), 'dragover');
    expect(ev.defaultPrevented).toBe(false);
    drag(container(table), 'drop');
    expect(drops).toEqual([]);
    table.remove();
  });

  it('a dragover on a row is the row’s, not the body’s', async () => {
    const table = await mount(ROWS);
    const asked: string[] = [];
    table.dropPredictor = (rowId: string) => {
      asked.push(rowId);
      return { canDrop: true, cursor: 'move', tooltip: '', noop: false };
    };
    drag(rowEl(table, 'm/y'), 'dragover');
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));
    drag(rowEl(table, 'm/y'), 'drop');
    expect(asked).toEqual(['m/y', 'm/y']);
    expect(drops).toEqual([{ targetRowId: 'm/y', mode: 'move' }]);
    table.remove();
  });

  it('a table whose rows take no drag ignores the body too', async () => {
    const table = await mount(ROWS);
    table.rowDrag = false;
    await table.updateComplete;
    let asked = 0;
    table.dropPredictor = () => {
      asked++;
      return { canDrop: true, cursor: 'move', tooltip: '', noop: false };
    };
    const { ev } = drag(container(table), 'dragover');
    expect(ev.defaultPrevented).toBe(false);
    expect(asked).toBe(0);
    table.remove();
  });

  it('a column header being dragged is not a row drop on the body', async () => {
    const table = await mount(ROWS);
    let asked = 0;
    table.dropPredictor = () => {
      asked++;
      return { canDrop: true, cursor: 'move', tooltip: '', noop: false };
    };
    drag(table.shadowRoot!.querySelector('th') as HTMLElement, 'dragover');
    expect(asked).toBe(0);
    table.remove();
  });
});
