// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Regression test for scroll-into-view on a LARGE (virtualized) table. When a
// global-search result (or a cross-tab Usage link) selects a row far down a big
// data source that was just opened, the row must be scrolled into the rendered
// virtual window — not left off-screen.
//
// The original bug: _scrollToSelectedRow set _container.scrollTop directly and
// relied on the async native scroll event to sync the reactive _scrollTop that
// drives the virtual window. On a fresh open the container isn't scrollable yet
// (its rows aren't painted), so the write clamped to 0, no scroll event fired,
// and the window stayed pinned to the top — the selected deep row was never
// rendered. Small tables render every row, so they masked the bug; it only
// showed on large, virtualized tables opened fresh. The fix drives the window
// via the reactive _scrollTop so the slice repaints to include the target row.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

function makeRow(id: string, parent: string | null, name: string): TreeTableRow {
  return { ID: id, parent, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '' };
}

describe('scroll-to-selected on large virtualized table', () => {
  it('renders the selected deep row into the DOM after selection', async () => {
    const rows: TreeTableRow[] = [makeRow('S', null, 'Sec')];
    for (let i = 0; i < 500; i++) rows.push(makeRow('S/' + i, 'S', 'row' + i));
    const table = new DexTreeTable();
    document.body.appendChild(table);
    table.rows = rows;
    (table as any)._expandedIds = new Set(['S']);
    (table as any)._visibleRowsCache = null;
    await table.updateComplete;
    // happy-dom has no layout engine: clientHeight is 0. Simulate a laid-out
    // panel so the virtual-window math has a real viewport height to work with
    // (in the extension, a ResizeObserver keeps _viewportHeight in sync). AFTER
    // the first update, because `firstUpdated` assigns the measured height —
    // which is 0 here — over whatever was set before it.
    (table as any)._viewportHeight = 400;
    await table.updateComplete;

    // A row far down, well outside the initial top-of-list virtual window.
    table.selectedRowIds = ['S/400'];
    await table.updateComplete;
    // Let the queued updateComplete.then chain (scroll → reactive state) settle.
    await new Promise((r) => setTimeout(r, 0));
    await table.updateComplete;

    const rendered = table.shadowRoot?.querySelector('tr[data-row-id="S/400"]');
    expect(!!rendered).toBe(true);
    // The virtual window advanced off the top to bring the row into view.
    expect((table as any)._scrollTop).toBeGreaterThan(0);

    // The row should land near the vertical CENTER of the table view, not
    // pinned to the bottom edge. With row height h and usable height (viewport
    // minus the sticky header), a centered row sits at scrollTop ≈ top - (usable - h)/2.
    const rowH = (table as any)._rowH as number;
    const viewH = (table as any)._viewportHeight as number;
    const usable = viewH - rowH; // sticky header
    const idx = 401; // S is idx 0; S/400 is the 402nd visible row
    const top = idx * rowH;
    const expectedCentered = Math.round(top - (usable - rowH) / 2);
    // Allow a row of slack for rounding.
    expect(Math.abs((table as any)._scrollTop - expectedCentered)).toBeLessThanOrEqual(rowH);
  });
});

