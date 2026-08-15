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
import { DexTreeTable, type TreeTableRow } from '../src/dex/components/dex-tree-table.js';

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
    // happy-dom has no layout engine: clientHeight is 0. Simulate a laid-out
    // panel so the virtual-window math has a real viewport height to work with
    // (in the extension, a ResizeObserver keeps _viewportHeight in sync).
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
