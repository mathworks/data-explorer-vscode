// Copyright 2026 The MathWorks, Inc.

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';

export interface PropertyGroup {
  title: string;
  properties: PropertyRow[];
}

export interface PropertyRow {
  name: string;
  value: string;
  editable?: boolean;
  type?: 'text' | 'link';
  linkTarget?: string;
}

@customElement('dex-property-inspector')
export class DexPropertyInspector extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
    }

    .content {
      flex: 1 1 0;
      overflow: auto;
      min-height: 0;
      padding: 8px;
      container-type: inline-size;
    }

    .group {
      margin-bottom: 12px;
    }

    .group-header {
      font-weight: 600;
      font-size: 12px;
      padding: 4px 0;
      border-bottom: 1px solid var(--dex-border-color-light, #e0e0e0);
      margin-bottom: 4px;
    }

    .prop-row {
      display: flex;
      flex-wrap: wrap;
      padding: 3px 0;
      font-size: 12px;
      align-items: baseline;
    }

    .prop-name {
      flex: 0 0 120px;
      color: var(--dex-color-text-secondary, #555);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .prop-value {
      flex: 1 1 0;
      color: var(--dex-color-text, #333);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @container (max-width: 240px) {
      .prop-row {
        flex-direction: column;
        gap: 1px;
      }

      .prop-name {
        flex: none;
        font-size: 11px;
        font-weight: 500;
      }

      .prop-value {
        flex: none;
        width: 100%;
        padding-left: 8px;
        box-sizing: border-box;
      }
    }

    .prop-input {
      width: 100%;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 2px;
      padding: 2px 4px;
      font-size: 12px;
      font-family: inherit;
      box-sizing: border-box;
    }

    .prop-input:focus {
      border-color: var(--dex-color-accent, #0078d4);
      outline: none;
      box-shadow: 0 0 0 1px var(--dex-color-accent, #0078d4);
    }

    .prop-link {
      color: var(--dex-color-accent, #0078d4);
      text-decoration: none;
      cursor: pointer;
    }

    .prop-link:hover {
      text-decoration: underline;
    }

    .prop-status {
      font-size: 11px;
      color: var(--dex-color-text-secondary, #888);
    }
  `;

  @property({ type: Array }) groups: PropertyGroup[] = [];

  private _onPropertyChange(propName: string, newValue: string, oldValue: string): void {
    this.dispatchEvent(new CustomEvent('dex-property-changed', {
      detail: { propName, newValue, oldValue },
      bubbles: true,
      composed: true,
    }));
  }

  private _onLinkClick(e: Event, target: string): void {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('dex-pi-navigate', {
      detail: { sourceId: target },
      bubbles: true,
      composed: true,
    }));
  }

  private _renderPropertyValue(prop: PropertyRow): unknown {
    if (prop.type === 'link') {
      const target = prop.linkTarget || prop.name;
      return html`<a class="prop-link" href="#" @click=${(e: Event) => this._onLinkClick(e, target)}>${prop.value}</a>`;
    }
    if (prop.editable) {
      return html`<input
        class="prop-input"
        .value=${live(prop.value)}
        @change=${(e: Event) => this._onPropertyChange(prop.name, (e.target as HTMLInputElement).value, prop.value)}
      />`;
    }
    return html`<span>${prop.value}</span>`;
  }

  override render() {
    return html`
      <div class="content">
        ${this.groups.map(group => html`
          <div class="group">
            <div class="group-header">${group.title}</div>
            ${group.properties.map(prop => prop.type === 'link' ? html`
              <div class="prop-row">
                <span class="prop-name">
                  <a class="prop-link" href="#" @click=${(e: Event) => this._onLinkClick(e, prop.linkTarget || prop.name)}>${prop.name}</a>
                </span>
                <span class="prop-value prop-status">${prop.value}</span>
              </div>
            ` : html`
              <div class="prop-row">
                <span class="prop-name" title="${prop.name}">${prop.name}</span>
                <span class="prop-value">${this._renderPropertyValue(prop)}</span>
              </div>
            `)}
          </div>
        `)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-property-inspector': DexPropertyInspector;
  }
}
