// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Virtual scrolling and the row-flash affordance. A real .sldd can hold tens of
// thousands of entries, so only a window of rows is ever in the DOM. Everything
// the user sees therefore depends on the window arithmetic being right: get the
// offset wrong and rows appear at the wrong height or blank out mid-scroll, and
// a row scrolled to by the host can fail to render at all.
//
// happy-dom has no layout engine (clientHeight is 0, getBoundingClientRect is
// all zeros), so these tests set the measured viewport height explicitly. The
// component is written for exactly that case — it falls back to the tracked
// height when the container has not been laid out — but a genuine end-to-end
// check of painted geometry needs a real browser.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const ROW_H = 26; // DEFAULT_ROW_HEIGHT; the header occupies one row of the same height

function makeRow(id: string, name = id): TreeTableRow {
  return { ID: id, parent: null, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '' };
}

async function mountLarge(count = 300, viewportHeight = 260): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType', 'Status'];
  document.body.appendChild(table);
  const rows: TreeTableRow[] = [];
  for (let i = 0; i < count; i++) rows.push(makeRow('r' + i));
  table.rows = rows;
  await table.updateComplete;
  (table as any)._viewportHeight = viewportHeight;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const renderedIds = (table: DexTreeTable): string[] =>
  Array.from(table.shadowRoot!.querySelectorAll('tr.data-row')).map((el) => el.getAttribute('data-row-id')!);

async function scrollTo(table: DexTreeTable, top: number): Promise<void> {
  const container = (table as any)._container as HTMLElement;
  container.scrollTop = top;
  container.dispatchEvent(new Event('scroll', { bubbles: true }));
  await table.updateComplete;
}

// Scrolling to a host-set selection takes two renders: the first settles the
// layout so the row index can be measured, and only then is the scroll offset
// set — which schedules the render that actually paints the new window. Waiting
// on microtasks alone stops after the offset is set but before those rows exist,
// so wait for a macrotask, the way a browser frame would.
async function settle(table: DexTreeTable): Promise<void> {
  await table.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await table.updateComplete;
}

describe('only a window of rows is rendered', () => {
  it('a huge document puts a small slice in the DOM, not every row', async () => {
    // 30,000 <tr> elements would take seconds to lay out and stall the webview.
    const table = await mountLarge(3000);
    const count = renderedIds(table).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(60);
    table.remove();
  });

  it('the scrollable area is sized for every row, so the scrollbar is honest', async () => {
    // The spacer is what tells the browser how tall the list is; sizing it to the
    // rendered slice would give a scrollbar that jumps to the end after one drag.
    const table = await mountLarge(300);
    const spacer = table.shadowRoot!.querySelector('.virtual-spacer') as HTMLElement;
    expect(spacer.style.height).toBe(`${300 * ROW_H + ROW_H}px`);
    table.remove();
  });

  it('scrolling swaps in the rows for that offset', async () => {
    const table = await mountLarge(300);
    expect(renderedIds(table)[0]).toBe('r0');
    await scrollTo(table, ROW_H * 60);
    const ids = renderedIds(table);
    expect(ids).toContain('r60');
    expect(ids).not.toContain('r0');
    table.remove();
  });

  it('the rendered block is positioned at the offset its rows belong to', async () => {
    // The slice is absolutely positioned inside the spacer; a wrong top makes the
    // rows visibly detach from the scrollbar position.
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 60);
    const first = renderedIds(table)[0];
    const startIdx = Number(first.slice(1));
    const rowsTable = table.shadowRoot!.querySelector('.rows-table') as HTMLElement;
    expect(rowsTable.style.top).toBe(`${startIdx * ROW_H + ROW_H}px`);
    table.remove();
  });

  it('rows above and below the viewport are kept rendered as a buffer', async () => {
    // Without overscan a fast scroll shows blank space where rows have not been
    // rendered yet.
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 60);
    const ids = renderedIds(table);
    // Roughly ten rows either side of the ten-row viewport.
    expect(Number(ids[0].slice(1))).toBeLessThan(60);
    expect(Number(ids[ids.length - 1].slice(1))).toBeGreaterThan(69);
    table.remove();
  });

  it('a small scroll inside the current window repositions without a re-render', async () => {
    // Re-rendering on every scroll event would make dragging the scrollbar
    // stutter; within a window the component just moves the existing block.
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 60);
    const before = renderedIds(table);
    const startIdx = Number(before[0].slice(1));

    await scrollTo(table, ROW_H * 60 + 5);
    expect(renderedIds(table)).toEqual(before);
    const rowsTable = table.shadowRoot!.querySelector('.rows-table') as HTMLElement;
    expect(rowsTable.style.top).toBe(`${startIdx * ROW_H + ROW_H}px`);
    table.remove();
  });

  it('scrolling to the very end renders the last row', async () => {
    const table = await mountLarge(300);
    await scrollTo(table, 300 * ROW_H);
    expect(renderedIds(table)).toContain('r299');
    table.remove();
  });

  it('scrolling back to the top renders the first row again', async () => {
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 200);
    await scrollTo(table, 0);
    expect(renderedIds(table)[0]).toBe('r0');
    table.remove();
  });

  it('a taller panel renders more rows', async () => {
    // The window is sized from the measured height, so a maximized panel must not
    // leave the bottom half of the table blank.
    const short = await mountLarge(300, 130);
    const tall = await mountLarge(300, 780);
    expect(renderedIds(tall).length).toBeGreaterThan(renderedIds(short).length);
    short.remove();
    tall.remove();
  });

  it('a document that fits entirely in the panel renders every row', async () => {
    const table = await mountLarge(5, 400);
    expect(renderedIds(table)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    table.remove();
  });

  it('measures a row at --dex-row-height, which is what the rows are painted at', async () => {
    // One row height, two readers. The stylesheet paints every row at
    // var(--dex-row-height) — global.css ships 28px, and a theme or a density
    // setting can ship another — while the arithmetic here decides how tall the
    // scrollable area is and which slice of rows to put in it. If that arithmetic
    // read the rowHeight property instead, the two would disagree by a couple of
    // pixels per row, which compounds: a few hundred rows down, the slice the
    // scrollbar says you are looking at is a whole screen away from the rows on
    // screen. Every other case in this file runs with the variable unset, so this
    // is the only one that reads it at all.
    const table = await mountLarge(100);
    table.style.setProperty('--dex-row-height', '40px');
    table.requestUpdate();
    await table.updateComplete;
    const spacer = table.shadowRoot!.querySelector('.virtual-spacer') as HTMLElement;
    expect(spacer.style.height).toBe(`${100 * 40 + 40}px`);
    await scrollTo(table, 2000);
    // (2000 - 40 header) / 40 = row 49, less the 10-row buffer above it.
    expect(renderedIds(table)[0]).toBe('r39');
    table.remove();
  });
});

