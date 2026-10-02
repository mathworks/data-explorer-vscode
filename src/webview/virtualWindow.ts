// Copyright 2026 The MathWorks, Inc.
//
// Which items of a long uniform run are worth putting in the DOM.
//
// Both tables here render only what is near the scroll position: dex-tree-table for
// its rows (1,275 of them in the dictionary that prompted this), dex-matrix-grid for
// its rows AND its columns — a 1000x1000 double is a million cells and 7.5 million
// nodes rendered in full, for a panel 640px wide that can show about sixteen of
// those columns at a time.
//
// The arithmetic is the same arithmetic in all three places, so it is here once.
// Copying it into the grid was the alternative, and a rule implemented twice is the
// defect this codebase keeps relearning: the two copies drift, and an off-by-one in
// a virtual window does not surface as a wrong number but as an item that is simply
// not there, which reads as missing data rather than as a bug.
//
// Everything is in CSS pixels, and the caller is trusted to render `count` items at
// exactly `itemSize` each — the padding either side is computed from that figure, so
// an item that lays out taller than claimed shifts the whole run under the pointer.
// Both callers pin the size (`table-layout: fixed` with one width, a fixed row
// height) rather than letting content decide it, for that reason.
export interface VirtualWindowSpec {
  /** How many items the run holds in total. */
  items: number;
  /** The size of ONE item along the axis being windowed. */
  itemSize: number;
  /** The scroll container's offset along that axis. */
  scroll: number;
  /** How much of the axis is on screen. */
  viewport: number;
  /** Items to render either side of the viewport, so a scroll of a few pixels
   *  does not have to render before it can paint. */
  buffer: number;
}

export interface VirtualWindow {
  /** Index of the first item to render. */
  start: number;
  /** How many to render, from `start`. */
  count: number;
  /** Padding to leave ahead of the slice, in px. */
  before: number;
  /** Padding to leave behind it, in px. */
  after: number;
  /** What the whole run occupies, in px: `before + count * itemSize + after`. */
  span: number;
}

const EMPTY: VirtualWindow = { start: 0, count: 0, before: 0, after: 0, span: 0 };

// A finite number at least `min`, for inputs that come from a layout engine. A
// scroll offset reads negative during overscroll on macOS and NaN from a detached
// element, and either one would otherwise propagate into a negative start index.
const atLeast = (n: number, min: number): number => (Number.isFinite(n) && n > min ? n : min);

export function virtualWindow({ items, itemSize, scroll, viewport, buffer }: VirtualWindowSpec): VirtualWindow {
  const total = Math.max(0, Math.floor(atLeast(items, 0)));
  if (total === 0) {
    return EMPTY;
  }
  const size = atLeast(itemSize, 0);
  if (size === 0) {
    // An item of no size has no window: every index is at offset zero, so there is no
    // scroll position to be near. Neither caller passes this — both substitute an
    // assumed size while nothing has been laid out yet, precisely so that the first
    // frame of a million-cell grid is still a window. It is defined here because the
    // function has to answer for its whole domain, and of the two answers available
    // this is the harmless one: a whole short run is a slow render, a whole long run
    // is a slow render, and rendering nothing is a panel that stays blank until
    // something unrelated triggers the next update.
    return { start: 0, count: total, before: 0, after: 0, span: 0 };
  }
  const pad = Math.max(0, Math.floor(atLeast(buffer, 0)));
  // Clamped to the last item: the cells can arrive at a grid that is already
  // scrolled, and a shorter matrix can replace a longer one in the same instance.
  // Either way a start index past the end must still render the tail rather than
  // an empty window the user cannot scroll out of.
  const start = Math.min(total - 1, Math.max(0, Math.floor(atLeast(scroll, 0) / size) - pad));
  // `ceil` and not `floor`: a viewport 1.5 items tall shows parts of two, and the
  // partly-visible one at the bottom edge is the one a reader notices missing.
  const onScreen = Math.ceil(atLeast(viewport, 0) / size);
  const count = Math.min(total - start, onScreen + pad * 2 + 1);
  return {
    start,
    count,
    before: start * size,
    after: (total - start - count) * size,
    span: total * size,
  };
}
