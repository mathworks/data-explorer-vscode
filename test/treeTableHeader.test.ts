// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Column header interactions: resizing by dragging the handle, reordering by
// dragging the header itself, and the Columns dropdown. These are pure UI
// preferences — nothing here touches the user's file — but they persist, so a
// mistake follows the user into every later session. The layout arithmetic is
// only partly testable here: happy-dom reports every getBoundingClientRect and
// offsetWidth as zero, so the tests that need a real measurement set the
// measured value explicitly and check the arithmetic around it. Genuine pointer
// hit-testing against painted geometry needs a real browser.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class'];

beforeEach(() => localStorage.clear());

function makeRow(id: string, name = id): TreeTableRow {
  return { ID: id, parent: null, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '' };
}

async function mount(): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  table.rows = [makeRow('a'), makeRow('b')];
  await table.updateComplete;
  return table;
}

const headers = (table: DexTreeTable): HTMLElement[] =>
  Array.from(table.shadowRoot!.querySelectorAll('th')) as HTMLElement[];

const headerFor = (table: DexTreeTable, col: string): HTMLElement => {
  const cols = (table as any)._visibleColumns as string[];
  return headers(table)[cols.indexOf(col)];
};

function stubTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (t: string, v: string) => store.set(t, v),
    getData: (t: string) => store.get(t) ?? '',
    setDragImage: () => {},
  };
}

// Dispatch a drag event on a header cell with a writable dataTransfer.
function fireHeader(table: DexTreeTable, col: string, type: string, extra: Record<string, unknown> = {}) {
  const dt = stubTransfer();
  const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
  Object.assign(ev, { dataTransfer: dt, clientX: 0, clientY: 0 }, extra);
  headerFor(table, col).dispatchEvent(ev);
  return { ev, dt };
}

