// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The 2-D grid inside the Variable Editor. Its whole job is to put element (r,c)
// of page k in the right box and to label it with the subscript MATLAB would
// use, so an off-by-one here is a confidently-wrong answer rather than a blank
// cell. The page arithmetic (dimension 3 varying fastest) is the part with no
// second source of truth in the DOM, so it is pinned hardest.
import { describe, it, expect, afterEach } from 'vitest';
import { DexMatrixGrid, type MatrixPayload } from '../src/webview/components/dex-matrix-grid.js';
import type { MatrixPayload as HostMatrixPayload } from '../src/host/matrixPayload.js';

let grid: DexMatrixGrid | null = null;

afterEach(() => {
  grid?.remove();
  grid = null;
});

async function makeGrid(matrix: MatrixPayload): Promise<DexMatrixGrid> {
  grid = new DexMatrixGrid();
  grid.matrix = matrix;
  document.body.appendChild(grid);
  await grid.updateComplete;
  return grid;
}

function payload(dims: number[], cells: string[], over: Partial<MatrixPayload> = {}): MatrixPayload {
  return { name: 'A', className: 'double', dims, cells, ...over };
}

// The grid's rendered contents, page by page, as row-major text rows.
function textRows(el: DexMatrixGrid): string[][] {
  return Array.from(el.shadowRoot!.querySelectorAll('[role="row"]'))
    .map((r) => Array.from(r.querySelectorAll('[role="gridcell"]')).map((c) => c.textContent!.trim()))
    .filter((r) => r.length > 0);
}

function cellEls(el: DexMatrixGrid): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>('[role="gridcell"]'));
}

function focusedCell(el: DexMatrixGrid): HTMLElement | null {
  return el.shadowRoot!.activeElement as HTMLElement | null;
}

function key(el: DexMatrixGrid, k: string): boolean {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  (focusedCell(el) ?? el).dispatchEvent(ev);
  return !ev.defaultPrevented;
}

describe('the payload type is one shape, mirrored not re-invented', () => {
  it('the host payload is assignable to the component payload', () => {
    // The webview does not import host modules at runtime (see dex-tree-table's
    // own TreeTableRow), so the interface is declared twice. This assignment is
    // what stops the two copies from drifting: it is a compile error if they do.
    const fromHost: HostMatrixPayload = { name: 'A', className: 'double', dims: [1, 2], cells: ['1', '2'] };
    const asComponent: MatrixPayload = fromHost;
    expect(asComponent.cells).toEqual(['1', '2']);
  });
});

describe('a 2-D matrix renders in reading order with MATLAB headers', () => {
  it('lays 2x3 out as two rows of three', async () => {
    const el = await makeGrid(payload([2, 3], ['1', '2', '3', '4', '5', '6']));
    expect(textRows(el)).toEqual([['1', '2', '3'], ['4', '5', '6']]);
  });

  it('numbers the column and row headers 1-based', async () => {
    const el = await makeGrid(payload([2, 3], ['1', '2', '3', '4', '5', '6']));
    const cols = Array.from(el.shadowRoot!.querySelectorAll('[role="columnheader"]'));
    expect(cols.map((c) => c.textContent!.trim())).toEqual(['', '1', '2', '3']);
    const rowHeads = Array.from(el.shadowRoot!.querySelectorAll('[role="rowheader"]'));
    expect(rowHeads.map((c) => c.textContent!.trim())).toEqual(['1', '2']);
  });

  it('carries the MATLAB subscript in aria-rowindex / aria-colindex', async () => {
    // Documented ARIA deviation: these normally count DOM rows including the
    // header. Here they carry the data subscript, because that is the number a
    // screen-reader user needs to match against the tree rows beside them.
    const el = await makeGrid(payload([2, 3], ['1', '2', '3', '4', '5', '6']));
    const last = cellEls(el)[5];
    expect(last.getAttribute('aria-rowindex')).toBe('2');
    expect(last.getAttribute('aria-colindex')).toBe('3');
    expect(last.getAttribute('aria-label')).toBe('A(2,3)');
  });

  it('right-aligns numbers and left-aligns anything else', async () => {
    const nums = await makeGrid(payload([1, 2], ['1', '-2.5e3']));
    expect(cellEls(nums)[0].classList.contains('num')).toBe(true);
    nums.remove();
    const strs = await makeGrid(payload([1, 2], ['"abc"', '"de"'], { className: 'string' }));
    expect(cellEls(strs)[0].classList.contains('num')).toBe(false);
  });

  it('treats a NaN/Inf column as numeric but an empty cell as not', async () => {
    const el = await makeGrid(payload([1, 3], ['NaN', 'Inf', '-Inf']));
    expect(cellEls(el)[0].classList.contains('num')).toBe(true);
    el.remove();
    const mixed = await makeGrid(payload([1, 2], ['1', '']));
    expect(cellEls(mixed)[0].classList.contains('num')).toBe(false);
  });

  it('shows no pager for a 2-D matrix', async () => {
    const el = await makeGrid(payload([2, 2], ['1', '2', '3', '4']));
    expect(el.pageCount).toBe(1);
    expect(el.shadowRoot!.querySelector('.pager')).toBeNull();
  });
});

