// Copyright 2026 The MathWorks, Inc.
//
// The "open this matrix in the Variable Editor" glyph. Rendered by the table's
// Value cell AND by the Property Inspector's value row, so the keyboard
// contract, the icon and the event exist once rather than twice — the failure
// mode this repo keeps hitting is two surfaces implementing one rule slightly
// differently.
//
// It does not open anything. It dispatches `dex-matrix-open` carrying the
// payload and itself; matrixOpen.ts turns that into a show() on the one editor
// instance the webview owns.
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './dex-icon.js';
import type { MatrixPayload } from './dex-matrix-grid.js';

export interface MatrixOpenDetail {
  matrix: MatrixPayload;
  anchorEl: HTMLElement;
  // The table supplies this so a future editing pass knows which row to write
  // back to. The Property Inspector has no rows and omits it.
  rowId?: string;
}

@customElement('dex-matrix-open')
export class DexMatrixOpen extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }

    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 3px;
      cursor: pointer;
      opacity: 0.75;
      color: inherit;
    }

    a:hover { opacity: 1; background: var(--dex-hover-bg, rgba(0, 0, 0, 0.06)); }

    a:focus-visible {
      outline: 2px solid var(--dex-focus-ring, #0078d4);
      outline-offset: 1px;
      opacity: 1;
    }
  `;

  @property({ attribute: false }) matrix: MatrixPayload | null = null;
  @property({ type: String }) rowId?: string;

  // The host element is not focusable, so a bare focus() would land on <body>.
  // dex-variable-editor.close() calls anchorEl.focus() to return focus here.
  override focus(options?: FocusOptions): void {
    (this.shadowRoot?.querySelector('a') as HTMLElement | null)?.focus(options);
  }

  private _open(e: Event): void {
    if (!this.matrix) {
      return;
    }
    // The glyph lives inside a Value cell whose click selects the row and whose
    // dblclick/Enter start an inline edit. Stop here so opening a grid never
    // also does one of those.
    e.preventDefault();
    e.stopPropagation();
    const detail: MatrixOpenDetail = { matrix: this.matrix, anchorEl: this };
    if (this.rowId !== undefined) {
      detail.rowId = this.rowId;
    }
    this.dispatchEvent(new CustomEvent<MatrixOpenDetail>('dex-matrix-open', {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  private _onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      this._open(e);
    }
  }

  override render() {
    if (!this.matrix) {
      return nothing;
    }
    return html`<a
      href="#"
      tabindex="0"
      role="button"
      aria-label=${`Open ${this.matrix.name} in the Variable Editor`}
      title=${`${this.matrix.dims.join('x')} ${this.matrix.className} — open in the Variable Editor`}
      @click=${this._open}
      @keydown=${this._onKeydown}
    ><dex-icon .iconId=${'wsTable'} .size=${14}></dex-icon></a>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-matrix-open': DexMatrixOpen;
  }
}
