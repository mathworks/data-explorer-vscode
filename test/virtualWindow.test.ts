// Copyright 2026 The MathWorks, Inc.
//
// THE WINDOWING RULE, ONCE.
//
// dex-tree-table has rendered only the rows near the scroll position since long
// before this file: a spacer the height of every row, a slice of real rows laid on
// top of it at the right offset. dex-matrix-grid did not, and a 1000x1000 double
// therefore built a million cells and 7.5 million DOM nodes — ten and a half
// seconds of frozen webview for a panel 640px wide, which can show about sixteen
// columns of it.
//
// The obvious move was to copy the table's arithmetic into the grid. That is the
// defect this repo keeps relearning (see one-rule-two-paths): a rule implemented
// twice drifts, and an off-by-one in a virtual window does not show up as a wrong
// number — it shows up as a row that is simply not there, which reads as missing
// data. So the arithmetic lives here, once, and is called three times: the table's
// rows, the grid's rows, and the grid's columns.
//
// Being a pure function of five numbers, it is also the only part of windowing that
// CAN be tested without a layout engine — happy-dom reports every height as zero.
// What the function does with that is itself a case below.
import { describe, it, expect } from 'vitest';
import { virtualWindow } from '../src/webview/virtualWindow.js';

describe('a run that fits', () => {
  it('is rendered whole, with no padding either side', () => {
    const w = virtualWindow({ items: 5, itemSize: 20, scroll: 0, viewport: 400, buffer: 2 });
    expect(w).toEqual({ start: 0, count: 5, before: 0, after: 0, span: 100 });
  });

  it('is rendered whole even when the buffer alone would cover it', () => {
    const w = virtualWindow({ items: 3, itemSize: 20, scroll: 0, viewport: 20, buffer: 10 });
    expect(w.start).toBe(0);
    expect(w.count).toBe(3);
  });
});

describe('a run longer than the viewport', () => {
  // 1000 items of 20px in a 200px viewport: ten visible, plus the buffer each side.
  const long = (scroll: number, buffer = 4) =>
    virtualWindow({ items: 1000, itemSize: 20, scroll, viewport: 200, buffer });

  // The viewport's ten, a buffer each side, and one more for the item a scroll of
  // less than a whole item leaves straddling the bottom edge. That last one is not
  // slack: see 'covers the bottom edge with no buffer at all' below, which is the
  // case that cannot pass without it.
  const SLICE = 10 + 4 * 2 + 1;

  it('renders the viewport plus the buffer on both sides, and no more', () => {
    const w = long(0);
    expect(w.start).toBe(0);
    expect(w.count).toBe(SLICE);
    expect(w.before).toBe(0);
  });

  it('keeps the buffer ahead of the slice once scrolled into the middle', () => {
    const w = long(20 * 100); // item 100 is at the top of the viewport
    expect(w.start).toBe(100 - 4);
    expect(w.count).toBe(SLICE);
  });

  it('pads for exactly the items it did not render', () => {
    const w = long(20 * 100);
    expect(w.before).toBe(w.start * 20);
    expect(w.after).toBe((1000 - w.start - w.count) * 20);
    // The three together are the whole run — the invariant that keeps the
    // scrollbar the right length and the slice under the pointer.
    expect(w.before + w.count * 20 + w.after).toBe(w.span);
    expect(w.span).toBe(1000 * 20);
  });

  it('renders the tail, and nothing past it, at the bottom', () => {
    const w = long(20 * 1000); // scrolled to the very end
    expect(w.start + w.count).toBe(1000);
    expect(w.after).toBe(0);
    expect(w.count).toBeGreaterThan(0);
  });

  it('still renders something when the scroll is past the end entirely', () => {
    // Reachable for real: the cells arrive after the panel is already scrolled,
    // or a shorter matrix replaces a longer one in the same grid instance.
    const w = long(20 * 5000);
    expect(w.count).toBeGreaterThan(0);
    expect(w.start + w.count).toBe(1000);
  });
});