// The SAME reveal, on a table the user has already scrolled — which is the case a
// Usage link hits when it selects a row in the tab it was clicked from.
//
// `_scrollTop` is the virtual WINDOW's position, not the DOM's: `_onScroll`
// returns without touching it whenever the scroll lands inside the slice already
// rendered, because no repaint is needed. So the two diverge, and near the top of
// the list they diverge widely — the start index is `max(0, … - BUFFER_ROWS)`, so
// the whole first BUFFER_ROWS+1 rows of scrolling leaves `_scrollTop` at 0.
// Reading it as "where the rows are now" made the reveal compare the target
// against a position the table had left, conclude it was already on screen, and
// take the `next === cur` exit: the click selected the row and nothing moved.
// Intermittent exactly as reported, since it depends on where the user had
// scrolled to.
describe('scroll-to-selected after the user has already scrolled', () => {
  // The virtual window's start index for a DOM scroll position, as `_onScroll`
  // computes it (the 10 is the component's BUFFER_ROWS, which it does not export).
  // Positions sharing a start index are the ones that leave `_scrollTop` behind,
  // and each test asserts it gets the divergence it is about rather than assuming.
  const startIdxFor = (scrollTop: number, rowH: number): number =>
    Math.max(0, Math.floor(Math.max(0, scrollTop - rowH) / rowH) - 10);

  async function mounted(): Promise<{ table: DexTreeTable; container: HTMLElement; rowH: number; usable: number }> {
    const rows: TreeTableRow[] = [makeRow('S', null, 'Sec')];
    for (let i = 0; i < 500; i++) rows.push(makeRow('S/' + i, 'S', 'row' + i));
    const table = new DexTreeTable();
    document.body.appendChild(table);
    table.rows = rows;
    (table as any)._expandedIds = new Set(['S']);
    (table as any)._visibleRowsCache = null;
    await table.updateComplete;
    // After the first update: `firstUpdated` writes the measured height, which
    // happy-dom reports as 0, over anything set before it.
    (table as any)._viewportHeight = 400;
    await table.updateComplete;
    const container = table.shadowRoot!.querySelector('.table-container') as HTMLElement;
    const rowH = (table as any)._rowH as number;
    // The sticky header covers the top row's worth of the viewport.
    return { table, container, rowH, usable: 400 - rowH };
  }

  // Drive the component the way the browser does: move the DOM, then let the
  // scroll handler see it. Nothing else may set `_scrollTop` here — the staleness
  // this test needs is the handler's own doing.
  async function userScrollsTo(table: DexTreeTable, container: HTMLElement, y: number): Promise<void> {
    container.scrollTop = y;
    container.dispatchEvent(new Event('scroll'));
    await table.updateComplete;
  }

  async function reveal(table: DexTreeTable, rowId: string): Promise<void> {
    table.selectedRowIds = [rowId];
    await table.updateComplete;
    // Let the queued updateComplete.then chain (window state → DOM sync) settle.
    await new Promise((r) => setTimeout(r, 0));
    await table.updateComplete;
  }

  it('scrolls UP to a row above the window that the stale value thought was in view', async () => {
    const { table, container, rowH, usable } = await mounted();
    // Eleven rows down: still inside the first slice (start index clamped to 0),
    // so the handler repositions the rows table and returns.
    const y = 11 * rowH;
    expect(startIdxFor(y, rowH)).toBe(0);
    await userScrollsTo(table, container, y);
    expect((table as any)._scrollTop).toBe(0); // the divergence, as the component produces it

    // A row now off the TOP of the view — but one that the stale 0 places
    // comfortably inside it, which is what silenced the reveal.
    const idx = 2;
    const top = idx * rowH;
    expect(top).toBeLessThan(container.scrollTop); // above the real window
    expect(top + rowH).toBeLessThanOrEqual(0 + usable); // "in view" per the stale value

    await reveal(table, 'S/' + (idx - 1));

    // The row the user asked for is on screen. Asserted as the invariant rather
    // than an exact scroll position, because clamping at the list's start decides
    // that number and centering doesn't.
    expect(container.scrollTop).toBeLessThanOrEqual(top);
    expect(top + rowH).toBeLessThanOrEqual(container.scrollTop + usable);
    expect(table.shadowRoot!.querySelector(`tr[data-row-id="S/${idx - 1}"]`)).not.toBeNull();
  });

  it('scrolls DOWN to a row below the window when the stale value is the higher one', async () => {
    const { table, container, rowH, usable } = await mounted();
    // The divergence runs both ways. Land in a later slice so `_scrollTop` is
    // written, come back into the first one (a different start index, so it is
    // written again), then scroll to the very top — which shares that start index
    // and so leaves `_scrollTop` pointing at where the table USED to be.
    await userScrollsTo(table, container, 13 * rowH);
    expect(startIdxFor(13 * rowH, rowH)).toBeGreaterThan(0);
    await userScrollsTo(table, container, 11 * rowH);
    expect((table as any)._scrollTop).toBe(11 * rowH);
    await userScrollsTo(table, container, 0);
    expect(container.scrollTop).toBe(0);
    expect((table as any)._scrollTop).toBe(11 * rowH);

    // Off the BOTTOM of the real view, and inside the window the stale value
    // describes.
    const idx = Math.floor(usable / rowH) + 4;
    const top = idx * rowH;
    expect(top + rowH).toBeGreaterThan(usable); // below the real window
    expect(top).toBeGreaterThanOrEqual(11 * rowH); // "in view" per the stale value
    expect(top + rowH).toBeLessThanOrEqual(11 * rowH + usable);

    await reveal(table, 'S/' + (idx - 1));

    expect(container.scrollTop).toBeLessThanOrEqual(top);
    expect(top + rowH).toBeLessThanOrEqual(container.scrollTop + usable);
    expect(table.shadowRoot!.querySelector(`tr[data-row-id="S/${idx - 1}"]`)).not.toBeNull();
  });

  it('leaves a row that really is in view exactly where it is', async () => {
    // The other half of the rule, and what stops the fix from being "always
    // scroll": a Usage link to a row already on screen must not jerk the table
    // to center it. This is also the case the buggy comparison got right by
    // accident, so without it a regression could pass by scrolling every time.
    const { table, container, rowH } = await mounted();
    await userScrollsTo(table, container, 11 * rowH);
    const idx = 12; // one row into the visible band at scrollTop = 11 rows
    await reveal(table, 'S/' + (idx - 1));
    expect(container.scrollTop).toBe(11 * rowH);
  });
});