describe('resizing a column', () => {
  it('dragging the handle widens the column and narrows its neighbour', async () => {
    // Widths are a zero-sum split of a fixed table width: growing one column has
    // to take the space from the next one, or the table overflows its panel.
    const table = await mount();
    const handle = headerFor(table, 'Value').querySelector('.resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200 }));

    // happy-dom measures every th as 0px wide, so the component falls back to its
    // 100px default; seed both columns explicitly to make the delta meaningful.
    (table as any)._resizeStartWidth = 150;
    (table as any)._resizeNextStartWidth = 150;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240 }));
    expect((table as any)._columnWidths.get('Value')).toBe(190);
    expect((table as any)._columnWidths.get('DataType')).toBe(110);
    document.dispatchEvent(new MouseEvent('mouseup'));
    table.remove();
  });

  it('a column cannot be dragged narrower than a readable minimum', async () => {
    // Below ~40px the header label disappears entirely and the user can no longer
    // find the handle to drag it back.
    const table = await mount();
    const handle = headerFor(table, 'Value').querySelector('.resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200 }));
    (table as any)._resizeStartWidth = 150;
    (table as any)._resizeNextStartWidth = 150;

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -5000 }));
    expect((table as any)._columnWidths.get('Value')).toBe(40);
    document.dispatchEvent(new MouseEvent('mouseup'));
    table.remove();
  });

  it('the neighbour cannot be squeezed below that minimum either', async () => {
    const table = await mount();
    const handle = headerFor(table, 'Value').querySelector('.resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200 }));
    (table as any)._resizeStartWidth = 150;
    (table as any)._resizeNextStartWidth = 150;

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000 }));
    expect((table as any)._columnWidths.get('DataType')).toBe(40);
    expect((table as any)._columnWidths.get('Value')).toBe(260);
    document.dispatchEvent(new MouseEvent('mouseup'));
    table.remove();
  });

  it('the last column has no neighbour to borrow from, so it grows freely', async () => {
    const table = await mount();
    const cols = (table as any)._visibleColumns as string[];
    const last = cols[cols.length - 1];
    const handle = headerFor(table, last).querySelector('.resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 }));
    expect((table as any)._resizeNextCol).toBeNull();
    (table as any)._resizeStartWidth = 100;

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
    expect((table as any)._columnWidths.get(last)).toBe(1000);
    document.dispatchEvent(new MouseEvent('mouseup'));
    table.remove();
  });

  it('mouse movement stops mattering once the drag ends', async () => {
    // The listeners live on the document; leaving them attached would make the
    // column keep resizing as the user moves the mouse around the panel.
    const table = await mount();
    const handle = headerFor(table, 'Value').querySelector('.resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200 }));
    (table as any)._resizeStartWidth = 150;
    (table as any)._resizeNextStartWidth = 150;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    const after = (table as any)._columnWidths.get('Value');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
    expect((table as any)._columnWidths.get('Value')).toBe(after);
    expect((table as any)._resizingCol).toBeNull();
    table.remove();
  });

  it('the mousedown does not also sort the column', async () => {
    // The handle sits inside the header cell; letting the event through would sort
    // the table every time the user grabbed a divider.
    const table = await mount();
    const handle = headerFor(table, 'Value').querySelector('.resize-handle') as HTMLElement;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100 });
    handle.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect((table as any)._sortState).toEqual([]);
    document.dispatchEvent(new MouseEvent('mouseup'));
    table.remove();
  });

  it('double-clicking the handle restores the automatic width', async () => {
    // This is the only way back to the proportional layout after a manual resize.
    const table = await mount();
    const handle = headerFor(table, 'Value').querySelector('.resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect((table as any)._columnWidths.has('Value')).toBe(true);

    const dbl = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    handle.dispatchEvent(dbl);
    expect((table as any)._columnWidths.has('Value')).toBe(false);
    expect(dbl.defaultPrevented).toBe(true);
    table.remove();
  });

  it('the table falls back to a percentage layout until every column is pinned', async () => {
    // Mixing pixel and percentage widths in a fixed-layout table makes the columns
    // jump around; the component only switches to pixels once all are known.
    const table = await mount();
    const cols = (table as any)._visibleColumns as string[];
    expect((table as any)._getTableWidth(cols)).toBe('width: 100%;');
    expect((table as any)._getColWidth('Value', cols.length)).toBe(`${100 / cols.length}%`);

    const widths = new Map<string, number>(cols.map((c) => [c, 120]));
    (table as any)._columnWidths = widths;
    expect((table as any)._getTableWidth(cols)).toBe(`width: ${120 * cols.length}px;`);
    expect((table as any)._getColWidth('Value', cols.length)).toBe('120px');
    table.remove();
  });

  it('a resize does not sort, and the next real header click still does', async () => {
    // Regression: the browser fires a click on the <th> right after the resize
    // mouseup. It must be swallowed once — but only once, or the user's next
    // deliberate click on that header would be eaten too.
    const table = await mount();
    const valueTh = headerFor(table, 'Value');
    const handle = valueTh.querySelector('.resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    valueTh.click(); // the trailing click from the drag
    expect((table as any)._sortState).toEqual([]);
    valueTh.click(); // a genuine click afterwards
    expect((table as any)._sortState).toEqual([{ column: 'Value', direction: 'asc' }]);
    table.remove();
  });
});