describe('pages walk the trailing dimensions with dimension 3 fastest', () => {
  const nd = payload([2, 2, 2], ['1', '2', '3', '4', '5', '6', '7', '8']);

  it('shows page 1 first and counts the pages', async () => {
    const el = await makeGrid(nd);
    expect(el.pageCount).toBe(2);
    expect(textRows(el)).toEqual([['1', '2'], ['3', '4']]);
    expect(el.shadowRoot!.querySelector('.pager')).not.toBeNull();
  });

  it('shows the next page as the next contiguous window', async () => {
    const el = await makeGrid(nd);
    el.page = 1;
    await el.updateComplete;
    expect(textRows(el)).toEqual([['5', '6'], ['7', '8']]);
  });

  it('labels 2-D pages the MATLAB way', async () => {
    const el = await makeGrid(nd);
    expect(el.pageLabel(0)).toBe('(:,:,1)');
    expect(el.pageLabel(1)).toBe('(:,:,2)');
  });

  it('decomposes a rank-4 page index with dimension 3 varying fastest', async () => {
    const values = Array.from({ length: 24 }, (_, i) => String(i + 1));
    const el = await makeGrid(payload([2, 2, 2, 3], values));
    expect(el.pageCount).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((p) => el.pageLabel(p))).toEqual([
      '(:,:,1,1)', '(:,:,2,1)', '(:,:,1,2)', '(:,:,2,2)', '(:,:,1,3)', '(:,:,2,3)',
    ]);
    el.page = 2;                       // (:,:,1,2) — the 3rd window of 4
    await el.updateComplete;
    expect(textRows(el)).toEqual([['9', '10'], ['11', '12']]);
  });

  it('offers one option per page in the selector and switches on change', async () => {
    const el = await makeGrid(nd);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('.pager select')!;
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual(['(:,:,1)', '(:,:,2)']);
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(el.page).toBe(1);
    expect(textRows(el)).toEqual([['5', '6'], ['7', '8']]);
  });

  it('steps with the arrows and stops at both ends', async () => {
    const el = await makeGrid(nd);
    const [prev, next] = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.pager button'));
    expect(prev.disabled).toBe(true);
    next.click();
    await el.updateComplete;
    expect(el.page).toBe(1);
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(false);
  });

  it('clamps an out-of-range page rather than rendering undefined cells', async () => {
    const el = await makeGrid(nd);
    el.page = 99;
    await el.updateComplete;
    expect(el.page).toBe(1);
    expect(textRows(el)).toEqual([['5', '6'], ['7', '8']]);
    el.page = -3;
    await el.updateComplete;
    expect(el.page).toBe(0);
  });
});

