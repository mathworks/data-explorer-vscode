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
import type { DexMatrixGrid, MatrixDescriptor, MatrixPayload } from './dex-matrix-grid.js';

// The host's answer to `requestMatrix` (src/common/protocol.ts MatrixCellsMessage).
// Exactly one of `matrix` / `message` is set.
export interface MatrixCellsAnswer {
  nodeId: string;
  matrix?: MatrixPayload;
  message?: string;
}

// Shown while the fetch is in flight. On the 1000x1000 entry this exists for a
// perceptible moment, which is the whole reason the panel opens before its data.
const WAITING = 'Loading…';

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

    /* --dex-bg-tertiary is --vscode-editorWidget-background: the colour VS Code paints a
       thing that floats over the editor, which is exactly what this is. It replaces an
       rgba(252, 252, 252, 0.98) literal under a #1f1f1f one — copied from dex-context-menu
       together with its shape, but under invented token names (--dex-popover-bg,
       --dex-fg) that nothing declares, so the literals were what shipped. In a dark theme
       that was a near-white panel of near-black text: a light-theme island in a dark
       editor, and the reason the grid's headers inside it were a wash of black at 4%.
       Opaque, with no backdrop-filter: this panel is a table of numbers to be read, not
       the glass the Add gallery deliberately is.

       The drop shadow keeps its literals. A shadow is light falling on the panel rather
       than a surface the theme chose — the same argument that lets vscode-theme.css write
       the literal white for the gallery's sheen — and VS Code's own widget.shadow is not
       defined in
       every theme. */
    .panel {
      background: var(--dex-bg-tertiary, #f5f5f5);
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.06);
      padding: 6px 8px 8px;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--dex-font-size, 12px);
      color: var(--dex-color-text, #333);
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

    .close:hover { background: var(--dex-bg-hover, #e8e8e8); }

    .status {
      padding: 6px 2px;
      color: var(--dex-color-text-muted, #666);
      white-space: nowrap;
    }
  `;

  @state() private _open = false;
  // What the row carried, set by show(). The panel opens, titles and positions
  // itself on this alone.
  @state() private _descriptor: MatrixDescriptor | null = null;
  // What the host sent back, set by deliver(). Null while the fetch is in flight;
  // the grid exists only once this does.
  @state() private _payload: MatrixPayload | null = null;
  // Why there are no cells: the wait, or the host's reason there will never be any.
  @state() private _message: string = WAITING;

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

  // From the DESCRIPTOR, never the payload: the title has to be right from the
  // moment the panel appears, which is before any cells exist.
  private get _title(): string {
    const m = this._descriptor;
    return m ? `${m.name} — ${m.dims.join('x')} ${m.className}` : '';
  }

  private get _grid(): DexMatrixGrid | null {
    return this.shadowRoot?.querySelector('dex-matrix-grid') ?? null;
  }

  /**
   * Open on what the row knew: name, class, shape, node id. The cells are not here
   * yet — matrixOpen.ts posts a `requestMatrix` for `matrix.nodeId` and hands the
   * answer to deliver(). Until then the panel shows its title and a waiting line.
   */
  show(anchorEl: HTMLElement, matrix: MatrixDescriptor): void {
    this._anchor = anchorEl;
    this._descriptor = matrix;
    // Reset, because one instance serves every opening: without this the second
    // opening would show the FIRST matrix's cells under the second one's title for
    // as long as its fetch takes.
    this._payload = null;
    this._message = WAITING;
    this._open = true;
    this.setAttribute('open', '');

    // Position after a frame, once the panel has been laid out — its measured size
    // is what the clamping needs. Listeners go on in the same frame so the click
    // that opened us cannot immediately dismiss us. Focus is NOT taken here: there
    // is no grid to focus yet. deliver() does it.
    requestAnimationFrame(() => {
      if (!this._open) {
        return;
      }
      this.reposition();
      document.addEventListener('mousedown', this._dismissHandler);
      document.addEventListener('keydown', this._keyHandler);
      window.addEventListener('scroll', this._scrollHandler, true);
    });
  }

  /**
   * The host answered a `requestMatrix`. Fills the panel in, or says why it cannot
   * be filled in. Ignores an answer that is not about what is currently on screen:
   * open A, change your mind, open B, and A's reply can still be in flight — taking
   * it would put A's numbers under B's title, which is worse than a slow panel.
   */
  async deliver(answer: MatrixCellsAnswer | null | undefined): Promise<void> {
    const nodeId = answer?.nodeId;
    if (!this._open || !this._descriptor || !nodeId || nodeId !== this._descriptor.nodeId) {
      return;
    }
    if (answer?.matrix) {
      this._payload = answer.matrix;
      this._message = '';
    } else {
      // No cells and no more coming. matrixCellsMessage always supplies a reason;
      // the fallback is for a malformed message, which must still not read as a wait
      // that never ends.
      this._payload = null;
      this._message = answer?.message || 'This value could not be read as a table.';
    }
    await this.updateComplete;
    if (!this._open) {
      return;
    }
    // The panel just went from a one-line box to up to 640x320, so the clamping has
    // to be re-run or a panel that fitted while waiting can hang off the viewport.
    this.reposition();
    // Now the grid exists: a keyboard user who pressed Enter on the glyph lands on
    // cell (1,1) without a second keystroke.
    this._grid?.focusActiveCell();
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
    this._descriptor = null;
    this._payload = null;
    this._message = WAITING;
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
    if (!this._open || !this._descriptor) {
      return nothing;
    }
    // A grid ONLY once there are cells. Handing the grid a cell-less descriptor would
    // lay out prod(dims) blank boxes — a million of them for the entry this was built
    // for — and read as a matrix that is genuinely empty rather than one still loading.
    const body = this._payload
      ? html`<dex-matrix-grid .matrix=${this._payload}></dex-matrix-grid>`
      : html`<div class="status" role="status">${this._message}</div>`;
    return html`
      <div class="panel" role="dialog" aria-label=${this._title}>
        <div class="bar">
          <span class="title">${this._title}</span>
          <button type="button" class="close" aria-label="Close" @click=${() => this.close()}>✕</button>
        </div>
        ${body}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-variable-editor': DexVariableEditor;
  }
}