describe('scrolling a selected row into view', () => {
  it('a selection made by the host scrolls the row into the window', async () => {
    // The host selects a row when the user follows a link or a search result from
    // another panel; if the window never moves, that action appears to do nothing.
    const table = await mountLarge(300);
    table.selectedRowIds = ['r200'];
    await settle(table);
    expect(renderedIds(table)).toContain('r200');
    table.remove();
  });

  it('a row already comfortably in view is left where it is', async () => {
    // Re-centring on every selection would make arrowing down through rows jerk
    // the whole list on each keystroke.
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 60);
    const before = (table as any)._scrollTop;
    table.selectedRowIds = ['r65'];
    await settle(table);
    expect((table as any)._scrollTop).toBe(before);
    table.remove();
  });

  it('the row is centred rather than pinned to an edge', async () => {
    // Landing flush against the top or bottom hides the entry's neighbours, which
    // is exactly the context the user needs after jumping to it.
    const table = await mountLarge(300, 260);
    table.selectedRowIds = ['r150'];
    await settle(table);

    const scrollTop = (table as any)._scrollTop as number;
    const rowTop = 150 * ROW_H;
    const usable = 260 - ROW_H;
    expect(rowTop).toBeGreaterThan(scrollTop);
    expect(rowTop + ROW_H).toBeLessThan(scrollTop + usable);
    table.remove();
  });

  it('the scroll position is clamped at the ends of the list', async () => {
    // Centring the very first or last row would ask for a negative or overlong
    // scroll offset and leave blank space above or below the rows.
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 200);
    table.selectedRowIds = ['r0'];
    await settle(table);
    expect((table as any)._scrollTop).toBe(0);

    table.selectedRowIds = ['r299'];
    await settle(table);
    const max = 300 * ROW_H + ROW_H - 260;
    expect((table as any)._scrollTop).toBeLessThanOrEqual(max);
    expect(renderedIds(table)).toContain('r299');
    table.remove();
  });

  it('selecting a row that is not in the document does not move the view', async () => {
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 60);
    const before = (table as any)._scrollTop;
    table.selectedRowIds = ['does-not-exist'];
    await settle(table);
    expect((table as any)._scrollTop).toBe(before);
    table.remove();
  });

  it('clearing the selection does not scroll anywhere', async () => {
    const table = await mountLarge(300);
    await scrollTo(table, ROW_H * 60);
    const before = (table as any)._scrollTop;
    table.selectedRowIds = [];
    await settle(table);
    expect((table as any)._scrollTop).toBe(before);
    table.remove();
  });
});

