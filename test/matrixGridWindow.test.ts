// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// THE MINI TABLE RENDERS A WINDOW, ON BOTH AXES.
//
// dex-matrix-grid used to render every cell of a page. For the 1000x1000 double in
// a customer's dictionary that is a million cells and 7.5 million DOM nodes, which
// measured ten and a half seconds of frozen webview and 642 MB — to fill a panel
// capped at 640x320, which can show about sixteen columns and sixteen rows of it.
//
// So it now renders the window near the scroll position and pads the rest, by the
// same rule dex-tree-table has always used for its rows (src/webview/virtualWindow.ts,
// pinned in virtualWindow.test.ts). Both axes, because windowing rows alone would
// still build a thousand cells per row — a 40x improvement where the panel's own
// width says the honest figure is a thousand.
//
// WHY THE SIZES ARE SET HERE AND NOT MEASURED: happy-dom lays nothing out and reports
// every width as zero, so the grid falls back to its default geometry — which windows
// correctly but by figures this file would then have to restate, pinning the defaults
// instead of the rule. The seam is the one dex-tree-table already has: CSS custom
// properties that win over the measurement. The real measured path is qualified in a
// real browser by the harness scenario.
//
// Every matrix here is deliberately small. A test that reached for 1000x1000 to
// prove the point would, on a regression, render a million cells and exhaust the
// worker's heap — taking the readable failure down with it. 40x40 fails an
// assertion instead.
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/webview/components/dex-matrix-grid.js';
import type { DexMatrixGrid, MatrixPayload } from '../src/webview/components/dex-matrix-grid.js';

const ROW_H = 20;
const COL_W = 50;
const HEADER_W = 30;
// Must match GRID_BUFFER in dex-matrix-grid.ts. Not imported: the test asserting a
// window of nine would pass for any buffer if it read the buffer from the code.
const BUFFER = 4;
// With no measurable viewport, a window is the buffer either side plus the straddling
// item — see virtualWindow.ts. Nine, on each axis.
const WINDOW = BUFFER * 2 + 1;

function payload(dims: number[], over: Partial<MatrixPayload> = {}): MatrixPayload {
  const n = dims.reduce((a, b) => a * b, 1);
  const cells = new Array<string>(n);
  for (let i = 0; i < n; i++) cells[i] = String(i + 1);
  return { name: 'A', className: 'double', dims, nodeId: 'n1', cells, ...over };
}

async function makeGrid(m: MatrixPayload): Promise<DexMatrixGrid> {
  const el = document.createElement('dex-matrix-grid') as DexMatrixGrid;
  el.style.setProperty('--dex-matrix-row-height', `${ROW_H}px`);
  el.style.setProperty('--dex-matrix-col-width', `${COL_W}px`);
  el.style.setProperty('--dex-matrix-rowheader-width', `${HEADER_W}px`);
  document.body.append(el);
  el.matrix = m;
  await el.updateComplete;
  return el;
}

const sr = (el: DexMatrixGrid) => el.shadowRoot!;
const cells = (el: DexMatrixGrid) => Array.from(sr(el).querySelectorAll('[role="gridcell"]'));
const rowHeaders = (el: DexMatrixGrid) => Array.from(sr(el).querySelectorAll('[role="rowheader"]'));
const colHeaders = (el: DexMatrixGrid) => Array.from(sr(el).querySelectorAll('[role="columnheader"]'));
const scrollBox = (el: DexMatrixGrid) => sr(el).querySelector('.scroll') as HTMLElement;
const at = (el: DexMatrixGrid, i: number) => {
  const c = cells(el)[i];
  return { r: c.getAttribute('aria-rowindex'), c: c.getAttribute('aria-colindex'), text: c.textContent?.trim() };
};

