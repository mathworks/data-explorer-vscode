// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Sorting driven by clicking column headers. treeTableSort.test.ts covers the
// ordering algorithm against injected sort state; this covers the click handling
// that produces that state — the three-state plain-click cycle and the
// Shift-click multi-column build-up. Getting the cycle wrong strands the user in
// a sort they cannot clear, and a Shift-click that replaces instead of appending
// silently discards the primary sort they had just set.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'Status'];

beforeEach(() => localStorage.clear());

function makeRow(id: string, name: string, dataType: string, value: string): TreeTableRow {
  return { ID: id, parent: null, Name: { label: name }, Value: value, DataType: dataType, Description: '', Status: '' };
}

// Two entries share each DataType, so a secondary Name sort has something to
// actually decide — a single-key sort would produce the same order either way.
const ROWS = [
  makeRow('a', 'bb', 'double', '2'),
  makeRow('b', 'aa', 'double', '1'),
  makeRow('c', 'cc', 'single', '3'),
  makeRow('d', 'dd', 'single', '0'),
];

async function mount(rows: TreeTableRow[] = ROWS): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const headerFor = (table: DexTreeTable, col: string): HTMLElement => {
  const cols = (table as any)._visibleColumns as string[];
  return (Array.from(table.shadowRoot!.querySelectorAll('th')) as HTMLElement[])[cols.indexOf(col)];
};

async function click(table: DexTreeTable, col: string, shift = false): Promise<void> {
  headerFor(table, col).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: shift }));
  await table.updateComplete;
}

const sortState = (table: DexTreeTable): Array<{ column: string; direction: string }> =>
  (table as any)._sortState;

const renderedIds = (table: DexTreeTable): string[] =>
  Array.from(table.shadowRoot!.querySelectorAll('tr.data-row')).map((el) => el.getAttribute('data-row-id')!);

describe('clicking a header cycles through three sort states', () => {
  it('the first click sorts ascending', async () => {
    const table = await mount();
    await click(table, 'Name');
    expect(sortState(table)).toEqual([{ column: 'Name', direction: 'asc' }]);
    expect(renderedIds(table)).toEqual(['b', 'a', 'c', 'd']);
    table.remove();
  });

  it('the second click reverses it', async () => {
    const table = await mount();
    await click(table, 'Name');
    await click(table, 'Name');
    expect(sortState(table)).toEqual([{ column: 'Name', direction: 'desc' }]);
    expect(renderedIds(table)).toEqual(['d', 'c', 'a', 'b']);
    table.remove();
  });

  it('the third click clears the sort and restores the file order', async () => {
    // Without a way back to unsorted, the user can never see the entries in the
    // order they appear in the file, which is the order the file will be written.
    const table = await mount();
    await click(table, 'Name');
    await click(table, 'Name');
    await click(table, 'Name');
    expect(sortState(table)).toEqual([]);
    expect(renderedIds(table)).toEqual(['a', 'b', 'c', 'd']);
    table.remove();
  });

  it('clicking a different column starts that column fresh at ascending', async () => {
    // Carrying the previous column's descending direction over would make the
    // arrow point the opposite way from the order actually shown.
    const table = await mount();
    await click(table, 'Name');
    await click(table, 'Name');
    await click(table, 'DataType');
    expect(sortState(table)).toEqual([{ column: 'DataType', direction: 'asc' }]);
    table.remove();
  });

  it('a plain click replaces a multi-column sort rather than adding to it', async () => {
    // The user clicked without Shift, i.e. asked for one column; leaving the old
    // keys in place would leave the rows in an order the header no longer explains.
    const table = await mount();
    await click(table, 'DataType');
    await click(table, 'Name', true);
    expect(sortState(table)).toHaveLength(2);

    await click(table, 'Value');
    expect(sortState(table)).toEqual([{ column: 'Value', direction: 'asc' }]);
    table.remove();
  });
});