describe('the copy/cut row flash', () => {
  it('flashes the row so the user can see which entry the action hit', async () => {
    // Copy and cut produce no other visible change; without the flash the user
    // cannot tell the command did anything.
    const table = await mountLarge(300);
    table.flashRow('r5');
    await table.updateComplete;
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const tr = table.shadowRoot!.querySelector('tr[data-row-id="r5"]') as HTMLElement;
    expect(tr.className).toContain('copy-flash');
    table.remove();
  });

  it('the flash class is removed when the animation ends, so it can flash again', async () => {
    const table = await mountLarge(300);
    table.flashRow('r5');
    await table.updateComplete;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const tr = table.shadowRoot!.querySelector('tr[data-row-id="r5"]') as HTMLElement;
    tr.dispatchEvent(new Event('animationend'));
    expect(tr.className).not.toContain('copy-flash');
    table.remove();
  });

  it('flashing a row outside the rendered window is a harmless no-op', async () => {
    // The row may be virtualized away; looking it up must not throw and take the
    // whole render down with it.
    const table = await mountLarge(300);
    table.flashRow('r250');
    await table.updateComplete;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(renderedIds(table).length).toBeGreaterThan(0);
    table.remove();
  });

  it('flashing an ID that is not in the document does not throw', async () => {
    const table = await mountLarge(300);
    table.flashRow('no-such-row');
    await table.updateComplete;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(renderedIds(table).length).toBeGreaterThan(0);
    table.remove();
  });
});

describe('the panel is remeasured as it resizes', () => {
  it('a resize observer is attached once the grid exists', async () => {
    // The first paint is often the empty state or a zero-height panel, so the
    // height cannot be measured in firstUpdated; without the observer the window
    // would stay at its default size and a tall panel would show blank space.
    const table = await mountLarge(300);
    expect((table as any)._resizeObserver).not.toBeNull();
    table.remove();
  });

  it('only one observer is created across many renders', async () => {
    // A fresh observer per render would pile up callbacks and thrash the layout.
    const table = await mountLarge(300);
    const first = (table as any)._resizeObserver;
    table.requestUpdate();
    await table.updateComplete;
    table.requestUpdate();
    await table.updateComplete;
    expect((table as any)._resizeObserver).toBe(first);
    table.remove();
  });

  // What the observer DOES when it fires. happy-dom's ResizeObserver never
  // delivers a callback and does not expose the one it was given, so the global is
  // swapped for a recorder that hands the callback back — the component's own
  // callback still runs, against a container whose height is stubbed in (happy-dom
  // has no layout, so clientHeight is otherwise always 0).
  describe('when the observer fires', () => {
    let restore: typeof globalThis.ResizeObserver;
    let fire: (() => void) | null;

    beforeEach(() => {
      restore = globalThis.ResizeObserver;
      fire = null;
      globalThis.ResizeObserver = class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof globalThis.ResizeObserver;
    });

    afterEach(() => {
      globalThis.ResizeObserver = restore;
    });

    function setHeight(table: DexTreeTable, h: number): void {
      Object.defineProperty((table as any)._container, 'clientHeight', { value: h, configurable: true });
    }

    it('adopts the measured height and renders a window that fills it', async () => {
      const table = await mountLarge(300, 0);
      expect(fire).not.toBeNull();
      setHeight(table, 520); // 20 rows of 26px
      fire!();
      await table.updateComplete;
      expect((table as any)._viewportHeight).toBe(520);
      // The window is the visible rows plus the overscan buffer, so a taller panel
      // renders strictly more rows — the point of remeasuring at all.
      expect(renderedIds(table).length).toBeGreaterThan(520 / ROW_H);
      table.remove();
    });

    it('ignores a zero height, so a collapsed panel does not shrink the window', async () => {
      // A hidden or collapsing panel measures 0. Adopting that would leave the
      // window empty, and it would stay empty after the panel came back if no
      // further resize arrived.
      const table = await mountLarge(300, 0);
      setHeight(table, 400);
      fire!();
      await table.updateComplete;
      setHeight(table, 0);
      fire!();
      await table.updateComplete;
      expect((table as any)._viewportHeight).toBe(400);
      table.remove();
    });

    it('a resize to the same height does not re-render', async () => {
      // The observer fires on any layout pass, not only on real size changes;
      // reassigning the same height would request a render every time.
      const table = await mountLarge(300, 0);
      setHeight(table, 400);
      fire!();
      await table.updateComplete;
      let renders = 0;
      const original = (table as any).requestUpdate.bind(table);
      (table as any).requestUpdate = (...args: unknown[]): void => {
        renders++;
        original(...args);
      };
      fire!();
      await table.updateComplete;
      expect(renders).toBe(0);
      table.remove();
    });

    it('a fire while the grid is gone is a no-op rather than a throw', async () => {
      // The empty state renders no `.table-container` at all, so the queried
      // container really does become null — and the observer is still live and
      // still observing the element it was given. A callback that arrives in that
      // window (the file reloads to zero entries, the panel reflows) must not
      // throw: an exception here escapes into the ResizeObserver callback, where
      // nothing in the webview can report it.
      const table = await mountLarge(300, 0);
      setHeight(table, 400);
      table.rows = [];
      await table.updateComplete;
      expect((table as any)._container).toBeFalsy();
      expect(() => fire!()).not.toThrow();
      table.remove();
    });
  });
});