describe('keyboard navigation is a roving tabindex over one focusable cell', () => {
  const m = payload([2, 3], ['1', '2', '3', '4', '5', '6']);

  it('makes exactly one cell tabbable and focuses it on demand', async () => {
    const el = await makeGrid(m);
    expect(cellEls(el).filter((c) => c.tabIndex === 0).length).toBe(1);
    el.focusActiveCell();
    expect(focusedCell(el)!.textContent!.trim()).toBe('1');
  });

  it('moves with the arrow keys and clamps at the edges', async () => {
    const el = await makeGrid(m);
    el.focusActiveCell();
    key(el, 'ArrowRight');
    await el.updateComplete;
    expect(focusedCell(el)!.textContent!.trim()).toBe('2');
    key(el, 'ArrowDown');
    await el.updateComplete;
    expect(focusedCell(el)!.textContent!.trim()).toBe('5');
    key(el, 'ArrowUp'); key(el, 'ArrowUp');           // clamps at row 1
    await el.updateComplete;
    expect(focusedCell(el)!.textContent!.trim()).toBe('2');
    key(el, 'ArrowLeft'); key(el, 'ArrowLeft');       // clamps at column 1
    await el.updateComplete;
    expect(focusedCell(el)!.textContent!.trim()).toBe('1');
  });

  it('jumps to the ends of the row with Home and End', async () => {
    const el = await makeGrid(m);
    el.focusActiveCell();
    key(el, 'End');
    await el.updateComplete;
    expect(focusedCell(el)!.textContent!.trim()).toBe('3');
    key(el, 'Home');
    await el.updateComplete;
    expect(focusedCell(el)!.textContent!.trim()).toBe('1');
  });

  it('pages with PageDown / PageUp and keeps the cursor cell', async () => {
    const el = await makeGrid(payload([2, 2, 2], ['1', '2', '3', '4', '5', '6', '7', '8']));
    el.focusActiveCell();
    key(el, 'ArrowRight');                            // (1,2) on page 1 -> '2'
    key(el, 'PageDown');
    await el.updateComplete;
    expect(el.page).toBe(1);
    expect(focusedCell(el)!.textContent!.trim()).toBe('6');   // same (1,2), page 2
    key(el, 'PageUp');
    await el.updateComplete;
    expect(el.page).toBe(0);
    expect(focusedCell(el)!.textContent!.trim()).toBe('2');
  });

  it('claims the keys it handles and leaves Escape alone', async () => {
    // Escape must reach the popover shell, which owns dismissal. If the grid
    // swallowed it the editor would become un-closable by keyboard.
    const el = await makeGrid(m);
    el.focusActiveCell();
    expect(key(el, 'ArrowRight')).toBe(false);        // preventDefault called
    expect(key(el, 'Escape')).toBe(true);             // untouched, free to bubble
    expect(key(el, 'a')).toBe(true);
  });

  it('resets the cursor and the page when a new matrix arrives', async () => {
    // The shell reuses one grid instance across openings. Without this, opening a
    // small matrix after a big one would focus a cell that no longer exists.
    const el = await makeGrid(payload([2, 2, 2], ['1', '2', '3', '4', '5', '6', '7', '8']));
    el.page = 1;
    key(el, 'ArrowRight');
    await el.updateComplete;
    el.matrix = payload([1, 2], ['9', '8']);
    await el.updateComplete;
    expect(el.page).toBe(0);
    expect(cellEls(el).filter((c) => c.tabIndex === 0).length).toBe(1);
    el.focusActiveCell();
    expect(focusedCell(el)!.textContent!.trim()).toBe('9');
  });
});

describe('degenerate payloads render nothing rather than throwing', () => {
  it('renders no grid for a null matrix', async () => {
    grid = new DexMatrixGrid();
    document.body.appendChild(grid);
    await grid.updateComplete;
    expect(grid.shadowRoot!.querySelector('[role="grid"]')).toBeNull();
    expect(grid.pageCount).toBe(1);
    expect(() => grid!.focusActiveCell()).not.toThrow();
  });

  it('renders a cell short payload as blanks instead of "undefined"', async () => {
    const el = await makeGrid(payload([1, 3], ['1', '2']));
    expect(textRows(el)).toEqual([['1', '2', '']]);
  });
});