describe('reordering columns by dragging a header', () => {
  it('dropping on the right half moves the column after the target', async () => {
    const table = await mount();
    fireHeader(table, 'Status', 'dragstart');
    (table as any)._dragOverSide = 'right';
    fireHeader(table, 'Value', 'drop');
    await table.updateComplete;

    const order = (table as any)._visibleColumns as string[];
    expect(order.indexOf('Status')).toBe(order.indexOf('Value') + 1);
    table.remove();
  });

  it('dropping on the left half moves the column before the target', async () => {
    const table = await mount();
    fireHeader(table, 'Status', 'dragstart');
    (table as any)._dragOverSide = 'left';
    fireHeader(table, 'Value', 'drop');
    await table.updateComplete;

    const order = (table as any)._visibleColumns as string[];
    expect(order.indexOf('Status')).toBe(order.indexOf('Value') - 1);
    table.remove();
  });

  it('the new order persists, so it survives reopening the file', async () => {
    const table = await mount();
    fireHeader(table, 'Status', 'dragstart');
    (table as any)._dragOverSide = 'left';
    fireHeader(table, 'Value', 'drop');

    const saved = JSON.parse(localStorage.getItem('dex-column-order')!) as string[];
    expect(saved.indexOf('Status')).toBeLessThan(saved.indexOf('Value'));
    table.remove();
  });

  it('dropping a column on itself changes nothing', async () => {
    const table = await mount();
    const before = [...((table as any)._visibleColumns as string[])];
    fireHeader(table, 'Value', 'dragstart');
    fireHeader(table, 'Value', 'drop');
    expect((table as any)._visibleColumns).toEqual(before);
    expect((table as any)._dragColId).toBeNull();
    table.remove();
  });

  it('a drop with no drag in progress is ignored', async () => {
    const table = await mount();
    const before = [...((table as any)._visibleColumns as string[])];
    fireHeader(table, 'Value', 'drop');
    expect((table as any)._visibleColumns).toEqual(before);
    table.remove();
  });

  it('dragging over a header marks the side the column will land on', async () => {
    // The insertion line is the user's only preview of where the drop will go.
    const table = await mount();
    fireHeader(table, 'Status', 'dragstart');
    // getBoundingClientRect is all zeros under happy-dom, so a clientX of 0 lands
    // on the midpoint and resolves to the right side.
    const { ev, dt } = fireHeader(table, 'Value', 'dragover');
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('move');
    expect((table as any)._dragOverColId).toBe('Value');
    expect((table as any)._dragOverSide).toBe('right');

    await table.updateComplete;
    expect(headerFor(table, 'Value').className).toContain('drag-over-right');
    table.remove();
  });

  it('dragging over the dragged column itself is not a drop target', async () => {
    const table = await mount();
    fireHeader(table, 'Value', 'dragstart');
    const { ev } = fireHeader(table, 'Value', 'dragover');
    expect(ev.defaultPrevented).toBe(false);
    expect((table as any)._dragOverColId).toBeNull();
    table.remove();
  });

  it('leaving a header clears the insertion marker', async () => {
    const table = await mount();
    fireHeader(table, 'Status', 'dragstart');
    fireHeader(table, 'Value', 'dragover');
    fireHeader(table, 'Value', 'dragleave');
    await table.updateComplete;
    expect((table as any)._dragOverColId).toBeNull();
    expect(headerFor(table, 'Value').className).not.toContain('drag-over');
    table.remove();
  });

  it('ending the drag clears all reorder state', async () => {
    // A stuck marker would keep an insertion line painted after the drag is over.
    const table = await mount();
    fireHeader(table, 'Status', 'dragstart');
    fireHeader(table, 'Value', 'dragover');
    fireHeader(table, 'Status', 'dragend');
    await table.updateComplete;
    expect((table as any)._dragColId).toBeNull();
    expect((table as any)._dragOverColId).toBeNull();
    expect((table as any)._dragOverSide).toBeNull();
    table.remove();
  });

  it('a header cannot be dragged away mid-resize', async () => {
    // Both gestures start on the same cell; letting a reorder begin during a
    // resize would leave the resize listeners running with no visible drag.
    const table = await mount();
    (table as any)._resizingCol = 'Value';
    const { ev } = fireHeader(table, 'Value', 'dragstart');
    expect(ev.defaultPrevented).toBe(true);
    expect((table as any)._dragColId).toBeNull();
    table.remove();
  });

  it('the drag payload marks the operation as a move', async () => {
    const table = await mount();
    const { dt } = fireHeader(table, 'Value', 'dragstart');
    expect(dt.effectAllowed).toBe('move');
    expect(dt.getData('text/plain')).toBe('Value');
    table.remove();
  });
});

