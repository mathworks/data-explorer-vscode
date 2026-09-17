// Copyright 2026 The MathWorks, Inc.
//
// The filter popup a right-click on a column header opens. It does NOT filter
// anything: it composes one condition's TEXT and hands it to the table, which puts
// it in the search box and re-parses. That is deliberate — a popup that filtered
// on its own would be a second path deciding what a condition means, and the two
// paths would drift. The `writes:` line is the same string `formatToken` gives
// Apply, so the teaching line cannot lie.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { formatToken, type FilterOp } from '../rowFilter.js';

// Glyph per operator: chips and radios must agree, and `≠ ≥ ≤` read faster than
// their ASCII spellings. `contains` shows the colon it writes.
export const OP_GLYPHS: ReadonlyArray<readonly [FilterOp, string, string]> = [
  ['contains', ':', 'contains'],
  ['=', '=', 'equals'],
  ['!=', '≠', 'does not equal'],
  ['>', '>', 'greater than'],
  ['<', '<', 'less than'],
  ['>=', '≥', 'greater than or equal to'],
  ['<=', '≤', 'less than or equal to'],
];

@customElement('dex-column-filter')
export class DexColumnFilter extends LitElement {
  static override styles = css`
    :host {
      position: fixed;
      z-index: 1001;
      display: block;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 12px;
      color: var(--dex-color-text, inherit);
      background: var(--dex-bg-primary, #fff);
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      padding: 8px;
      min-width: 240px;
    }
    .popup-title {
      font-weight: 600;
      margin-bottom: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .op-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 6px;
    }
    .op-button {
      min-width: 26px;
      height: 22px;
      padding: 0 6px;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 3px;
      background: var(--dex-bg-primary, #fff);
      color: inherit;
      font: inherit;
      cursor: pointer;
      outline: none;
    }
    .op-button:hover {
      background: var(--dex-bg-hover, #e8e8e8);
    }
    .op-button[aria-pressed='true'] {
      border-color: var(--dex-color-accent, #0078d4);
      background: var(--dex-bg-selected, #cce4f7);
    }
    .op-button:focus-visible {
      border-color: var(--dex-color-accent, #0078d4);
    }
    .popup-value {
      width: 100%;
      height: 24px;
      padding: 2px 6px;
      box-sizing: border-box;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 3px;
      font: inherit;
      outline: none;
    }
    .popup-value:focus {
      border-color: var(--dex-color-accent, #0078d4);
    }
    /* The teaching line. Monospace because it is literal syntax to retype. */
    .writes {
      display: flex;
      gap: 6px;
      margin: 6px 0;
      min-height: 16px;
      font-size: 11px;
      color: var(--dex-color-text-secondary, #666);
    }
    .writes-value {
      font-family: var(--dex-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      overflow-wrap: anywhere;
    }
    .popup-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }
    .popup-actions button {
      height: 22px;
      padding: 0 10px;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 3px;
      background: var(--dex-bg-primary, #fff);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .popup-actions button:hover {
      background: var(--dex-bg-hover, #e8e8e8);
    }
    .popup-apply {
      border-color: var(--dex-color-accent, #0078d4) !important;
    }
    /* Forced colors override every background and border above, so the chosen
       operator would look identical to the six others — the one piece of state in
       here that a user has to be able to see. A system-colour outline survives. */
    @media (forced-colors: active) {
      .op-button,
      .popup-value,
      .popup-actions button {
        border: 1px solid ButtonText !important;
      }
      .op-button[aria-pressed='true'] {
        outline: 2px solid Highlight !important;
        outline-offset: -3px !important;
      }
      .op-button:focus-visible,
      .popup-value:focus-visible,
      .popup-actions button:focus-visible {
        outline: 2px solid Highlight !important;
        outline-offset: 1px !important;
      }
    }
  `;

  /** Column key the condition is about. */
  @property({ type: String }) column = '';
  /** Header label; also the prefix the written text uses. */
  @property({ type: String }) columnLabel = '';
  @property({ type: String }) op: FilterOp = 'contains';
  @property({ type: String }) value = '';
  /** True when the table already has a condition for this column. */
  @property({ type: Boolean }) hasExisting = false;

  @query('.popup-value') private _valueInput?: HTMLInputElement;

  /** Focus the value box; the caller opens the popup for typing, not for reading. */
  focusValue(): void {
    this._valueInput?.focus();
    this._valueInput?.select();
  }

  override firstUpdated(): void {
    this.focusValue();
  }

  private get _text(): string {
    // `contains` with nothing typed yet would preview `"Data Type":`, which promises
    // a condition the user has not written. Every other operator DOES write on an
    // empty value — `Unit=` asks which entries have no Unit, a real question.
    if (!this.value && this.op === 'contains') return '';
    return formatToken(this.columnLabel || this.column, this.op, this.value);
  }

  private _apply(): void {
    this.dispatchEvent(
      new CustomEvent('dex-column-filter-applied', {
        detail: { column: this.column, op: this.op, value: this.value, text: this._text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent('dex-column-filter-closed', { bubbles: true, composed: true }));
  }

  private _clear(): void {
    this.dispatchEvent(
      new CustomEvent('dex-column-filter-cleared', {
        detail: { column: this.column },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._apply();
    } else if (e.key === 'Escape') {
      // Stopped so the table's own Escape (which clears the whole filter) does not
      // also fire — closing a popup must not throw away the user's search.
      e.preventDefault();
      e.stopPropagation();
      this._close();
    }
  }

  override render() {
    return html`
      <div class="popup-title">Filter: ${this.columnLabel || this.column}</div>
      <div class="op-row" role="group" aria-label="Comparison">
        ${OP_GLYPHS.map(
          ([op, glyph, label]) => html`
            <button
              type="button"
              class="op-button"
              data-op=${op}
              title=${label}
              aria-label=${label}
              aria-pressed=${this.op === op}
              @click=${() => {
                this.op = op;
                this.focusValue();
              }}
            >
              ${glyph}
            </button>
          `,
        )}
      </div>
      <input
        class="popup-value"
        type="text"
        .value=${this.value}
        aria-label=${`Filter value for ${this.columnLabel || this.column}`}
        placeholder="value"
        @input=${(e: Event) => {
          this.value = (e.target as HTMLInputElement).value;
        }}
        @keydown=${this._onKeyDown}
      />
      <div class="writes">
        <span>writes:</span><span class="writes-value">${this._text}</span>
      </div>
      <div class="popup-actions">
        ${this.hasExisting
          ? html`<button type="button" class="popup-clear" @click=${this._clear}>Clear</button>`
          : nothing}
        <button type="button" class="popup-apply" @click=${this._apply}>Apply</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-column-filter': DexColumnFilter;
  }
}
