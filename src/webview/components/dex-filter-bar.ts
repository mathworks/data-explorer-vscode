// Copyright 2026 The MathWorks, Inc.
//
// The search bar as a token field: one chip per condition, one <input> for the tail
// the user is still typing. Exactly ONE real input — chips are siblings, not
// contenteditable — so the caret, selection, IME and undo stay the browser's job.
// A contenteditable token field owns all of that itself and gets it subtly wrong.
//
// The bar does not filter and does not own the filter. It receives the applied text
// and its parse, and proposes a REPLACEMENT for the whole text in one event. The
// only state it keeps for itself is the uncommitted tail, which is the one thing the
// table has no use for.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { removeToken, type FilterToken, type FilterOp } from '../rowFilter.js';
import { OP_GLYPHS } from './dex-column-filter.js';

const GLYPH = new Map<FilterOp, string>(OP_GLYPHS.map(([op, glyph]) => [op, glyph]));
const OP_WORD = new Map<FilterOp, string>(OP_GLYPHS.map(([op, , label]) => [op, label]));

const WARNING_TEXT: Record<NonNullable<FilterToken['warning']>, string> = {
  'unknown-column': 'No column by that name — searched as ordinary text.',
  'non-numeric-bound': 'The bound is not a number, so this condition is ignored.',
};

