// Copyright 2026 The MathWorks, Inc.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { menuitemFocusRingStyles } from '../styles/focus.styles.js';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
}

@customElement('dex-context-menu')
export class DexContextMenu extends LitElement {
  static override styles = [menuitemFocusRingStyles, css`
    :host {
      position: fixed;
      z-index: 10000;
      display: none;
    }

    :host([open]) {
      display: block;
    }

    .menu {
      background: var(--dex-context-menu-bg, rgba(252, 252, 252, 0.96));
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--dex-context-menu-border, rgba(0, 0, 0, 0.08));
      border-radius: 8px;
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.14),
        0 2px 8px rgba(0, 0, 0, 0.06);
      min-width: 200px;
      padding: 4px;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      color: var(--dex-color-text, #1a1a1a);
      animation: contextMenuIn 0.12s ease-out;
    }

    @keyframes contextMenuIn {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(-4px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .menu {
        animation: none;
      }
    }

    .item {
      display: flex;
      align-items: center;
      height: 32px;
      padding: 0 12px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      gap: 12px;
    }

    .item:hover:not(.disabled) {
      background: var(--dex-context-menu-hover, rgba(0, 0, 0, 0.04));
    }

    .item:active:not(.disabled) {
      background: var(--dex-context-menu-active, rgba(0, 0, 0, 0.06));
    }

    .item.disabled {
      color: var(--dex-color-text-disabled, rgba(0, 0, 0, 0.36));
      cursor: default;
    }

    .item-icon {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      opacity: 0.85;
    }

    .item.disabled .item-icon {
      opacity: 0.36;
    }

    .item-icon svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }

    .item-label {
      flex: 1;
    }

    .item-shortcut {
      color: var(--dex-color-text-muted, rgba(0, 0, 0, 0.5));
      font-size: 12px;
      margin-left: 24px;
    }

    .item.disabled .item-shortcut {
      color: var(--dex-color-text-disabled, rgba(0, 0, 0, 0.36));
    }

    .separator {
      height: 1px;
      background: var(--dex-context-menu-separator, rgba(0, 0, 0, 0.08));
      margin: 4px 12px;
    }
  `];

  @state() private _open = false;
  @state() private _items: ContextMenuItem[] = [];
  @state() private _x = 0;
  @state() private _y = 0;
  @state() private _focusedIndex = -1;

  private _dismissHandler = (e: MouseEvent) => {
    if (!e.composedPath().includes(this)) {
      this.close();
    }
  };

  private _contextMenuHandler = (e: MouseEvent) => {
    if (!e.composedPath().includes(this)) {
      this.close();
    }
  };

