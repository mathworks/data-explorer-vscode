// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Keyboard navigation and accessibility. The table is the extension's primary
// surface, and a keyboard-only or screen-reader user drives it entirely through
// these handlers: arrows/Home/End/PageUp/PageDown to move the selection, Space
// to expand, Enter to edit, Ctrl+A to select all. The aria state on the grid and
// on each row is the ONLY way assistive tech learns the hierarchy — indentation
// and the ▶/▼ glyph are purely visual.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

function makeRow(id: string, parent: string | null, name: string, extra: Partial<TreeTableRow> = {}): TreeTableRow {
  return { ID: id, parent, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '', ...extra };
}

async function mount(rows: TreeTableRow[], expanded: string[] = []): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType', 'UsedBy', 'Status'];
  document.body.appendChild(table);
  table.rows = rows;
  (table as any)._expandedIds = new Set(expanded);
  (table as any)._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

// Dispatch a keydown on the grid container, the element that actually carries
// the @keydown binding (and tabindex), so these exercise the real event path.
function press(table: DexTreeTable, key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  ((table as any)._container as HTMLElement).dispatchEvent(e);
  return e;
}

const FLAT = ['a', 'b', 'c', 'd'].map((id, i) => makeRow(id, null, 'Row' + i));

describe('arrow-key navigation', () => {
  it('ArrowDown/ArrowUp move the selection one row at a time', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['a'];
    await table.updateComplete;

    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['b']);
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['c']);
    press(table, 'ArrowUp');
    expect(table.selectedRowIds).toEqual(['b']);
    table.remove();
  });

  it('clamps at the first and last row instead of wrapping', async () => {
    // Wrapping from the end back to the top would silently jump the user to a
    // different part of a long dictionary.
    const table = await mount(FLAT);
    table.selectedRowIds = ['d'];
    await table.updateComplete;
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['d']);

    table.selectedRowIds = ['a'];
    await table.updateComplete;
    press(table, 'ArrowUp');
    expect(table.selectedRowIds).toEqual(['a']);
    table.remove();
  });

  it('preventDefault stops the container scrolling out from under the selection', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['a'];
    await table.updateComplete;
    expect(press(table, 'ArrowDown').defaultPrevented).toBe(true);
    // A key the table doesn't handle stays available to the browser.
    expect(press(table, 'q').defaultPrevented).toBe(false);
    table.remove();
  });

  it('an unhandled key leaves the selection alone', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['b'];
    await table.updateComplete;
    press(table, 'q');
    expect(table.selectedRowIds).toEqual(['b']);
    table.remove();
  });

  it('walks INTO an expanded subtree, following visual order', async () => {
    // Arrow order must match what the user sees: a child sits directly below its
    // parent, so ArrowDown from a parent lands on its first child.
    const rows = [makeRow('S', null, 'Sec'), makeRow('S/a', 'S', 'A'), makeRow('S/b', 'S', 'B'), makeRow('T', null, 'Tail')];
    const table = await mount(rows, ['S']);
    table.selectedRowIds = ['S'];
    await table.updateComplete;
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['S/a']);
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['S/b']);
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['T']);
    table.remove();
  });

  it('skips a collapsed subtree entirely', async () => {
    const rows = [makeRow('S', null, 'Sec'), makeRow('S/a', 'S', 'A'), makeRow('T', null, 'Tail')];
    const table = await mount(rows, []);
    table.selectedRowIds = ['S'];
    await table.updateComplete;
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['T']);
    table.remove();
  });

  it('ArrowLeft/ArrowRight move the focused cell and clamp at both edges', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['a'];
    await table.updateComplete;
    const colCount = (table as any)._visibleColumns.length;

    for (let i = 0; i < colCount + 3; i++) press(table, 'ArrowRight');
    expect((table as any)._focusedCol).toBe(colCount - 1);
    for (let i = 0; i < colCount + 3; i++) press(table, 'ArrowLeft');
    expect((table as any)._focusedCol).toBe(0);
    table.remove();
  });

  it('fires dex-row-selected so the host keeps the property inspector in sync', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['a'];
    await table.updateComplete;
    const seen: string[][] = [];
    table.addEventListener('dex-row-selected', (e) => seen.push((e as CustomEvent).detail.rowIds));
    press(table, 'ArrowDown');
    expect(seen).toEqual([['b']]);
    table.remove();
  });
});