describe('the Columns dropdown', () => {
  const menuButton = (table: DexTreeTable): HTMLElement =>
    table.shadowRoot!.querySelector('.columns-button') as HTMLElement;

  it('the button opens and closes the menu', async () => {
    const table = await mount();
    expect(table.shadowRoot!.querySelector('.column-menu')).toBeNull();

    menuButton(table).click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.column-menu')).not.toBeNull();

    menuButton(table).click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.column-menu')).toBeNull();
    table.remove();
  });

  it('the button reports its open state to assistive tech', async () => {
    const table = await mount();
    expect(menuButton(table).getAttribute('aria-expanded')).toBe('false');
    expect(menuButton(table).getAttribute('aria-haspopup')).toBe('true');
    menuButton(table).click();
    await table.updateComplete;
    expect(menuButton(table).getAttribute('aria-expanded')).toBe('true');
    table.remove();
  });

  it('the menu is anchored to the right so it cannot run off-screen', async () => {
    // Left-anchoring a button near the right edge would push the dropdown past
    // the panel and cut off the column labels.
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const menu = table.shadowRoot!.querySelector('.column-menu') as HTMLElement;
    expect(menu.style.right).toBe(`${Math.max(0, window.innerWidth)}px`);
    table.remove();
  });

  it('it lists every available column, hidden ones included', async () => {
    // A hidden column must stay reachable, or the user cannot bring it back.
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const labels = Array.from(table.shadowRoot!.querySelectorAll('.col-label')).map((el) => el.textContent);
    expect(labels).toEqual(HOST_COLUMNS);
    table.remove();
  });

  it('a checkbox reflects and toggles visibility', async () => {
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const items = Array.from(table.shadowRoot!.querySelectorAll('.column-menu-item')) as HTMLElement[];
    const kindIdx = HOST_COLUMNS.indexOf('Kind');
    const box = items[kindIdx].querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box.checked).toBe(false);

    box.dispatchEvent(new Event('change', { bubbles: true }));
    await table.updateComplete;
    expect((table as any)._visibleColumns).toContain('Kind');
    table.remove();
  });

  it('clicking the row label toggles it too, without closing the menu', async () => {
    // Toggling several columns in one visit is the normal case; closing on each
    // click would force the user to reopen the menu every time.
    //
    // The event must be a MouseEvent, not a bare Event: a row is a <label>, and
    // only a real click activates the checkbox it wraps — which is what performs
    // the toggle. A synthetic Event skips that forwarding entirely and so cannot
    // tell a working row from a broken one.
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const items = Array.from(table.shadowRoot!.querySelectorAll('.column-menu-item')) as HTMLElement[];
    items[HOST_COLUMNS.indexOf('Status')].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await table.updateComplete;

    expect((table as any)._visibleColumns).not.toContain('Status');
    expect(table.shadowRoot!.querySelector('.column-menu')).not.toBeNull();
    table.remove();
  });

  it('the Name row is disabled, since Name can never be hidden', async () => {
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const nameItem = table.shadowRoot!.querySelector('.column-menu-item') as HTMLElement;
    expect(nameItem.className).toContain('disabled');
    expect(nameItem.getAttribute('draggable')).toBe('false');
    expect((nameItem.querySelector('input') as HTMLInputElement).disabled).toBe(true);

    nameItem.dispatchEvent(new Event('click', { bubbles: true }));
    await table.updateComplete;
    expect((table as any)._visibleColumns).toContain('Name');
    table.remove();
  });

  it('Reset to default restores the shipped arrangement', async () => {
    const table = await mount();
    (table as any)._toggleColumnVisibility('Kind');
    (table as any)._toggleColumnVisibility('Status');
    menuButton(table).click();
    await table.updateComplete;

    (table.shadowRoot!.querySelector('.column-menu-reset') as HTMLElement).click();
    await table.updateComplete;
    expect((table as any)._visibleColumns).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status']);
    table.remove();
  });

  it('clicking outside closes the menu, but clicking inside does not', async () => {
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;

    const menu = table.shadowRoot!.querySelector('.column-menu') as HTMLElement;
    menu.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.column-menu')).not.toBeNull();

    document.body.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.column-menu')).toBeNull();
    table.remove();
  });

  it('dragging a row in the menu previews where it will land', async () => {
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const items = Array.from(table.shadowRoot!.querySelectorAll('.column-menu-item')) as HTMLElement[];

    const dragEv = new Event('dragstart', { bubbles: true }) as any;
    dragEv.dataTransfer = stubTransfer();
    items[HOST_COLUMNS.indexOf('Status')].dispatchEvent(dragEv);
    expect((table as any)._menuDragCol).toBe('Status');

    const overEv = new Event('dragover', { bubbles: true, cancelable: true }) as any;
    Object.assign(overEv, { dataTransfer: stubTransfer(), clientY: 0 });
    items[HOST_COLUMNS.indexOf('Value')].dispatchEvent(overEv);
    expect(overEv.defaultPrevented).toBe(true);
    expect((table as any)._menuDragOverCol).toBe('Value');
    // Zero-height rects under happy-dom put clientY 0 at the midpoint → bottom.
    expect((table as any)._menuDragOverSide).toBe('bottom');

    await table.updateComplete;
    const valueItem = (Array.from(table.shadowRoot!.querySelectorAll('.column-menu-item')) as HTMLElement[])[
      HOST_COLUMNS.indexOf('Value')
    ];
    expect(valueItem.className).toContain('drag-over-bottom');
    table.remove();
  });

  it('the Name row cannot be dragged and cannot be dragged onto', async () => {
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const items = Array.from(table.shadowRoot!.querySelectorAll('.column-menu-item')) as HTMLElement[];

    const dragName = new Event('dragstart', { bubbles: true, cancelable: true }) as any;
    dragName.dataTransfer = stubTransfer();
    items[0].dispatchEvent(dragName);
    expect(dragName.defaultPrevented).toBe(true);
    expect((table as any)._menuDragCol).toBeNull();

    (table as any)._menuDragCol = 'Status';
    const overName = new Event('dragover', { bubbles: true, cancelable: true }) as any;
    Object.assign(overName, { dataTransfer: stubTransfer(), clientY: 0 });
    items[0].dispatchEvent(overName);
    expect(overName.defaultPrevented).toBe(false);
    expect((table as any)._menuDragOverCol).toBeNull();
    table.remove();
  });

  it('leaving and ending a menu drag clear the preview', async () => {
    const table = await mount();
    menuButton(table).click();
    await table.updateComplete;
    const items = Array.from(table.shadowRoot!.querySelectorAll('.column-menu-item')) as HTMLElement[];

    (table as any)._menuDragCol = 'Status';
    (table as any)._menuDragOverCol = 'Value';
    items[HOST_COLUMNS.indexOf('Value')].dispatchEvent(new Event('dragleave', { bubbles: true }));
    expect((table as any)._menuDragOverCol).toBeNull();

    (table as any)._menuDragCol = 'Status';
    items[HOST_COLUMNS.indexOf('Status')].dispatchEvent(new Event('dragend', { bubbles: true }));
    expect((table as any)._menuDragCol).toBeNull();
    table.remove();
  });

  it('a menu drop whose column vanished from the order is ignored', async () => {
    // The host can change the supported column set while the menu is open.
    const table = await mount();
    const before = [...((table as any)._orderedColumns as string[])];
    (table as any)._menuDragCol = 'NotAColumn';
    (table as any)._menuDragOverSide = 'top';
    (table as any)._onMenuDrop('Value', { preventDefault() {} } as unknown as DragEvent);
    expect((table as any)._orderedColumns).toEqual(before);
    table.remove();
  });
});

describe('the header when a document is empty', () => {
  it('the Columns button still works with no rows', async () => {
    // The empty state is a separate render path; a user who needs to re-show a
    // column must not be locked out just because the file has no entries.
    const table = new DexTreeTable();
    table.columns = HOST_COLUMNS;
    document.body.appendChild(table);
    await table.updateComplete;

    const btn = table.shadowRoot!.querySelector('.columns-button') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.column-menu')).not.toBeNull();
    table.remove();
  });
});
