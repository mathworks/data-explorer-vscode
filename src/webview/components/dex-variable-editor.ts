// Copyright 2026 The MathWorks, Inc.
//
// The floating shell that carries dex-matrix-grid: a titled panel anchored under
// the glyph that opened it. Positioning, dismissal and focus live here; the grid
// owns everything about the data. Modelled on dex-context-menu, which solves the
// same problems (fixed positioning, viewport clamping, document-level dismissal)
// and whose listener lifecycle is copied deliberately rather than re-derived.
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './dex-matrix-grid.js';
import type { DexMatrixGrid, MatrixPayload } from './dex-matrix-grid.js';

// Gap between the glyph and the panel, and the margin kept clear of the viewport
// edge. Same 8px margin dex-context-menu uses, so the two agree on screen.
const OFFSET = 4;
const MARGIN = 8;

@customElement('dex-variable-editor')
export class DexVariableEditor extends LitElement {
  static override styles = css`
    :host {
      position: fixed;
      z-index: 10000;
      display: none;
    }

    :host([open]) {
      display: block;
    }

    .panel {
      background: var(--dex-popover-bg, rgba(252, 252, 252, 0.98));
      border: 1px solid var(--dex-popover-border, rgba(0, 0, 0, 0.08));
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.06);
      padding: 6px 8px 8px;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--dex-font-size, 12px);
      color: var(--dex-fg, #1f1f1f);
    }

    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-bottom: 4px;
    }

    .title {
      flex: 1;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .close {
      font: inherit;
      line-height: 1;
      background: transparent;
      border: none;
      cursor: pointer;
      color: inherit;
      padding: 2px 4px;
      border-radius: 4px;
    }

    .close:hover { background: var(--dex-hover-bg, rgba(0, 0, 0, 0.06)); }
  `;

  @state() private _open = false;
  @state() private _matrix: MatrixPayload | null = null;

  // The element that opened us. Held so focus can go back where it came from,
  // and so reposition() can re-measure without the caller passing a rect.
  private _anchor: HTMLElement | null = null;

  private _dismissHandler = (e: MouseEvent) => {
    if (!e.composedPath().includes(this)) {
      this.close();
    }
  };

  private _keyHandler = (e: KeyboardEvent) => {
    // The grid deliberately leaves Escape alone so it arrives here.
    if (e.key === 'Escape') {
      this.close();
    }
  };

  private _scrollHandler = () => {
    this.close();
  };

  private get _title(): string {
    const m = this._matrix;
    return m ? `${m.name} — ${m.dims.join('x')} ${m.className}` : '';
  }

  private get _grid(): DexMatrixGrid | null {
    return this.shadowRoot?.querySelector('dex-matrix-grid') ?? null;
  }

  show(anchorEl: HTMLElement, matrix: MatrixPayload): void {
    this._anchor = anchorEl;
    this._matrix = matrix;
    this._open = true;
    this.setAttribute('open', '');

    // Position and focus after a frame, once the panel has been laid out — its
    // measured size is what the clamping needs. Listeners go on in the same
    // frame so the click that opened us cannot immediately dismiss us.
    requestAnimationFrame(() => {
      if (!this._open) {
        return;
      }
      this.reposition();
      document.addEventListener('mousedown', this._dismissHandler);
      document.addEventListener('keydown', this._keyHandler);
      window.addEventListener('scroll', this._scrollHandler, true);
      this._grid?.focusActiveCell();
    });
  }

  close(): void {
    const wasFocusInside =
      document.activeElement === this || this.contains(document.activeElement as Node | null);
    this._open = false;
    this.removeAttribute('open');
    document.removeEventListener('mousedown', this._dismissHandler);
    document.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('scroll', this._scrollHandler, true);
    // Return focus ONLY if we still hold it. setRows closes the editor from the
    // host while the user may be typing somewhere else entirely; yanking focus
    // to a glyph that may have just been re-rendered away would be worse than
    // leaving it alone.
    const anchor = this._anchor;
    this._anchor = null;
    this._matrix = null;
    if (wasFocusInside) {
      anchor?.focus();
    }
  }

  // Below the anchor, left edges aligned; pulled in at the viewport edges and
  // flipped above when there is no room below. Public because the tests drive it
  // directly: happy-dom has no layout engine, so they stub the two rects and
  // check the arithmetic.
  reposition(): void {
    const panel = this.shadowRoot?.querySelector('.panel') as HTMLElement | null;
    if (!panel || !this._anchor) {
      return;
    }
    const a = this._anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();

    let left = a.left;
    if (left + p.width > window.innerWidth) {
      left = window.innerWidth - p.width - MARGIN;
    }
    let top = a.bottom + OFFSET;
    if (top + p.height > window.innerHeight) {
      top = a.top - p.height - OFFSET;
    }
    this.style.left = `${Math.max(0, left)}px`;
    this.style.top = `${Math.max(0, top)}px`;
  }

  override render() {
    if (!this._open || !this._matrix) {
      return nothing;
    }
    return html`
      <div class="panel" role="dialog" aria-label=${this._title}>
        <div class="bar">
          <span class="title">${this._title}</span>
          <button type="button" class="close" aria-label="Close" @click=${() => this.close()}>✕</button>
        </div>
        <dex-matrix-grid .matrix=${this._matrix}></dex-matrix-grid>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-variable-editor': DexVariableEditor;
  }
}