describe('keyboard selection ranges', () => {
  it('Shift+Arrow grows a contiguous range from the anchor', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['b'];
    (table as any)._lastClickedId = 'b';
    await table.updateComplete;

    press(table, 'ArrowDown', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['b', 'c']);
    table.remove();
  });

  it('Ctrl+Arrow adds rows without dropping the earlier ones', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['a'];
    (table as any)._lastClickedId = 'a';
    await table.updateComplete;

    press(table, 'ArrowDown', { ctrlKey: true });
    press(table, 'ArrowDown', { ctrlKey: true });
    expect(table.selectedRowIds).toEqual(['a', 'b', 'c']);
    table.remove();
  });

  // ArrowUp is a separate branch of the same switch, so it can drift from
  // ArrowDown: an upward extend that replaced the selection instead of adding to
  // it would silently drop rows the user had already gathered.
  //
  // Ctrl accumulates in the order the user visited the rows, the same as
  // Ctrl+click — NOT in document order. A multi-row drag pastes in this order, so
  // it is observable, and re-sorting here would make the keyboard and the mouse
  // disagree about it.
  it('Ctrl+ArrowUp adds rows upward without dropping the earlier ones', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['d'];
    (table as any)._lastClickedId = 'd';
    await table.updateComplete;

    press(table, 'ArrowUp', { ctrlKey: true });
    press(table, 'ArrowUp', { ctrlKey: true });
    expect(table.selectedRowIds).toEqual(['d', 'c', 'b']);
    table.remove();
  });

  // Shift, by contrast, replaces the selection with the anchor-to-cursor span, so
  // it IS in document order however the user got there.
  it('Shift+ArrowUp grows the range upward from the anchor', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['c'];
    (table as any)._lastClickedId = 'c';
    await table.updateComplete;

    press(table, 'ArrowUp', { shiftKey: true });
    expect(table.selectedRowIds).toEqual(['b', 'c']);
    table.remove();
  });

  it('Cmd+ArrowUp extends too, for macOS', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['c'];
    (table as any)._lastClickedId = 'c';
    await table.updateComplete;

    press(table, 'ArrowUp', { metaKey: true });
    expect(table.selectedRowIds).toEqual(['c', 'b']);
    table.remove();
  });

  it('Ctrl+ArrowUp at the first row does not wrap around to the last', async () => {
    // clamping, not wrapping: an extend that wrapped would add the far end of the
    // table to a selection the user was building at the top.
    const table = await mount(FLAT);
    table.selectedRowIds = ['a'];
    (table as any)._lastClickedId = 'a';
    await table.updateComplete;

    press(table, 'ArrowUp', { ctrlKey: true });
    expect(table.selectedRowIds).toEqual(['a']);
    table.remove();
  });

  it('Ctrl+A selects every visible row, and only visible ones', async () => {
    // Selecting rows hidden in a collapsed subtree would make a following Delete
    // remove entries the user never saw.
    const rows = [makeRow('S', null, 'Sec'), makeRow('S/hidden', 'S', 'Hidden'), makeRow('T', null, 'Tail')];
    const table = await mount(rows, []);
    const seen: string[][] = [];
    table.addEventListener('dex-row-selected', (e) => seen.push((e as CustomEvent).detail.rowIds));

    expect(press(table, 'a', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(table.selectedRowIds).toEqual(['S', 'T']);
    expect(seen).toEqual([['S', 'T']]);
    table.remove();
  });

  it('a plain "a" keystroke does not select all', async () => {
    // Otherwise typing in the table would wipe out a careful selection.
    const table = await mount(FLAT);
    table.selectedRowIds = ['b'];
    await table.updateComplete;
    press(table, 'a');
    expect(table.selectedRowIds).toEqual(['b']);
    table.remove();
  });

  it('Cmd+A works too, for macOS', async () => {
    const table = await mount(FLAT);
    press(table, 'a', { metaKey: true });
    expect(table.selectedRowIds).toEqual(['a', 'b', 'c', 'd']);
    table.remove();
  });
});

