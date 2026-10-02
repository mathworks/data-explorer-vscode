// Copyright 2026 The MathWorks, Inc.
//
// The 2-D grid inside the Variable Editor. Given a MatrixPayload it renders one
// page at a time, headed by MATLAB's 1-based row/column numbers, with a page
// selector over the trailing dimensions when there is more than one page.
//
// It is deliberately dumb about CONTENT: the payload's `cells` are ALREADY in
// canonical row-major-within-page order (the host's matrixPayload.ts places them
// there by parsing each element's own subscript label, because core's element order
// differs by container kind). So this file does exactly one index computation,
// `page*d0*d1 + r*d1 + c`, and never asks what kind of array it is holding.
//
// It is not dumb about QUANTITY, because it cannot afford to be. A page of the
// 1000x1000 double this panel exists to show is a million cells; rendered in full
// that was 7.5 million DOM nodes, ten and a half seconds of frozen webview and
// 642 MB, to fill a box capped at 640x320 that can show about sixteen columns by
// sixteen rows of it. So only the window near the scroll position is built, on BOTH
// axes, and the rest is padding — the same rule dex-tree-table has always used for
// its rows, shared with it rather than copied (src/webview/virtualWindow.ts).
//
// Windowing columns is what forces the one visible change here: a column is now a
// FIXED width rather than `max-content`, because the padding either side of the
// window is `skipped * width` and that arithmetic needs a width it can trust. The
// width is measured once per matrix from the widest cell, so it is the width the
// old auto-layout would have given the widest column — applied to all of them, the
// way MATLAB's own Variable Editor lays a numeric grid out.
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { virtualWindow } from '../virtualWindow.js';

// Mirror of the host's MatrixDescriptor / MatrixPayload pair. Declared here rather
// than imported because webview components never import host modules — the same
// reason dex-property-inspector declares PropertyRow beside piBuilder's
// PIPropertyRow. test/variableEditorGrid.test.ts assigns both host types to these,
// so the two copies cannot drift without a compile error.
//
// The split is the fetch-on-open design. A row carries the DESCRIPTOR — enough to
// label the glyph and title the panel — and the cells are fetched by node id when a
// panel actually opens. A 1000x1000 entry is 4 MB of cell strings; stamped onto a
// row it is paid for every such row on screen, re-sort and repaint, for a panel that
// may never be opened. See src/host/matrixPayload.ts and src/webview/matrixOpen.ts.
export interface MatrixDescriptor {
  name: string;
  className: string;
  dims: number[];        // effectiveDims: length >= 2, no trailing singletons past dim 2
  nodeId: string;        // the ROW's node — what `requestMatrix` asks the host about
}

export interface MatrixPayload extends MatrixDescriptor {
  cells: string[];        // row-major within a page, pages in order; length = prod(dims)
}

// A cell is right-aligned only if EVERY cell in the matrix reads as a number, so
// one non-numeric entry keeps the whole column block left-aligned rather than
// producing a ragged mix. Inf/NaN count: they are numeric results, and MATLAB
// right-aligns them too.
const NUMERIC = /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|Inf|NaN)$/;

// Rows and columns rendered either side of the view, so a scroll of a few pixels can
// paint without building anything first. Four each way is about 500 cells for a
// 640x320 panel — small enough that a re-render is a frame, large enough that a flick
// of the wheel does not outrun it. test/matrixGridWindow.test.ts restates this value
// rather than importing it, so a change here has to be a deliberate one.
const GRID_BUFFER = 4;

// What a column is allowed to grow to for the sake of its widest cell. A cell array
// of long strings would otherwise set every column that wide, and a grid 2,000px per
// column is less readable than an ellipsis with the full text on hover.
const MAX_COL_WIDTH = 240;

// The geometry the FIRST frame uses, before the probe below has been measured.
// Defaults and not zeroes, because zero would mean "size unknown", which
// virtualWindow answers by rendering everything — and rendering everything on the
// first frame of a 1000x1000 matrix is the ten and a half seconds this file exists to
// remove. Being approximate costs nothing: the width is FORCED on the columns, so the
// figure the padding is computed from is the figure the cells are laid out at
// whether or not it is the ideal one. The probe then refines it, on the next frame.
const DEFAULT_ROW_HEIGHT = 20; // 12px of text, 2px of padding either side, a 1px rule
const DEFAULT_COL_WIDTH = 64;
const DEFAULT_ROWHEADER_WIDTH = 36;

