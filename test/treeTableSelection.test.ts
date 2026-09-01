// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Row selection. The selection drives the property inspector AND is the operand
// for Delete / cut / copy, so getting it wrong is destructive: an extra row in
// the set is an extra entry deleted from the user's file. `dex-row-selected`
// carries the whole set to the host, and the host reflects it back through the
// `selectedRowIds` property, so the component has to behave correctly whether
// the change came from a click or from outside.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

function makeRow(id: string, parent: string | null, name = id): TreeTableRow {
  return { ID: id, parent, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '' };
}

async function mount(rows: TreeTableRow[], expanded: string[] = []): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType', 'Status'];
  document.body.appendChild(table);
  table.rows = rows;
  (table as any)._expandedIds = new Set(expanded);
  (table as any)._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

// Click a row's Name cell, which is what the user actually hits.
function click(table: DexTreeTable, rowId: string, mods: Partial<MouseEventInit> = {}): void {
  const td = table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] td.col-Name`) as HTMLElement;
  td.dispatchEvent(new MouseEvent('click', { bubbles: true, ...mods }));
}

function recordSelections(table: DexTreeTable): string[][] {
  const seen: string[][] = [];
  table.addEventListener('dex-row-selected', (e) => seen.push([...(e as CustomEvent).detail.rowIds]));
  return seen;
}

const FLAT = ['a', 'b', 'c', 'd', 'e'].map((id) => makeRow(id, null));

describe('plain clicks', () => {
  it('a click selects exactly one row and tells the host', async () => {
    const table = await mount(FLAT);
    const seen = recordSelections(table);
    click(table, 'b');
    await table.updateComplete;
    expect(table.selectedRowIds).toEqual(['b']);
    expect(seen).toEqual([['b']]);
    table.remove();
  });

  it('a second plain click replaces the selection rather than adding to it', async () => {
    const table = await mount(FLAT);
    click(table, 'b');
    click(table, 'd');
    expect(table.selectedRowIds).toEqual(['d']);
    table.remove();
  });

  it('the selected row is marked in the DOM so the user can see it', async () => {
    const table = await mount(FLAT);
    click(table, 'c');
    await table.updateComplete;
    const marked = Array.from(table.shadowRoot!.querySelectorAll('tr.selected')).map((el) =>
      el.getAttribute('data-row-id'),
    );
    expect(marked).toEqual(['c']);
    table.remove();
  });

  it('clicking the already-selected row keeps it selected', async () => {
    // Re-clicking must not toggle a single selection off: the inspector would
    // blank out under the user's cursor.
    const table = await mount(FLAT);
    click(table, 'b');
    click(table, 'b');
    expect(table.selectedRowIds).toEqual(['b']);
    table.remove();
  });

  it('a click records the column, so a later Enter edits the cell that was clicked', async () => {
    const table = await mount(FLAT);
    const td = table.shadowRoot!.querySelector('tr[data-row-id="b"] td.col-DataType') as HTMLElement;
    td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect((table as any)._focusedCol).toBe(2);
    table.remove();
  });
});

describe('ctrl/cmd-click toggles individual rows', () => {
  it('adds a row to the selection', async () => {
    const table = await mount(FLAT);
    click(table, 'a');
    click(table, 'c', { ctrlKey: true });
    expect(new Set(table.selectedRowIds)).toEqual(new Set(['a', 'c']));
    table.remove();
  });

  it('removes a row that was already selected', async () => {
    const table = await mount(FLAT);
    click(table, 'a');
    click(table, 'c', { ctrlKey: true });
    click(table, 'a', { ctrlKey: true });
    expect(table.selectedRowIds).toEqual(['c']);
    table.remove();
  });

  it('can empty the selection entirely', async () => {
    const table = await mount(FLAT);
    const seen = recordSelections(table);
    click(table, 'a');
    click(table, 'a', { ctrlKey: true });
    expect(table.selectedRowIds).toEqual([]);
    // The host still hears about it, so the inspector clears.
    expect(seen[seen.length - 1]).toEqual([]);
    table.remove();
  });

  it('cmd-click behaves the same on macOS', async () => {
    const table = await mount(FLAT);
    click(table, 'a');
    click(table, 'c', { metaKey: true });
    expect(new Set(table.selectedRowIds)).toEqual(new Set(['a', 'c']));
    table.remove();
  });

  it('never duplicates a row in the reported set', async () => {
    // A duplicate would make the host apply a delete or copy twice.
    const table = await mount(FLAT);
    click(table, 'a');
    click(table, 'b', { ctrlKey: true });
    click(table, 'b', { ctrlKey: true });
    click(table, 'b', { ctrlKey: true });
    expect(table.selectedRowIds).toEqual(['a', 'b']);
    table.remove();
  });
});

describe('shift-click selects a range', () => {
  it('selects everything between the anchor and the clicked row', async () => {
    const table = await mount(FLAT);
    click(table, 'b');
    click(table, 'd', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['b', 'c', 'd']);
    table.remove();
  });

  it('works backwards from the anchor', async () => {
    const table = await mount(FLAT);
    click(table, 'd');
    click(table, 'b', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['b', 'c', 'd']);
    table.remove();
  });

  it('keeps the same anchor, so the range can be resized', async () => {
    // Shift-clicking again must re-measure from the original anchor, not from the
    // previous range end, or the user cannot shrink a range they overshot.
    const table = await mount(FLAT);
    click(table, 'b');
    click(table, 'e', { shiftKey: true });
    click(table, 'c', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['b', 'c']);
    table.remove();
  });

  it('the range follows visual order, so it never includes hidden rows', async () => {
    // A range built from the underlying array could sweep in rows collapsed out
    // of sight — which a following Delete would then remove.
    const rows = [makeRow('top', null), makeRow('top/hidden', 'top'), makeRow('mid', null), makeRow('end', null)];
    const table = await mount(rows, []);
    click(table, 'top');
    click(table, 'end', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['top', 'mid', 'end']);
    table.remove();
  });

  it('shift-click with no anchor yet leaves the selection unchanged', async () => {
    const table = await mount(FLAT);
    click(table, 'c', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['c']);
    table.remove();
  });

  it('an anchor that scrolled out of the filtered view does not clear the selection', async () => {
    // If the anchor is gone the range is undefined; wiping the selection would
    // lose work the user had assembled.
    const table = await mount(FLAT);
    click(table, 'b');
    click(table, 'd', { shiftKey: true });
    (table as any)._lastClickedId = 'not-in-view';
    click(table, 'a', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['b', 'c', 'd']);
    table.remove();
  });
});

describe('selection set by the host', () => {
  it('assigning selectedRowIds marks the rows without echoing an event back', async () => {
    // The host sets this in response to its own action; re-dispatching would
    // bounce the update back and forth.
    const table = await mount(FLAT);
    const seen = recordSelections(table);
    table.selectedRowIds = ['b', 'c'];
    await table.updateComplete;
    expect(seen).toEqual([]);
    const marked = Array.from(table.shadowRoot!.querySelectorAll('tr.selected')).map((el) =>
      el.getAttribute('data-row-id'),
    );
    expect(marked).toEqual(['b', 'c']);
    table.remove();
  });

  it('the singular selectedRowId accessor reads and writes the set', async () => {
    // Older host code and the inspector both use the single-row form.
    const table = await mount(FLAT);
    table.selectedRowId = 'c';
    expect(table.selectedRowIds).toEqual(['c']);
    expect(table.selectedRowId).toBe('c');

    table.selectedRowIds = ['a', 'b'];
    // With several rows it reports the most recent one — what the inspector shows.
    expect(table.selectedRowId).toBe('b');

    table.selectedRowId = '';
    expect(table.selectedRowIds).toEqual([]);
    expect(table.selectedRowId).toBe('');
    table.remove();
  });

  it('a selection survives a re-sort, following the row rather than the position', async () => {
    const table = await mount(FLAT);
    click(table, 'b');
    (table.shadowRoot!.querySelector('th') as HTMLElement).click();
    (table.shadowRoot!.querySelector('th') as HTMLElement).click();
    await table.updateComplete;
    expect(table.selectedRowIds).toEqual(['b']);
    table.remove();
  });

  it('a selected row that is deleted from the document leaves no ghost highlight', async () => {
    const table = await mount(FLAT);
    click(table, 'b');
    table.rows = FLAT.filter((r) => r.ID !== 'b');
    (table as any)._visibleRowsCache = null;
    await table.updateComplete;
    expect(table.shadowRoot!.querySelectorAll('tr.selected').length).toBe(0);
    table.remove();
  });
});

describe('right-click selection', () => {
  it('selects the row under the cursor when it was not already selected', async () => {
    // The context menu acts on the selection, so it must first become the row the
    // user actually right-clicked — otherwise Delete removes the wrong entry.
    const table = await mount(FLAT);
    click(table, 'a');
    const seen = recordSelections(table);

    const td = table.shadowRoot!.querySelector('tr[data-row-id="d"] td.col-Name') as HTMLElement;
    td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(table.selectedRowIds).toEqual(['d']);
    expect(seen).toEqual([['d']]);
    table.remove();
  });

  it('preserves an existing multi-selection when right-clicking inside it', async () => {
    // Collapsing a careful multi-selection to one row would silently narrow the
    // operation the user is about to choose from the menu.
    const table = await mount(FLAT);
    click(table, 'b');
    click(table, 'd', { shiftKey: true });
    const seen = recordSelections(table);

    const td = table.shadowRoot!.querySelector('tr[data-row-id="c"] td.col-Name') as HTMLElement;
    td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(table.selectedRowIds).toEqual(['b', 'c', 'd']);
    expect(seen).toEqual([]);
    table.remove();
  });

  it('reports the position and row so the host can place the menu', async () => {
    const table = await mount(FLAT);
    const menus: any[] = [];
    table.addEventListener('dex-table-context-menu', (e) => menus.push((e as CustomEvent).detail));

    const td = table.shadowRoot!.querySelector('tr[data-row-id="c"] td.col-Name') as HTMLElement;
    td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }));
    expect(menus).toEqual([{ x: 120, y: 80, rowId: 'c', graphTarget: undefined }]);
    table.remove();
  });

  it('passes the row graph target through, which drives the Show-in-Model item', async () => {
    const rows = [{ ...makeRow('g', null), _graphTarget: 'model/Block' } as any];
    const table = await mount(rows);
    const menus: any[] = [];
    table.addEventListener('dex-table-context-menu', (e) => menus.push((e as CustomEvent).detail));

    const td = table.shadowRoot!.querySelector('tr[data-row-id="g"] td.col-Name') as HTMLElement;
    td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menus[0].graphTarget).toBe('model/Block');
    table.remove();
  });

  it('suppresses the browser menu, on a row and on empty space alike', async () => {
    // The extension supplies its own menu; the native one would offer irrelevant
    // browser commands over the grid.
    const table = await mount(FLAT);
    const onRow = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    (table.shadowRoot!.querySelector('tr[data-row-id="a"] td.col-Name') as HTMLElement).dispatchEvent(onRow);
    expect(onRow.defaultPrevented).toBe(true);

    const onBlank = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    ((table as any)._container as HTMLElement).dispatchEvent(onBlank);
    expect(onBlank.defaultPrevented).toBe(true);
    table.remove();
  });
});