describe('a click re-anchors the keyboard cursor', () => {
  // Regression: arrow navigation tracks its own cursor (_focusedRowId) which
  // ctrl/shift-arrow leaves behind, and _onTableKeyDown prefers that cursor over
  // the selection. A click updated the selection but not the cursor, so the next
  // arrow key stepped from the row the user had last arrowed to — the selection
  // jumped somewhere unrelated to the row they just clicked.
  it('ArrowDown after a click steps from the clicked row', async () => {
    const rows = [makeRow('S', null, 'Sec'), makeRow('S/a', 'S', 'A'), makeRow('S/b', 'S', 'B'), makeRow('S/c', 'S', 'C')];
    const table = await mount(rows, ['S']);
    table.selectedRowIds = ['S'];
    (table as any)._lastClickedId = 'S';
    await table.updateComplete;

    // Ctrl-arrow down twice: the cursor is now on S/b.
    press(table, 'ArrowDown', { ctrlKey: true });
    press(table, 'ArrowDown', { ctrlKey: true });
    expect((table as any)._focusedRowId).toBe('S/b');

    // The user clicks back on the top row.
    (table.shadowRoot!.querySelector('tr[data-row-id="S"] td.col-Name') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await table.updateComplete;
    expect(table.selectedRowIds).toEqual(['S']);

    // ArrowDown must advance from S, not from the stale S/b cursor.
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['S/a']);
    table.remove();
  });

  it('a click also clears the cursor left by a shift-range', async () => {
    const rows = [makeRow('a', null, 'A'), makeRow('b', null, 'B'), makeRow('c', null, 'C')];
    const table = await mount(rows);
    table.selectedRowIds = ['c'];
    (table as any)._lastClickedId = 'c';
    await table.updateComplete;
    press(table, 'ArrowUp', { shiftKey: true }); // range b..c, cursor on b

    (table.shadowRoot!.querySelector('tr[data-row-id="a"] td.col-Name') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['b']);
    table.remove();
  });
});

describe('Space toggles expansion', () => {
  it('expands and collapses the selected parent row', async () => {
    const rows = [makeRow('S', null, 'Sec'), makeRow('S/a', 'S', 'A')];
    const table = await mount(rows, []);
    table.selectedRowIds = ['S'];
    await table.updateComplete;

    press(table, ' ');
    expect((table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID)).toEqual(['S', 'S/a']);
    press(table, ' ');
    expect((table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID)).toEqual(['S']);
    table.remove();
  });

  it('does nothing on a leaf row', async () => {
    // A leaf has nothing to expand; adding it to the expanded set would leave
    // stale state that resurfaces if the row later gains children.
    const rows = [makeRow('S', null, 'Sec'), makeRow('S/a', 'S', 'A'), makeRow('leaf', null, 'Leaf')];
    const table = await mount(rows, []);
    table.selectedRowIds = ['leaf'];
    await table.updateComplete;
    press(table, ' ');
    expect([...(table as any)._expandedIds]).toEqual([]);
    table.remove();
  });

  it('Space is swallowed so the page does not scroll', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['a'];
    await table.updateComplete;
    expect(press(table, ' ').defaultPrevented).toBe(true);
    table.remove();
  });
});