describe('what it does with numbers a layout engine did not give it', () => {
  // happy-dom reports 0 for every clientHeight and a real panel measures 0 while it is
  // still display:none, so a window computed before anything has been laid out is the
  // ordinary case and not an edge one. A viewport of zero is what both callers really
  // pass on their first frame; an item size of zero they substitute away, and the two
  // cases below say what the function does with it anyway, because a pure function
  // that is silent about part of its domain gets a different answer per caller.

  it('renders everything when the item size is unknown', () => {
    // An item of no size has no position to be near, so there is no window to
    // compute. Of the two answers, a slow render beats a panel that stays blank until
    // something unrelated happens to trigger the next update.
    const w = virtualWindow({ items: 40, itemSize: 0, scroll: 0, viewport: 0, buffer: 4 });
    expect(w).toEqual({ start: 0, count: 40, before: 0, after: 0, span: 0 });
  });

  it('renders everything when the item size is negative', () => {
    const w = virtualWindow({ items: 7, itemSize: -20, scroll: 0, viewport: 100, buffer: 1 });
    expect(w.count).toBe(7);
  });

  it('renders the buffer when the viewport has no height yet', () => {
    const w = virtualWindow({ items: 1000, itemSize: 20, scroll: 0, viewport: 0, buffer: 4 });
    expect(w.start).toBe(0);
    // One screen's worth is unknowable, so the buffer is the whole answer; it must
    // still be more than nothing.
    expect(w.count).toBeGreaterThanOrEqual(8);
    expect(w.count).toBeLessThan(1000);
  });

  it('treats a negative scroll as the top, the way overscroll reports it', () => {
    expect(virtualWindow({ items: 1000, itemSize: 20, scroll: -300, viewport: 200, buffer: 4 }).start).toBe(0);
  });

  it('treats a non-finite scroll as the top', () => {
    expect(virtualWindow({ items: 1000, itemSize: 20, scroll: NaN, viewport: 200, buffer: 4 }).start).toBe(0);
  });

  it('is an empty window for an empty run', () => {
    expect(virtualWindow({ items: 0, itemSize: 20, scroll: 0, viewport: 200, buffer: 4 })).toEqual({
      start: 0,
      count: 0,
      before: 0,
      after: 0,
      span: 0,
    });
  });

  it('is an empty window for a negative run', () => {
    expect(virtualWindow({ items: -5, itemSize: 20, scroll: 0, viewport: 200, buffer: 4 }).count).toBe(0);
  });
});

describe('the slice always covers what is on screen', () => {
  // The property that matters, asserted over the whole scroll range rather than at
  // the handful of positions a human would think to pick. A window that fails this
  // shows a gap, and a gap in a virtual list is indistinguishable from absent data.
  const covers = (buffer: number) => {
    const items = 997; // prime, so no offset divides evenly and lands on a boundary
    const itemSize = 19;
    const viewport = 211; // not a multiple of 19, so an item always straddles an edge
    for (let scroll = 0; scroll <= items * itemSize; scroll += 7) {
      const w = virtualWindow({ items, itemSize, scroll, viewport, buffer });
      const firstVisible = Math.min(items - 1, Math.floor(scroll / itemSize));
      const lastVisible = Math.min(items - 1, Math.floor((scroll + viewport) / itemSize));
      expect(w.start).toBeLessThanOrEqual(firstVisible);
      expect(w.start + w.count).toBeGreaterThan(lastVisible);
      expect(w.before + w.count * itemSize + w.after).toBe(w.span);
    }
  };

  it('contains every item visible at every scroll position of a long run', () => {
    covers(3);
  });

  it('covers the bottom edge with no buffer at all', () => {
    // The case a buffer hides: with nothing spare, a viewport scrolled off an item
    // boundary shows part of one more item than it is tall, and the window has to
    // include it. This is what the `+ 1` in the count is for; without it the last
    // visible row is blank at nearly every scroll position, and a blank row in a
    // virtual grid reads as a hole in the data.
    covers(0);
  });
});
