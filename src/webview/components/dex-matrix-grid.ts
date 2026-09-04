// Copyright 2026 The MathWorks, Inc.
//
// The 2-D grid inside the Variable Editor. Given a MatrixPayload it renders one
// page at a time, headed by MATLAB's 1-based row/column numbers, with a page
// selector over the trailing dimensions when there is more than one page.
//
// It is deliberately dumb: the payload's `cells` are ALREADY in canonical
// row-major-within-page order (the host's matrixPayload.ts places them there by
// parsing each element's own subscript label, because core's element order
// differs by container kind). So this file does exactly one index computation,
// `page*d0*d1 + r*d1 + c`, and never asks what kind of array it is holding.
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Mirror of the host's MatrixPayload. Declared here rather than imported because
// webview components never import host modules — the same reason
// dex-property-inspector declares PropertyRow beside piBuilder's PIPropertyRow.
// test/variableEditorGrid.test.ts assigns the host type to this one, so the two
// cannot drift without a compile error.
export interface MatrixPayload {
  name: string;
  className: string;
  dims: number[];        // effectiveDims: length >= 2, no trailing singletons past dim 2
  cells: string[];        // row-major within a page, pages in order; length = prod(dims)
}

// A cell is right-aligned only if EVERY cell in the matrix reads as a number, so
// one non-numeric entry keeps the whole column block left-aligned rather than
// producing a ragged mix. Inf/NaN count: they are numeric results, and MATLAB
// right-aligns them too.
const NUMERIC = /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|Inf|NaN)$/;

@customElement('dex-matrix-grid')
export class DexMatrixGrid extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--dex-font-size, 12px);
      color: var(--dex-fg, #1f1f1f);
    }

    .scroll {
      overflow: auto;
      max-height: var(--dex-matrix-max-height, 320px);
      max-width: var(--dex-matrix-max-width, 640px);
    }

    .grid {
      border-collapse: separate;
      border-spacing: 0;
      display: table;
      width: max-content;
    }

    [role='row'] {
      display: table-row;
    }

    [role='columnheader'],
    [role='rowheader'],
    [role='gridcell'] {
      display: table-cell;
      padding: 2px 8px;
      border-right: 1px solid var(--dex-matrix-grid-line, rgba(0, 0, 0, 0.08));
      border-bottom: 1px solid var(--dex-matrix-grid-line, rgba(0, 0, 0, 0.08));
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    [role='columnheader'],
    [role='rowheader'] {
      background: var(--dex-matrix-header-bg, rgba(0, 0, 0, 0.04));
      color: var(--dex-matrix-header-fg, #6b6b6b);
      text-align: center;
      position: sticky;
      font-weight: 600;
    }

    [role='columnheader'] { top: 0; z-index: 1; }
    [role='rowheader'] { left: 0; }

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
  // Set when a keystroke moved the cursor, so focus follows in updated() — after
  // the new cell exists but before updateComplete resolves, which keeps the
  // ordering deterministic for tests and for screen readers alike.
  private _refocus = false;

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

  override willUpdate(changed: Map<string, unknown>): void {
    // A new matrix in the same instance: the shell reuses one grid across
    // openings, so the cursor and page have to return to the origin or they
    // would point outside the new matrix.
    if (changed.has('matrix')) {
      this._page = 0;
      this._r = 0;
      this._c = 0;
    }
  }

  override updated(): void {
    if (this._refocus) {
      this._refocus = false;
      this.focusActiveCell();
    }
  }

  private get _allNumeric(): boolean {
    const cells = this.matrix?.cells ?? [];
    return cells.length > 0 && cells.every((c) => NUMERIC.test(c));
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
  }

  private _onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowRight': this._move(0, 1); break;
      case 'ArrowLeft': this._move(0, -1); break;
      case 'ArrowDown': this._move(1, 0); break;
      case 'ArrowUp': this._move(-1, 0); break;
      case 'Home': this._c = 0; this._refocus = true; break;
      case 'End': this._c = Math.max(0, this._cols - 1); this._refocus = true; break;
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
    const num = this._allNumeric;
    const rows = Array.from({ length: this._rows }, (_, i) => i);
    const cols = Array.from({ length: this._cols }, (_, i) => i);
    return html`
      <div class="scroll">
        <div
          class="grid"
          role="grid"
          aria-label=${this.matrix.name}
          aria-rowcount=${this._rows}
          aria-colcount=${this._cols}
          @keydown=${this._onKeydown}
        >
          <div role="row">
            <div role="columnheader"></div>
            ${cols.map((c) => html`<div role="columnheader">${c + 1}</div>`)}
          </div>
          ${rows.map((r) => html`
            <div role="row">
              <div role="rowheader">${r + 1}</div>
              ${cols.map((c) => html`
                <div
                  role="gridcell"
                  class=${num ? 'num' : ''}
                  aria-rowindex=${r + 1}
                  aria-colindex=${c + 1}
                  aria-label=${this._cellLabel(r, c)}
                  tabindex=${r === this._r && c === this._c ? 0 : -1}
                  @focus=${() => { this._r = r; this._c = c; }}
                >${this.cellText(r, c)}</div>
              `)}
            </div>
          `)}
        </div>
      </div>
      ${this._renderPager()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-matrix-grid': DexMatrixGrid;
  }
}