async function scrollTo(el: DexMatrixGrid, top: number, left = 0): Promise<void> {
  const box = scrollBox(el);
  box.scrollTop = top;
  box.scrollLeft = left;
  box.dispatchEvent(new Event('scroll'));
  await el.updateComplete;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('a matrix larger than the window', () => {
  it('renders the window and not the matrix', () => {
    return makeGrid(payload([40, 40])).then((el) => {
      expect(cells(el).length).toBe(WINDOW * WINDOW);
    });
  });

  it('still tells assistive tech how big the matrix really is', async () => {
    const el = await makeGrid(payload([40, 40]));
    const grid = sr(el).querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-rowcount')).toBe('40');
    expect(grid.getAttribute('aria-colcount')).toBe('40');
  });

  it('labels every rendered cell with its TRUE position, not its place in the window', async () => {
    // The failure this prevents is the quiet one: a window whose cells are indexed
    // from the slice shows the right numbers in the wrong places, and A(1,1) then
    // names whatever happens to be at the top left.
    const el = await makeGrid(payload([40, 40]));
    await scrollTo(el, ROW_H * 20, COL_W * 10);
    const first = at(el, 0);
    expect(first.r).toBe(String(20 - BUFFER + 1));
    expect(first.c).toBe(String(10 - BUFFER + 1));
    // Row-major within the page, so the cell at (r,c) is r*40 + c + 1.
    expect(first.text).toBe(String((20 - BUFFER) * 40 + (10 - BUFFER) + 1));
    expect(cells(el)[0].getAttribute('aria-label')).toBe(`A(${20 - BUFFER + 1},${10 - BUFFER + 1})`);
  });

  it('pads for exactly the rows and columns it left out', async () => {
    const el = await makeGrid(payload([40, 40]));
    await scrollTo(el, ROW_H * 20, COL_W * 10);
    const before = sr(el).querySelector('.pad-top') as HTMLElement;
    const after = sr(el).querySelector('.pad-bottom') as HTMLElement;
    const left = sr(el).querySelector('.pad-left') as HTMLElement;
    expect(before.style.height).toBe(`${(20 - BUFFER) * ROW_H}px`);
    expect(after.style.height).toBe(`${(40 - (20 - BUFFER) - WINDOW) * ROW_H}px`);
    expect(left.style.width).toBe(`${(10 - BUFFER) * COL_W}px`);
  });

  it('keeps the row numbers with their rows when scrolled sideways', async () => {
    // The row header is the first column, so a windowed column axis would take it
    // away the moment the view scrolled past column one — leaving a grid of numbers
    // with nothing saying which row is which. It is rendered outside the window.
    const el = await makeGrid(payload([40, 40]));
    await scrollTo(el, 0, COL_W * 20);
    expect(rowHeaders(el).length).toBe(WINDOW);
    expect(rowHeaders(el)[0].textContent?.trim()).toBe('1');
  });

  it('heads the window with the true column numbers', async () => {
    const el = await makeGrid(payload([40, 40]));
    await scrollTo(el, 0, COL_W * 20);
    // The corner cell is a columnheader too, so the numbered ones follow it.
    const numbered = colHeaders(el).slice(1).map((h) => h.textContent?.trim());
    expect(numbered[0]).toBe(String(20 - BUFFER + 1));
    expect(numbered.length).toBe(WINDOW);
  });

  it('hides its padding from assistive tech', async () => {
    const el = await makeGrid(payload([40, 40]));
    // A screen reader walking a grid must find rows and cells, not the scaffolding
    // that holds the scrollbar's length. aria-rowcount already told it the extent.
    const pads = Array.from(sr(el).querySelectorAll('.pad-top, .pad-bottom, .pad-left, .pad-right'));
    // Counted first: `for (const p of [])` asserts nothing, and a padding element
    // that was renamed would pass this test by being absent.
    expect(pads.length).toBeGreaterThanOrEqual(4);
    for (const p of pads) {
      expect(p.getAttribute('role')).toBe('presentation');
    }
  });

  it('moves the window when the view scrolls', async () => {
    const el = await makeGrid(payload([40, 40]));
    const firstAtTop = at(el, 0);
    await scrollTo(el, ROW_H * 30);
    expect(at(el, 0).r).not.toBe(firstAtTop.r);
    expect(at(el, 0).r).toBe(String(30 - BUFFER + 1));
  });

  it('renders the tail when scrolled to the end, and nothing past it', async () => {
    const el = await makeGrid(payload([40, 40]));
    await scrollTo(el, ROW_H * 40);
    const last = cells(el)[cells(el).length - 1];
    expect(last.getAttribute('aria-rowindex')).toBe('40');
    expect((sr(el).querySelector('.pad-bottom') as HTMLElement).style.height).toBe('0px');
  });
});

describe('arrow keys reach a cell outside the window', () => {
  const press = async (el: DexMatrixGrid, key: string, times = 1) => {
    const grid = sr(el).querySelector('[role="grid"]')!;
    for (let i = 0; i < times; i++) {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
    }
    await el.updateComplete;
  };

  it('brings the row into the window and focuses it', async () => {
    // Without this the cursor walks off the end of what was rendered and focus
    // lands on nothing — the grid stops responding to the keyboard entirely, which
    // is how a virtualized grid breaks for a keyboard-only user.
    const el = await makeGrid(payload([40, 40]));
    await press(el, 'ArrowDown', 12);
    const focused = sr(el).activeElement;
    expect(focused?.getAttribute('aria-label')).toBe('A(13,1)');
  });

  it('brings the column into the window and focuses it', async () => {
    const el = await makeGrid(payload([40, 40]));
    await press(el, 'ArrowRight', 12);
    expect(sr(el).activeElement?.getAttribute('aria-label')).toBe('A(1,13)');
  });

  it('follows End to the last column of a wide matrix', async () => {
    const el = await makeGrid(payload([40, 40]));
    await press(el, 'End');
    expect(sr(el).activeElement?.getAttribute('aria-label')).toBe('A(1,40)');
  });
});

describe('a matrix that fits', () => {
  // The continuity case: windowing must be invisible for the ordinary matrix, which
  // is nearly every matrix. Nothing below is new behaviour — it is the behaviour
  // the other 26 tests in variableEditorGrid.test.ts assert, restated here against
  // a grid whose sizes ARE known, so that a window computed one item too small
  // fails here rather than in all of them at once.
  it('renders every cell', async () => {
    const el = await makeGrid(payload([3, 4]));
    expect(cells(el).length).toBe(12);
    expect(at(el, 0).text).toBe('1');
    expect(at(el, 11).text).toBe('12');
  });

  it('pads by nothing at all', async () => {
    const el = await makeGrid(payload([3, 4]));
    for (const cls of ['.pad-top', '.pad-bottom']) {
      expect((sr(el).querySelector(cls) as HTMLElement).style.height).toBe('0px');
    }
    for (const cls of ['.pad-left', '.pad-right']) {
      expect((sr(el).querySelector(cls) as HTMLElement).style.width).toBe('0px');
    }
  });

  it('renders every cell of a matrix exactly the size of the window', async () => {
    const el = await makeGrid(payload([WINDOW, WINDOW]));
    expect(cells(el).length).toBe(WINDOW * WINDOW);
    expect(at(el, WINDOW * WINDOW - 1).r).toBe(String(WINDOW));
  });
});

describe('a column is one fixed width, so a cell can be too long for it', () => {
  // The consequence of windowing columns: a column cannot size itself to its content,
  // because the padding beside the window is a count of columns times ONE width. So a
  // cell that does not fit is cut, and the full text has to be reachable some other way.
  const withWidth = async (w: number, cells: string[]): Promise<DexMatrixGrid> => {
    const el = document.createElement('dex-matrix-grid') as DexMatrixGrid;
    el.style.setProperty('--dex-matrix-row-height', `${ROW_H}px`);
    el.style.setProperty('--dex-matrix-col-width', `${w}px`);
    document.body.append(el);
    el.matrix = { name: 'A', className: 'cell', dims: [1, cells.length], nodeId: 'n1', cells };
    await el.updateComplete;
    return el;
  };

  it('offers the full text on hover when the column is at its limit', async () => {
    // 240px is the cap: a column only reaches it because the widest cell wanted more,
    // which is the one case where what is on screen is not the whole value.
    const el = await withWidth(240, ['a very long string indeed', 'b']);
    expect(cells(el)[0].getAttribute('title')).toBe('a very long string indeed');
  });

  it('adds no tooltip to a grid where everything fits', async () => {
    // Numbers never reach the cap, so titling every cell would hang a one-second hover
    // delay and a second copy of the number on a grid that is hiding nothing.
    const el = await withWidth(COL_W, ['1', '2', '3']);
    for (const c of cells(el)) {
      expect(c.hasAttribute('title')).toBe(false);
    }
  });
});

describe('with nothing measured and no sizes given', () => {
  // The state a real panel is in on its FIRST frame: the probe that measures a cell
  // cannot be measured until it has been rendered, so the first window is always
  // computed from nothing. That frame is the whole point of the exercise — it is the
  // one that used to build a million cells — so it must already be windowed, which
  // means the grid has to assume a cell size rather than treat zero as "unknown".
  const unsized = async (dims: number[]): Promise<DexMatrixGrid> => {
    const el = document.createElement('dex-matrix-grid') as DexMatrixGrid;
    document.body.append(el);
    el.matrix = payload(dims);
    await el.updateComplete;
    return el;
  };

  it('windows anyway, rather than rendering the matrix', async () => {
    const el = await unsized([400, 400]);
    const n = sr(el).querySelectorAll('[role="gridcell"]').length;
    expect(n).toBeGreaterThan(0);
    // Not a figure: the assumed size is free to change. What may never change is
    // that an unmeasured first frame is a window and not 160,000 cells.
    expect(n).toBeLessThan(400 * 400);
  });

  it('still renders a small matrix whole', async () => {
    // The assumed size must not be so generous that an ordinary matrix comes out
    // clipped — a window short by a row shows a hole, and nothing measures itself
    // before it has been rendered once.
    const el = await unsized([3, 4]);
    expect(sr(el).querySelectorAll('[role="gridcell"]').length).toBe(12);
  });
});