@customElement('dex-matrix-grid')
export class DexMatrixGrid extends LitElement {
  static override styles = css`
    :host {
      display: block;
      /* The containing block for the probes below. They must NOT be inside
         .scroll: an out-of-flow box still counts towards its scroll container's
         scrollable area, so a probe holding a long string would lengthen the
         grid's own scrollbar by the width of a cell that is not in it. */
      position: relative;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--dex-font-size, 12px);
      color: var(--dex-fg, #1f1f1f);
    }

    .scroll {
      overflow: auto;
      max-height: var(--dex-matrix-max-height, 320px);
      max-width: var(--dex-matrix-max-width, 640px);
    }

    /* table-layout: fixed is what makes a windowed column axis possible at all. The
       padding either side of the window is "skipped columns x one width", so a
       column that sized itself to its own content would put every cell at a
       position the padding does not account for. Fixed layout takes the widths this
       file sets and ignores the content, which is the whole point. */
    .grid {
      border-collapse: separate;
      border-spacing: 0;
      display: table;
      table-layout: fixed;
    }

    [role='row'],
    .pad-row {
      display: table-row;
    }

    [role='columnheader'],
    [role='rowheader'],
    [role='gridcell'],
    .pad-cell,
    .probe {
      display: table-cell;
      box-sizing: border-box;
      padding: 2px 8px;
      border-right: 1px solid var(--dex-matrix-grid-line, rgba(0, 0, 0, 0.08));
      border-bottom: 1px solid var(--dex-matrix-grid-line, rgba(0, 0, 0, 0.08));
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    /* A cell cannot widen its column any more, so one that does not fit is cut with
       an ellipsis and carries its full text as a tooltip. Reachable only for
       non-numeric content past MAX_COL_WIDTH: a number is narrower than that. */
    [role='gridcell'] {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Holds the scrollbar's length open for the rows and columns that were not
       built. Borderless, so the gap does not read as a cell. */
    .pad-cell {
      padding: 0;
      border: 0;
    }

    /* Measured, never seen: one cell holding the widest text in the matrix, which is
       the width every column then takes. Out of flow so it adds no row, and
       visibility:hidden rather than display:none because a display:none box
       has no measurements to read. */
    .probe {
      position: absolute;
      visibility: hidden;
      pointer-events: none;
      top: 0;
      left: 0;
      width: auto;
      max-width: none;
      display: inline-block;
    }

    [role='columnheader'],
    [role='rowheader'] {
      background: var(--dex-matrix-header-bg, rgba(0, 0, 0, 0.04));
      color: var(--dex-matrix-header-fg, #6b6b6b);
      text-align: center;
      position: sticky;
      font-weight: 600;
    }

    /* Three layers, because both headers are sticky and the cells now scroll under
       both of them. Painting order alone would put the row number of a scrolled-away
       row on top of the column numbers, it being later in the DOM. */
    [role='columnheader'] { top: 0; z-index: 2; }
    [role='rowheader'] { left: 0; z-index: 1; }
    [role='columnheader'].corner { left: 0; z-index: 3; }

    [role='gridcell'] { text-align: left; }
    [role='gridcell'].num { text-align: right; }

    [role='gridcell']:focus {
      outline: 2px solid var(--dex-focus-ring, #0078d4);
      outline-offset: -2px;
    }

    .pager {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 0 0;
    }

    .pager button {
      font: inherit;
      line-height: 1;
      padding: 2px 6px;
      cursor: pointer;
      background: transparent;
      border: 1px solid var(--dex-matrix-grid-line, rgba(0, 0, 0, 0.16));
      border-radius: 4px;
      color: inherit;
    }

    .pager button[disabled] { opacity: 0.4; cursor: default; }
    .pager select { font: inherit; }
  `;

  @property({ attribute: false }) matrix: MatrixPayload | null = null;