describe('Enter starts an edit', () => {
  it('opens the editor for the focused editable cell', async () => {
    const table = await mount([makeRow('a', null, 'A', { Value: { text: 'v1', editable: true } })]);
    table.selectedRowIds = ['a'];
    (table as any)._focusedCol = 1; // the Value column
    await table.updateComplete;

    press(table, 'Enter');
    expect((table as any)._editingCell).toMatchObject({ rowId: 'a', columnId: 'Value', value: 'v1' });
    table.remove();
  });

  it('does nothing on a read-only cell', async () => {
    const table = await mount([makeRow('a', null, 'A', { Value: { text: 'v1', editable: false } })]);
    table.selectedRowIds = ['a'];
    (table as any)._focusedCol = 1;
    await table.updateComplete;
    press(table, 'Enter');
    expect((table as any)._editingCell).toBeNull();
    table.remove();
  });

  it('navigation keys are inert while an editor is open', async () => {
    // Arrow keys belong to the text cursor inside the editor; moving the row
    // selection would tear the editor down mid-typing and lose the edit.
    const table = await mount([makeRow('a', null, 'A', { Value: { text: 'v1', editable: true } }), makeRow('b', null, 'B')]);
    table.selectedRowIds = ['a'];
    await table.updateComplete;
    (table as any)._onCellDblClickIfEditable(table.rows[0], 'Value');
    await table.updateComplete;

    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['a']);
    expect((table as any)._editingCell).not.toBeNull();
    table.remove();
  });
});

describe('aria state matches the visual tree', () => {
  it('a leaf row omits aria-expanded rather than claiming to be collapsed', async () => {
    // aria-expanded="false" on a leaf tells the user there is content to open.
    const rows = [makeRow('S', null, 'Sec'), makeRow('S/a', 'S', 'A')];
    const table = await mount(rows, ['S']);
    const leaf = table.shadowRoot!.querySelector('tr[data-row-id="S/a"]') as HTMLElement;
    expect(leaf.hasAttribute('aria-expanded')).toBe(false);
    table.remove();
  });

  it('aria-selected marks exactly the selected rows', async () => {
    const table = await mount(FLAT);
    table.selectedRowIds = ['b', 'c'];
    await table.updateComplete;
    const selected = Array.from(table.shadowRoot!.querySelectorAll('tr[aria-selected="true"]')).map((el) =>
      el.getAttribute('data-row-id'),
    );
    expect(selected).toEqual(['b', 'c']);
    table.remove();
  });

  it('aria-sort on the header follows the active sort', async () => {
    const table = await mount(FLAT);
    const nameTh = () => table.shadowRoot!.querySelector('th') as HTMLElement;
    expect(nameTh().getAttribute('aria-sort')).toBe('none');

    nameTh().click();
    await table.updateComplete;
    expect(nameTh().getAttribute('aria-sort')).toBe('ascending');
    nameTh().click();
    await table.updateComplete;
    expect(nameTh().getAttribute('aria-sort')).toBe('descending');
    nameTh().click();
    await table.updateComplete;
    expect(nameTh().getAttribute('aria-sort')).toBe('none');
    table.remove();
  });

  it('aria-rowindex accounts for the header and for virtual scrolling', async () => {
    // The rendered rows are a window into a much longer list, so the index must
    // be the row's position in the FULL list or a screen reader miscounts.
    const rows: TreeTableRow[] = [];
    for (let i = 0; i < 200; i++) rows.push(makeRow('r' + i, null, 'row' + i));
    const table = await mount(rows);
    const first = table.shadowRoot!.querySelector('tr.data-row') as HTMLElement;
    expect(first.getAttribute('data-row-id')).toBe('r0');
    expect(first.getAttribute('aria-rowindex')).toBe('2'); // header is row 1
    table.remove();
  });
});

describe('keyboard input on a degenerate table', () => {
  it('every navigation key is a safe no-op with zero rows', async () => {
    const table = await mount([]);
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter', ' ']) {
      expect(() => (table as any)._onTableKeyDown(new KeyboardEvent('keydown', { key: k }))).not.toThrow();
    }
    expect(table.selectedRowIds).toEqual([]);
    table.remove();
  });

  it('with one row, every movement key keeps that row selected', async () => {
    const table = await mount([makeRow('only', null, 'Only')]);
    table.selectedRowIds = ['only'];
    await table.updateComplete;
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']) {
      press(table, k);
      expect(table.selectedRowIds).toEqual(['only']);
    }
    table.remove();
  });

  it('an arrow key with nothing selected starts from the top', async () => {
    const table = await mount(FLAT);
    press(table, 'ArrowDown');
    expect(table.selectedRowIds).toEqual(['a']);
    table.remove();
  });
});