  private _keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._moveFocus(-1);
    } else if (e.key === 'Enter' && this._focusedIndex >= 0) {
      e.preventDefault();
      const items = this._getActionItems();
      if (items[this._focusedIndex]) {
        this._onItemClick(items[this._focusedIndex]);
      }
    }
  };

  private _scrollHandler = () => {
    this.close();
  };

  show(x: number, y: number, items: ContextMenuItem[]): void {
    this._x = x;
    this._y = y;
    this._items = items;
    this._open = true;
    this._focusedIndex = -1;
    this.setAttribute('open', '');

    requestAnimationFrame(() => {
      this._clampPosition();
      document.addEventListener('mousedown', this._dismissHandler);
      document.addEventListener('contextmenu', this._contextMenuHandler);
      document.addEventListener('keydown', this._keyHandler);
      window.addEventListener('scroll', this._scrollHandler, true);
    });
  }

  close(): void {
    this._open = false;
    this._focusedIndex = -1;
    this.removeAttribute('open');
    document.removeEventListener('mousedown', this._dismissHandler);
    document.removeEventListener('contextmenu', this._contextMenuHandler);
    document.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('scroll', this._scrollHandler, true);
  }

  private _clampPosition(): void {
    const menu = this.shadowRoot?.querySelector('.menu') as HTMLElement;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    let x = this._x;
    let y = this._y;
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8;
    }
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8;
    }
    this.style.left = `${Math.max(0, x)}px`;
    this.style.top = `${Math.max(0, y)}px`;
  }

  private _getActionItems(): ContextMenuItem[] {
    return this._items.filter(i => !i.separator);
  }

  private _moveFocus(direction: number): void {
    const items = this._getActionItems();
    if (items.length === 0) return;
    let idx = this._focusedIndex + direction;
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    // Skip disabled items
    let attempts = 0;
    while (items[idx].disabled && attempts < items.length) {
      idx += direction;
      if (idx < 0) idx = items.length - 1;
      if (idx >= items.length) idx = 0;
      attempts++;
    }
    this._focusedIndex = idx;
  }

  private _onItemClick(item: ContextMenuItem): void {
    if (item.disabled) return;
    this.dispatchEvent(new CustomEvent('dex-action', {
      detail: { actionId: item.id },
      bubbles: true,
      composed: true,
    }));
    this.close();
  }

  private _renderIcon(icon: string | undefined) {
    if (!icon) return html`<span class="item-icon"></span>`;
    return html`<span class="item-icon">${this._getSvgIcon(icon)}</span>`;
  }

  private _getSvgIcon(icon: string) {
    switch (icon) {
      case 'addChild':
        return html`<svg viewBox="0 0 16 16"><path d="M1 2h5v3H1V2zm3 3v2h3V6H5v1H4V5zm4 1h5v3H8V6zM4 8v3h3V9H5V8H4zm4 2h2v-1h1v1h1v1h-1v1h-1v-1H8v-1z"/></svg>`;
      case 'cut':
        return html`<svg viewBox="0 0 16 16"><path d="M4.5 2a2.5 2.5 0 0 0-1.3 4.64L6.14 8 3.2 9.36A2.5 2.5 0 1 0 4.5 14a2.5 2.5 0 0 0 1.3-4.64L7.5 8.5l4.5 3.5h2l-6-4.5 6-4.5h-2L7.5 7.5 5.8 6.64A2.5 2.5 0 0 0 4.5 2zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>`;
      case 'copy':
        return html`<svg viewBox="0 0 16 16"><path d="M4 4v10h8V4H4zm1 1h6v8H5V5zm5-3H3v9h1V3h6V2z"/></svg>`;
      case 'paste':
        return html`<svg viewBox="0 0 16 16"><path d="M5 1a1 1 0 0 0-1 1H3v12h10V2h-1a1 1 0 0 0-1-1H5zm0 1h6v1H5V2zM4 3h1v1h6V3h1v10H4V3z"/></svg>`;
      case 'delete':
        return html`<svg viewBox="0 0 16 16"><path d="M5.5 1a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zM3 3v1h10V3H3zm1 2v9h8V5H4zm2 1h1v7H6V6zm3 0h1v7H9V6z"/></svg>`;
      case 'save':
        return html`<svg viewBox="0 0 16 16"><path d="M11 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4l-3-3zm2 13H3V2h7v3h3v9zM8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 4h5v2H4V4z"/></svg>`;
      case 'saveAs':
        return html`<svg viewBox="0 0 16 16"><path d="M11 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4l-3-3zm2 13H3V2h7v3h3v9zM8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 4h5v2H4V4zM12 11l1.5 1.5-3.5 3.5H8.5v-1.5L12 11z"/></svg>`;
      case 'close':
        return html`<svg viewBox="0 0 16 16"><path d="M12.12 4.94L8.06 9l4.06 4.06-1.06 1.06L7 10.06l-4.06 4.06-1.06-1.06L5.94 9 1.88 4.94l1.06-1.06L7 7.94l4.06-4.06 1.06 1.06z"/></svg>`;
      case 'locate':
        return html`<svg viewBox="0 0 16 16"><path d="M2 2h12v2H2V2zm0 4h8v2H2V6zm0 4h8v2H2v-2zm10.5-3.5l3 3-3 3-1-1 1.3-1.3H11v-1.4h2.8L12.5 8l1-1.5z"/></svg>`;
      default:
        return nothing;
    }
  }

  override render() {
    if (!this._open) return html``;

    const actionItems = this._getActionItems();

    return html`
      <div class="menu" role="menu">
        ${this._items.map(item => {
          if (item.separator) {
            return html`<div class="separator" role="separator"></div>`;
          }
          const actionIdx = actionItems.indexOf(item);
          const isFocused = actionIdx === this._focusedIndex;
          return html`
            <div
              class="item ${item.disabled ? 'disabled' : ''} ${isFocused ? 'focused' : ''}"
              role="menuitem"
              tabindex="${item.disabled ? '-1' : '0'}"
              aria-disabled="${item.disabled ? 'true' : 'false'}"
              @click=${() => this._onItemClick(item)}
              @mouseenter=${() => { this._focusedIndex = actionIdx; }}
            >
              ${this._renderIcon(item.icon)}
              <span class="item-label">${item.label}</span>
              ${item.shortcut ? html`<span class="item-shortcut">${item.shortcut}</span>` : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-context-menu': DexContextMenu;
  }
}