  @state() private _page = 0;
  @state() private _r = 0;
  @state() private _c = 0;
  // Where the window sits. Deliberately reactive state rather than a read of the
  // scroll box: a scroll that stays inside the slice already rendered needs no
  // repaint, so _onScroll leaves these alone and the two diverge until the slice
  // actually has to move. dex-tree-table does the same, for the same reason.
  @state() private _scrollTop = 0;
  @state() private _scrollLeft = 0;
  @state() private _viewH = 0;
  @state() private _viewW = 0;
  // One cell's geometry, measured from the probe. Seeded with the defaults so the
  // first frame is already windowed.
  @state() private _cellBox = {
    rowH: DEFAULT_ROW_HEIGHT,
    colW: DEFAULT_COL_WIDTH,
    headerW: DEFAULT_ROWHEADER_WIDTH,
  };
  // Set when a keystroke moved the cursor, so focus follows in updated() — after
  // the new cell exists but before updateComplete resolves, which keeps the
  // ordering deterministic for tests and for screen readers alike.
  private _refocus = false;
  // A scroll position the window has already moved to but the DOM has not. Written
  // in updated(), never in the handler that decides it: the padding that makes the
  // box tall enough to accept the write only exists after the render, and a write
  // that arrives early is silently clamped to the old extent.
  private _pendingScroll: { top: number; left: number } | null = null;
  private _lastWindowStart = { row: -1, col: -1 };
  private _resizeObserver: ResizeObserver | null = null;

  private get _dims(): number[] {
    return this.matrix?.dims ?? [];
  }

  private get _rows(): number {
    return this._dims[0] ?? 0;
  }

  private get _cols(): number {
    return this._dims[1] ?? 0;
  }

  get pageCount(): number {
    return this._dims.slice(2).reduce((a, b) => a * b, 1);
  }

  get page(): number {
    return this._page;
  }

  // Clamped on the way in: an out-of-range page would index past `cells` and
  // render a grid of blanks, which looks like missing data rather than a bug.
  set page(next: number) {
    const clamped = Math.max(0, Math.min(this.pageCount - 1, Math.trunc(next) || 0));
    this._page = clamped;
  }

  // `(:,:,k)` / `(:,:,k3,k4)` — dimension 3 varies fastest, matching MATLAB's own
  // column-major page order and the host's canonical cell layout.
  pageLabel(page: number): string {
    const trailing = this._dims.slice(2);
    if (trailing.length === 0) {
      return '';
    }
    const subs: number[] = [];
    let rest = page;
    for (const extent of trailing) {
      subs.push((rest % extent) + 1);
      rest = Math.floor(rest / extent);
    }
    return '(:,:,' + subs.join(',') + ')';
  }

  cellText(r: number, c: number, page = this._page): string {
    const cells = this.matrix?.cells;
    if (!cells) {
      return '';
    }
    return cells[page * this._rows * this._cols + r * this._cols + c] ?? '';
  }