describe('shift-clicking builds a multi-column sort', () => {
  it('a shift-click appends a secondary key and keeps the primary one', async () => {
    // Grouping by DataType and then ordering by Name within each group is the
    // whole point of multi-sort; appending must not disturb the primary key.
    const table = await mount();
    await click(table, 'DataType');
    await click(table, 'Name', true);

    expect(sortState(table)).toEqual([
      { column: 'DataType', direction: 'asc' },
      { column: 'Name', direction: 'asc' },
    ]);
    // double before single; within double, aa before bb.
    expect(renderedIds(table)).toEqual(['b', 'a', 'c', 'd']);
    table.remove();
  });

  it('shift-clicking the same column again reverses just that key', async () => {
    const table = await mount();
    await click(table, 'DataType');
    await click(table, 'Name', true);
    await click(table, 'Name', true);

    expect(sortState(table)).toEqual([
      { column: 'DataType', direction: 'asc' },
      { column: 'Name', direction: 'desc' },
    ]);
    // Groups unchanged, order within each group flipped.
    expect(renderedIds(table)).toEqual(['a', 'b', 'd', 'c']);
    table.remove();
  });

  it('a third shift-click drops that key and leaves the rest intact', async () => {
    // Removing the secondary key must not also clear the primary one, or backing
    // out of a refinement would throw away the grouping the user still wants.
    const table = await mount();
    await click(table, 'DataType');
    await click(table, 'Name', true);
    await click(table, 'Name', true);
    await click(table, 'Name', true);

    expect(sortState(table)).toEqual([{ column: 'DataType', direction: 'asc' }]);
    table.remove();
  });

  it('a shift-click with nothing sorted yet just starts a sort', async () => {
    const table = await mount();
    await click(table, 'Name', true);
    expect(sortState(table)).toEqual([{ column: 'Name', direction: 'asc' }]);
    table.remove();
  });

  it('keys accumulate in click order, since the first one clicked sorts first', async () => {
    const table = await mount();
    await click(table, 'Status', true);
    await click(table, 'DataType', true);
    await click(table, 'Name', true);
    expect(sortState(table).map((s) => s.column)).toEqual(['Status', 'DataType', 'Name']);
    table.remove();
  });

  it('removing the only key leaves the table unsorted, not half-sorted', async () => {
    const table = await mount();
    await click(table, 'Name', true);
    await click(table, 'Name', true);
    await click(table, 'Name', true);
    expect(sortState(table)).toEqual([]);
    expect(renderedIds(table)).toEqual(['a', 'b', 'c', 'd']);
    table.remove();
  });
});

describe('the header shows which sort is active', () => {
  it('every sorted column carries its own arrow, not just the primary one', async () => {
    // With only one arrow the user cannot tell a two-key sort from a one-key sort
    // whose order looks coincidentally similar.
    const table = await mount();
    await click(table, 'DataType');
    await click(table, 'Name', true);
    await click(table, 'Name', true);

    expect(headerFor(table, 'DataType').querySelector('.sort-indicator')!.textContent).toBe('▲');
    expect(headerFor(table, 'Name').querySelector('.sort-indicator')!.textContent).toBe('▼');
    expect(headerFor(table, 'Value').querySelector('.sort-indicator')).toBeNull();
    table.remove();
  });

  it('aria-sort reports the direction on sorted columns and none elsewhere', async () => {
    // A screen reader user has no arrow to look at; aria-sort is the only signal.
    const table = await mount();
    await click(table, 'DataType');
    await click(table, 'Name', true);
    await click(table, 'Name', true);

    expect(headerFor(table, 'DataType').getAttribute('aria-sort')).toBe('ascending');
    expect(headerFor(table, 'Name').getAttribute('aria-sort')).toBe('descending');
    expect(headerFor(table, 'Value').getAttribute('aria-sort')).toBe('none');
    table.remove();
  });

  it('clearing the sort removes the arrow and resets aria-sort', async () => {
    const table = await mount();
    await click(table, 'Name');
    await click(table, 'Name');
    await click(table, 'Name');
    expect(headerFor(table, 'Name').querySelector('.sort-indicator')).toBeNull();
    expect(headerFor(table, 'Name').getAttribute('aria-sort')).toBe('none');
    table.remove();
  });
});

describe('a header click during a resize is not a sort', () => {
  it('no sort is applied while a column is actively being resized', async () => {
    // The mousedown that starts a resize is followed by a click on the same <th>;
    // sorting there would reorder the table every time the user adjusts a width.
    const table = await mount();
    (table as any)._resizingCol = 'Value';
    await click(table, 'Value');
    expect(sortState(table)).toEqual([]);
    (table as any)._resizingCol = null;
    table.remove();
  });
});
