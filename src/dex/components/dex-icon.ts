// Copyright 2026 The MathWorks, Inc.

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

const ALIASES: Record<string, string> = {
  struct: 'typeStruct',
  cell: 'wsBrackets',
  string: 'wsString',
  parameter: 'wsParameters',
  bus: 'typeBus',
  enum: 'typeEnum',
  signal: 'typeSignal',
  alias: 'typeAlias',
  numeric: 'typeNumeric',
  structElement: 'typeStructElement',
  signalObject: 'typeSignal',
  connectionBus: 'typeBus',
  numericType: 'typeNumeric',
  aliasType: 'typeAlias',
  valueType: 'typeStruct',
  variant: 'variantUI',
  configSet: 'settings',
  matlabVariable: 'wsParameters',
  matlabStruct: 'typeStruct',
};

function resolveId(iconId: string): string {
  return ALIASES[iconId] || iconId;
}

@customElement('dex-icon')
export class DexIcon extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: middle;
    }

    img {
      display: block;
    }
  `;

  @property({ type: String }) iconId = '';
  @property({ type: Number }) size = 16;

  private _base = import.meta.env.BASE_URL || '/';

  override render() {
    if (!this.iconId) {
      return html``;
    }
    const resolved = resolveId(this.iconId);
    return html`
      <img
        src="${this._base}icons/${resolved}.svg"
        width="${this.size}"
        height="${this.size}"
        alt=""
        aria-hidden="true"
      />
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-icon': DexIcon;
  }
}