  focusActiveCell(): void {
    const cell = this.shadowRoot?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]');
    cell?.focus();
  }

  // ---- Geometry: what one cell occupies, and how much of the grid is on screen ----

  // A CSS custom property wins over the measurement, which is how a test gets
  // deterministic windowing out of a DOM that lays nothing out — the same seam
  // dex-tree-table's `--dex-row-height` is. Anything unparseable reads as absent.
  private _cssPx(name: string): number {
    const raw = getComputedStyle(this).getPropertyValue(name);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private get _rowH(): number {
    return this._cssPx('--dex-matrix-row-height') || this._cellBox.rowH;
  }

  private get _colW(): number {
    return this._cssPx('--dex-matrix-col-width') || this._cellBox.colW;
  }

  private get _headerW(): number {
    return this._cssPx('--dex-matrix-rowheader-width') || this._cellBox.headerW;
  }

  private get _scroll(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>('.scroll') ?? null;
  }

  // Both headers are STICKY, and that is the only thing that complicates the
  // arithmetic. Row r sits at content offset `rowH + r*rowH` — one header-row down —
  // but the header also covers the top `rowH` of the viewport, so the two shifts
  // cancel and the first visible row is plain `scrollTop / rowH`. What does NOT
  // cancel is the height: the header is eating `rowH` of the viewport, so there is
  // that much less of the matrix on screen. Same argument sideways, with the row
  // numbers eating `headerW` of the width.
  private _rowWindow(scrollTop = this._scrollTop) {
    return virtualWindow({
      items: this._rows,
      itemSize: this._rowH,
      scroll: scrollTop,
      viewport: this._viewH - this._rowH,
      buffer: GRID_BUFFER,
    });
  }

  private _colWindow(scrollLeft = this._scrollLeft) {
    return virtualWindow({
      items: this._cols,
      itemSize: this._colW,
      scroll: scrollLeft,
      viewport: this._viewW - this._headerW,
      buffer: GRID_BUFFER,
    });
  }

  private _onScroll(): void {
    const box = this._scroll;
    if (!box) {
      return;
    }
    const top = box.scrollTop;
    const left = box.scrollLeft;
    // Only a scroll that moves the slice is worth a render. Without this the grid
    // re-renders on every scroll event, which is several per wheel notch.
    const row = this._rowWindow(top).start;
    const col = this._colWindow(left).start;
    if (row === this._lastWindowStart.row && col === this._lastWindowStart.col) {
      return;
    }
    this._scrollTop = top;
    this._scrollLeft = left;
  }

  // Put cell (_r,_c) inside the view, by the smallest scroll that does it. The
  // keyboard can walk the cursor clean out of the window, and a cell that was never
  // rendered cannot take focus — the grid would simply stop answering arrow keys.
  private _revealActive(): void {
    const rowH = this._rowH;
    const colW = this._colW;
    if (rowH <= 0 || colW <= 0) {
      return;
    }
    const headerW = this._headerW;
    let top = this._scrollTop;
    let left = this._scrollLeft;
    // The two bounds on the scroll offset that keep cell (_r,_c) wholly visible,
    // measured against the STICKY headers rather than the box's own edges — a cell
    // scrolled to sit under the column numbers is not visible. `atTop` is the largest
    // offset that clears the header, `atBottom` the smallest that clears the far
    // edge; between the two the cell is already on screen and nothing moves.
    const atTop = this._r * rowH;
    const atBottom = (this._r + 2) * rowH - this._viewH;
    if (top > atTop) {
      top = atTop;
    } else if (this._viewH > 0 && top < atBottom) {
      top = atBottom;
    } else if (this._viewH === 0 && top < atTop) {
      // Nothing has been laid out, so there is no far edge to be past and the branch
      // above can never fire. Bring the cell to the top instead: not the smallest
      // scroll that would do, but the only one that is certainly enough.
      top = atTop;
    }
    const atLeftEdge = this._c * colW;
    const atRightEdge = headerW + (this._c + 1) * colW - this._viewW;
    if (left > atLeftEdge) {
      left = atLeftEdge;
    } else if (this._viewW > 0 && left < atRightEdge) {
      left = atRightEdge;
    } else if (this._viewW === 0 && left < atLeftEdge) {
      left = atLeftEdge;
    }
    if (top === this._scrollTop && left === this._scrollLeft) {
      return;
    }
    this._scrollTop = top;
    this._scrollLeft = left;
    this._pendingScroll = { top, left };
  }

  private _measure(): void {
    const box = this._scroll;
    if (box) {
      const h = box.clientHeight;
      const w = box.clientWidth;
      if (h > 0 && h !== this._viewH) this._viewH = h;
      if (w > 0 && w !== this._viewW) this._viewW = w;
    }
    const cell = this.shadowRoot?.querySelector('.probe-cell') as HTMLElement | null;
    const head = this.shadowRoot?.querySelector('.probe-head') as HTMLElement | null;
    if (!cell || !head) {
      return;
    }
    const rect = cell.getBoundingClientRect();
    const rowH = Math.ceil(rect.height);
    const colW = Math.min(MAX_COL_WIDTH, Math.ceil(rect.width));
    const headerW = Math.ceil(head.getBoundingClientRect().width);
    if (rowH <= 0 || colW <= 0 || headerW <= 0) {
      return; // nothing has been laid out; the defaults stand
    }
    const prev = this._cellBox;
    if (rowH !== prev.rowH || colW !== prev.colW || headerW !== prev.headerW) {
      this._cellBox = { rowH, colW, headerW };
    }
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // A new matrix in the same instance: the shell reuses one grid across
    // openings, so the cursor, page and scroll have to return to the origin or they
    // would point outside the new matrix.
    if (changed.has('matrix')) {
      this._page = 0;
      this._r = 0;
      this._c = 0;
      this._scrollTop = 0;
      this._scrollLeft = 0;
      this._scan = null;
      this._pendingScroll = { top: 0, left: 0 };
    }
  }

  override updated(): void {
    const win = { row: this._rowWindow().start, col: this._colWindow().start };
    this._lastWindowStart = win;
    // After the render, so the padding is in place and the box is long enough for
    // the write to land where it was asked to.
    const pending = this._pendingScroll;
    this._pendingScroll = null;
    const box = this._scroll;
    if (pending && box) {
      if (box.scrollTop !== pending.top) box.scrollTop = pending.top;
      if (box.scrollLeft !== pending.left) box.scrollLeft = pending.left;
    }
    this._measure();
    if (!this._resizeObserver && box && typeof ResizeObserver !== 'undefined') {
      // The panel is positioned after it opens and can be resized by the window, and
      // either one changes how many cells belong in the window.
      this._resizeObserver = new ResizeObserver(() => this._measure());
      this._resizeObserver.observe(box);
    }
    if (this._refocus) {
      this._refocus = false;
      this.focusActiveCell();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  // One pass over the cells for the two things the whole grid needs to know about
  // them: whether they are all numbers (alignment) and which is the widest (the
  // column width every column then takes). Two passes over a million strings is
  // twice as much of the one cost windowing cannot remove, so they share one.
  private _scan: { numeric: boolean; widest: string } | null = null;

  private get _scanned(): { numeric: boolean; widest: string } {
    if (!this._scan) {
      const cells = this.matrix?.cells ?? [];
      let numeric = cells.length > 0;
      // Seeded with the largest column number: a one-character matrix under a
      // three-digit heading would otherwise fix every column too narrow to show the
      // heading, and fixed layout has no way to grow back.
      let widest = String(this._cols);
      for (const cell of cells) {
        if (numeric && !NUMERIC.test(cell)) {
          numeric = false;
        }
        if (cell.length > widest.length) {
          widest = cell;
        }
      }
      this._scan = { numeric, widest };
    }
    return this._scan;
  }

  // `A(2,3)` for arrays, `A{2,3}` for cells — the same spelling core uses for the
  // element rows in the tree, including the page subscripts when there are pages.
  private _cellLabel(r: number, c: number): string {
    const name = this.matrix?.name ?? '';
    const cell = this.matrix?.className === 'cell';
    const subs = [String(r + 1), String(c + 1)];
    const trailing = this.pageLabel(this._page);
    if (trailing) {
      subs.push(...trailing.slice('(:,:,'.length, -1).split(','));
    }
    return name + (cell ? '{' : '(') + subs.join(',') + (cell ? '}' : ')');
  }

  private _move(dr: number, dc: number): void {
    this._r = Math.max(0, Math.min(this._rows - 1, this._r + dr));
    this._c = Math.max(0, Math.min(this._cols - 1, this._c + dc));
    this._refocus = true;
    this._revealActive();
  }

  private _onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowRight': this._move(0, 1); break;
      case 'ArrowLeft': this._move(0, -1); break;
      case 'ArrowDown': this._move(1, 0); break;
      case 'ArrowUp': this._move(-1, 0); break;
      // Through _move, not by assignment: the cursor has to be brought back into
      // the window, and a cursor set directly is one that cannot be focused.
      case 'Home': this._move(0, -this._cols); break;
      case 'End': this._move(0, this._cols); break;
      case 'PageDown': this.page = this._page + 1; this._refocus = true; break;
      case 'PageUp': this.page = this._page - 1; this._refocus = true; break;
      // Escape is NOT handled here: the popover shell owns dismissal, and
      // swallowing it would leave the editor un-closable from the keyboard.
      default: return;
    }
    e.preventDefault();
  }

  private _renderPager() {
    if (this.pageCount <= 1) {
      return nothing;
    }
    const pages = Array.from({ length: this.pageCount }, (_, i) => i);
    return html`
      <div class="pager">
        <button
          type="button"
          aria-label="Previous page"
          ?disabled=${this._page === 0}
          @click=${() => { this.page = this._page - 1; }}
        >◀</button>
        <select
          aria-label="Page"
          .value=${String(this._page)}
          @change=${(e: Event) => { this.page = Number((e.target as HTMLSelectElement).value); }}
        >
          ${pages.map((p) => html`<option value=${String(p)} ?selected=${p === this._page}>${this.pageLabel(p)}</option>`)}
        </select>
        <button
          type="button"
          aria-label="Next page"
          ?disabled=${this._page === this.pageCount - 1}
          @click=${() => { this.page = this._page + 1; }}
        >▶</button>
      </div>
    `;
  }

  override render() {
    if (!this.matrix || this._rows <= 0 || this._cols <= 0) {
      return nothing;
    }
    const num = this._scanned.numeric;
    const rowH = this._rowH;
    const colW = this._colW;
    const headerW = this._headerW;
    const rowWin = this._rowWindow();
    const colWin = this._colWindow();
    const rows = Array.from({ length: rowWin.count }, (_, i) => rowWin.start + i);
    const cols = Array.from({ length: colWin.count }, (_, i) => colWin.start + i);
    // The row-number column plus the whole column axis, padding included, so the
    // scrollbar measures the matrix rather than the window.
    const gridW = `width: ${headerW + colWin.span}px;`;
    const cellW = `width: ${colW}px;`;
    // A tooltip only where one says something. Cells clip only when the widest of them
    // wanted more than the cap, which numbers never do — so titling every cell would
    // put a one-second hover delay and a second copy of the number on a grid where
    // nothing is hidden.
    const clips = colW >= MAX_COL_WIDTH;
    const padLeft = html`<div class="pad-cell pad-left" role="presentation" style="width: ${colWin.before}px"></div>`;
    const padRight = html`<div class="pad-cell pad-right" role="presentation" style="width: ${colWin.after}px"></div>`;
    return html`
      <div class="scroll" @scroll=${this._onScroll}>
        <div
          class="grid"
          role="grid"
          style=${gridW}
          aria-label=${this.matrix.name}
          aria-rowcount=${this._rows}
          aria-colcount=${this._cols}
          @keydown=${this._onKeydown}
        >
          <div role="row" style="height: ${rowH}px">
            <div role="columnheader" class="corner" style="width: ${headerW}px"></div>
            ${padLeft}
            ${cols.map((c) => html`<div role="columnheader" aria-colindex=${c + 1} style=${cellW}>${c + 1}</div>`)}
            ${padRight}
          </div>
          <div class="pad-row" role="presentation">
            <div class="pad-cell pad-top" role="presentation" style="height: ${rowWin.before}px"></div>
          </div>
          ${rows.map((r) => html`
            <div role="row" style="height: ${rowH}px">
              <div role="rowheader" style="width: ${headerW}px">${r + 1}</div>
              ${padLeft}
              ${cols.map((c) => html`
                <div
                  role="gridcell"
                  class=${num ? 'num' : ''}
                  style=${cellW}
                  aria-rowindex=${r + 1}
                  aria-colindex=${c + 1}
                  aria-label=${this._cellLabel(r, c)}
                  title=${clips ? this.cellText(r, c) : nothing}
                  tabindex=${r === this._r && c === this._c ? 0 : -1}
                  @focus=${() => { this._r = r; this._c = c; }}
                >${this.cellText(r, c)}</div>
              `)}
              ${padRight}
            </div>
          `)}
          <div class="pad-row" role="presentation">
            <div class="pad-cell pad-bottom" role="presentation" style="height: ${rowWin.after}px"></div>
          </div>
        </div>
      </div>
      <div class="probe probe-cell" role="presentation" aria-hidden="true">${this._scanned.widest}</div>
      <div class="probe probe-head" role="presentation" aria-hidden="true">${this._rows}</div>
      ${this._renderPager()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-matrix-grid': DexMatrixGrid;
  }
}