@customElement('dex-filter-bar')
export class DexFilterBar extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: center;
      gap: 4px;
      /* At most two rows tall, then scroll: an unbounded bar pushes the table down
         as conditions accumulate, and the row under the caret is the one that matters. */
      max-height: 52px;
      overflow-y: auto;
      padding: 2px 6px;
      box-sizing: border-box;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 3px;
      background: var(--dex-bg-primary, #fff);
      font-family: inherit;
      font-size: 12px;
      flex-wrap: wrap;
    }
    :host(.focused) {
      border-color: var(--dex-color-accent, #0078d4);
    }
    .chip-strip {
      display: contents;
    }
    .chip {
      display: inline-flex;
      align-items: baseline;
      gap: 3px;
      max-width: 100%;
      padding: 1px 2px 1px 6px;
      border-radius: 9px;
      background: var(--dex-bg-badge, rgba(128, 128, 128, 0.18));
      white-space: nowrap;
    }
    /* A column-scoped chip is tinted with the accent so the eye can separate "this
       condition names a column" from "this is a word to look for anywhere" without
       reading either. Alpha over the theme accent, never a fixed hue — a literal
       pill colour is unreadable in dark and invisible in high contrast. */
    .chip.column {
      background: color-mix(in srgb, var(--dex-color-accent, #0078d4) 18%, transparent);
    }
    .chip.warning {
      background: color-mix(in srgb, var(--dex-color-warning, #bf8803) 22%, transparent);
    }
    /* Quiet and small: the column is context for the value, not the point of it. */
    .chip-label {
      font-size: 11px;
      color: var(--dex-color-text-secondary, #666);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Muted like the label, but full size and semibold. "Unit: m" versus "Unit ≠ m"
       is the entire meaning of the chip, and 11px grey is not where that belongs. */
    .chip-op {
      font-size: 12px;
      font-weight: 600;
      color: var(--dex-color-text-secondary, #666);
    }
    .chip-op.subtle {
      font-weight: 400;
    }
    .chip-value {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chip-remove {
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      padding: 0;
      border: none;
      border-radius: 7px;
      background: none;
      color: var(--dex-color-text-secondary, #666);
      font: inherit;
      line-height: 1;
      cursor: pointer;
      outline: none;
    }
    .chip-remove:hover {
      background: var(--dex-bg-hover, #e8e8e8);
      color: var(--dex-color-text, inherit);
    }
    .chip-remove:focus-visible {
      outline: 1px solid var(--dex-color-accent, #0078d4);
    }
    .filter-input {
      flex: 1 1 60px;
      min-width: 60px;
      height: 20px;
      padding: 0 2px;
      border: none;
      background: none;
      color: inherit;
      font: inherit;
      outline: none;
    }
    /* Without this, Enter-to-filter reads as a search box that stopped working. */
    .pending-hint {
      flex: 0 0 auto;
      padding-right: 2px;
      font-size: 11px;
      color: var(--dex-color-text-secondary, #666);
      white-space: nowrap;
    }
    /* Forced colors drops every background above, so the three chip kinds — bare,
       column-scoped, warning — would be one undifferentiated shape. A border in a
       system colour survives, and the warning one takes the accent so "this
       condition is not doing what it says" is still visible without colour. */
    @media (forced-colors: active) {
      :host {
        border: 1px solid ButtonText !important;
      }
      .chip {
        border: 1px solid ButtonText !important;
      }
      .chip.warning {
        border: 2px solid Highlight !important;
      }
      .chip-remove:focus-visible {
        outline: 2px solid Highlight !important;
      }
    }
  `;

  /** The applied filter text. The bar never mutates it; it proposes replacements. */
  @property({ type: String }) text = '';
  /** Its parse, from the table's one `parseFilterExpression` call. */
  @property({ attribute: false }) tokens: FilterToken[] = [];
  @property({ type: String }) placeholder = 'Search';

  /** The uncommitted tail. The one piece of state that is the bar's alone. */
  @state() private _tail = '';

  @query('.filter-input') private _input?: HTMLInputElement;

  /** Focus (and select) the tail — the Ctrl+F entry point, forwarded by the table. */
  focusInput(): void {
    this._input?.focus();
    this._input?.select();
  }

  private _propose(text: string): void {
    this.dispatchEvent(
      new CustomEvent('dex-filter-applied', { detail: { text }, bubbles: true, composed: true }),
    );
  }

  private _commitTail(): void {
    const tail = this._tail.trim();
    if (!tail) return;
    this._tail = '';
    this._propose(this.text ? `${this.text} ${tail}` : tail);
  }

  private _removeAt(index: number): void {
    const token = this.tokens[index];
    if (token) this._propose(removeToken(this.text, token));
  }

  private _onKeyDown(e: KeyboardEvent): void {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      this._commitTail();
      return;
    }
    if (e.key === 'Escape') {
      // Two stages. A pending tail gets its own undo; a second press clears the
      // filter, which is what Escape has always done here. Reversing the order would
      // throw away an applied search on the way to abandoning a half-typed word.
      e.preventDefault();
      e.stopPropagation();
      if (this._tail) {
        this._tail = '';
      } else if (this.text) {
        this._propose('');
      }
      return;
    }
    if (
      e.key === 'Backspace' &&
      !this._tail &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0 &&
      this.tokens.length > 0
    ) {
      // Backspace into the chips edits the last one rather than deleting it blind:
      // its RAW text — the user's own spelling, quotes and `~=` included — comes back
      // into the input, so a typo is a correction instead of a retype.
      e.preventDefault();
      const last = this.tokens[this.tokens.length - 1];
      this._tail = last.raw;
      this._propose(removeToken(this.text, last));
    }
  }

  private _renderChip(token: FilterToken, index: number) {
    const kind = token.warning ? 'warning' : token.column ? 'column' : 'bare';
    const glyph = GLYPH.get(token.op) ?? ':';
    const word = OP_WORD.get(token.op) ?? 'contains';
    const label = token.columnLabel;
    return html`
      <span
        class="chip ${kind}"
        role="listitem"
        title=${token.warning ? WARNING_TEXT[token.warning] : nothing}
      >
        ${label ? html`<span class="chip-label">${label}</span>` : nothing}
        ${label ? html`<span class="chip-op ${token.op === 'contains' ? 'subtle' : ''}">${glyph}</span>` : nothing}
        <span class="chip-value">${token.value}</span>
        <button
          type="button"
          class="chip-remove"
          aria-label=${label ? `Remove filter ${label} ${word} ${token.value}` : `Remove filter ${token.value}`}
          @click=${(e: MouseEvent) => {
            e.stopPropagation();
            this._removeAt(index);
          }}
        >
          ×
        </button>
      </span>
    `;
  }

  override render() {
    return html`
      <span class="chip-strip" role="list" aria-label="Active filters">
        ${this.tokens.map((token, i) => this._renderChip(token, i))}
      </span>
      <input
        class="filter-input"
        type="text"
        .value=${this._tail}
        placeholder=${this.tokens.length ? '' : this.placeholder}
        aria-label="Search"
        @input=${(e: Event) => {
          this._tail = (e.target as HTMLInputElement).value;
        }}
        @keydown=${this._onKeyDown}
        @focus=${() => this.classList.add('focused')}
        @blur=${() => this.classList.remove('focused')}
      />
      ${this._tail.trim() ? html`<span class="pending-hint">⏎ to filter</span>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-filter-bar': DexFilterBar;
  }
}
