// Copyright 2026 The MathWorks, Inc.

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('dex-error-dialog')
export class DexErrorDialog extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }

    :host([open]) {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(0, 0, 0, 0.4);
      align-items: center;
      justify-content: center;
    }

    .dialog {
      background: var(--dex-bg-primary, #fff);
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      min-width: 340px;
      max-width: 480px;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      color: var(--dex-color-text, #333);
      outline: none;
    }

    .title {
      padding: 12px 16px;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid var(--dex-border-color-light, #e0e0e0);
      color: var(--dex-color-error, #d32f2f);
    }

    .body {
      padding: 16px;
    }

    .message {
      margin-bottom: 12px;
      line-height: 1.4;
    }

    .detail {
      font-family: var(--dex-font-mono, 'SF Mono', 'Menlo', 'Monaco', monospace);
      background: var(--dex-bg-tertiary, #f5f5f5);
      padding: 8px;
      border-radius: 3px;
      font-size: 12px;
      word-break: break-all;
      margin-top: 8px;
    }

    .values {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .row {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .label {
      color: var(--dex-color-text-secondary, #555);
      min-width: 64px;
      flex-shrink: 0;
    }

    .value {
      font-family: var(--dex-font-mono, 'SF Mono', 'Menlo', 'Monaco', monospace);
      background: var(--dex-bg-tertiary, #f5f5f5);
      padding: 2px 6px;
      border-radius: 3px;
      word-break: break-all;
    }

    .footer {
      padding: 12px 16px;
      border-top: 1px solid var(--dex-border-color-light, #e0e0e0);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    button {
      padding: 5px 20px;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 3px;
      background: var(--dex-bg-primary, #fff);
      color: var(--dex-color-text, #333);
      font-size: 13px;
      cursor: pointer;
    }

    button:hover {
      background: var(--dex-bg-hover, #e8e8e8);
    }

    button:focus {
      outline: none;
      box-shadow: var(--dex-focus-ring, 0 0 0 2px rgba(0, 120, 212, 0.4));
    }

    button.revert {
      color: var(--dex-color-error, #d32f2f);
      border-color: var(--dex-color-error, #d32f2f);
    }
  `;

  @property({ type: String }) dialogTitle = '';
  @property({ type: String }) message = '';
  @property({ type: String }) detail = '';
  @property({ type: String }) invalidValue = '';
  @property({ type: String }) validValue = '';
  @property({ type: Boolean }) showRevert = false;

  @state() private _open = false;
  private _returnFocusTo: HTMLElement | null = null;

  show(opts: {
    title?: string;
    reason?: string;
    detail?: string;
    invalidValue?: string;
    validValue?: string;
    showRevert?: boolean;
    returnFocusTo?: HTMLElement;
  }): void {
    this._returnFocusTo = opts.returnFocusTo || this._findActiveElement();
    this.dialogTitle = opts.title || 'Invalid Value';
    this.message = opts.reason || 'The entered value is not valid.';
    this.detail = opts.detail || '';
    this.invalidValue = opts.invalidValue || '';
    this.validValue = opts.validValue || '';
    this.showRevert = opts.showRevert || false;
    this._open = true;
    this.setAttribute('open', '');
    document.addEventListener('keydown', this._onKeyDown, true);
    this.updateComplete.then(() => {
      // Focus OK, never Revert: Revert discards the user's edit, and an
      // autofocused destructive button turns a reflex Enter/Space into data loss.
      const buttons = this.shadowRoot?.querySelectorAll<HTMLButtonElement>('button');
      buttons?.[buttons.length - 1]?.focus();
    });
  }

  hide(): void {
    this._open = false;
    this.removeAttribute('open');
    document.removeEventListener('keydown', this._onKeyDown, true);
    const target = this._returnFocusTo;
    this._returnFocusTo = null;
    if (target && target.isConnected) {
      target.focus();
    }
  }

  private _findActiveElement(): HTMLElement | null {
    let el = document.activeElement as HTMLElement | null;
    while (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement as HTMLElement;
    }
    return el;
  }

  private _onDismiss(): void {
    this.hide();
  }

  private _onRevert(): void {
    this.dispatchEvent(new CustomEvent('dex-revert', {
      bubbles: true,
      composed: true,
    }));
    this.hide();
  }

  // Bound at the document level in capture while open, because Escape must
  // dismiss the dialog wherever focus happens to be. Listening only on the
  // dialog element left an unclosable modal whenever focus was outside it.
  private _onKeyDown = (e: KeyboardEvent): void => {
    if (!this._open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.hide();
      return;
    }
    if (e.key === 'Tab') this._trapTab(e);
  };

  // The dialog declares aria-modal, so Tab must cycle within it. Without this
  // the user tabs straight back into the table behind a blocking overlay they
  // can still see but no longer reach.
  private _trapTab(e: KeyboardEvent): void {
    const buttons = Array.from(this.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    if (buttons.length === 0) return;
    e.preventDefault();
    const active = this.shadowRoot?.activeElement as HTMLButtonElement | null;
    const at = active ? buttons.indexOf(active) : -1;
    const step = e.shiftKey ? -1 : 1;
    const next = (at + step + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('click', this._onBackdropClick);
  }

  private _onBackdropClick = (e: MouseEvent): void => {
    if (e.target === this) {
      this.hide();
    }
  };

  override render() {
    if (!this._open) return html``;

    return html`
      <div
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="title">${this.dialogTitle}</div>
        <div class="body">
          <div class="message">${this.message}</div>
          ${this.invalidValue || this.validValue ? html`
            <div class="values">
              ${this.invalidValue ? html`
                <div class="row">
                  <span class="label">Entered:</span>
                  <code class="value">${this.invalidValue}</code>
                </div>
              ` : ''}
              ${this.validValue ? html`
                <div class="row">
                  <span class="label">Previous:</span>
                  <code class="value">${this.validValue}</code>
                </div>
              ` : ''}
            </div>
          ` : ''}
          ${this.detail ? html`<div class="detail">${this.detail}</div>` : ''}
        </div>
        <div class="footer">
          ${this.showRevert ? html`
            <button class="revert" @click=${this._onRevert}>Revert</button>
          ` : ''}
          <button @click=${this._onDismiss}>OK</button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-error-dialog': DexErrorDialog;
  }
}
