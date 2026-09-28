// Copyright 2026 The MathWorks, Inc.
//
// The Add gallery: the popover the `⊞ Add` button opens, and the only surface in this
// extension that creates a dictionary entry from nothing.
//
// It creates nothing itself. A click dispatches `dex-add-tile` naming a class and a
// section, and the table relays that to the host, which is the one place a document is
// edited. The same split the column-filter popup uses (dex-column-filter.ts), for the
// same reason: a popup that also wrote would be a second path deciding what an add
// means, and two paths drift.
//
// Its one piece of real state is the pin, and the pin is the whole interaction model.
// Unpinned, an add closes the popover and the new row goes straight into rename — the
// overwhelmingly common case is one add followed by naming it, which is what New File in
// the Explorer costs. Pinned, the popover stays and adds land immediately, so a run of
// them is a run of single clicks.

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './dex-icon.js';
import { ADD_CATALOG, SECTION_LABEL, badgeOf, categorySection } from '../../common/addCatalog.js';
import type { GalleryCategory, GalleryTile } from '../../common/addCatalog.js';

/**
 * The popover's width, in px.
 *
 * Exported because the table anchors the popover and has to clamp it against the right
 * edge of a narrow split pane, and a second copy of this number would put the clamp and
 * the box in quiet disagreement — the popover would render 340 wide and be positioned as
 * if it were something else.
 */
export const ADD_GALLERY_WIDTH = 340;

@customElement('dex-add-gallery')
export class DexAddGallery extends LitElement {
  static override styles = css`
    :host {
      position: fixed;
      z-index: 1001;
      display: block;
      box-sizing: border-box;
      width: ${ADD_GALLERY_WIDTH}px;
      /* Six headings and 28 tiles do not fit a short editor. Capped against the
         viewport rather than a constant so a split pane scrolls instead of spilling
         past the bottom of the table it belongs to. */
      max-height: min(70vh, 560px);
      overflow-y: auto;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 12px;
      color: var(--dex-color-text, inherit);
      background: var(--dex-bg-primary, #fff);
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      padding: 8px;
    }

    /* Sticky so the pin stays reachable after scrolling to Configurations: the pin is
       what a user reaches for once they realise they want several adds, which is
       usually after they have already gone looking through the list. */
    .gallery-header {
      position: sticky;
      top: -8px;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: -8px -8px 6px;
      padding: 8px;
      background: var(--dex-bg-primary, #fff);
      border-bottom: 1px solid var(--dex-border-color-light, #e0e0e0);
    }

    .gallery-title {
      font-weight: 600;
    }

    .gallery-pin {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--dex-color-text-secondary, #666);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }

    .gallery-pin input {
      margin: 0;
    }

    .kind-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 8px 2px 4px;
      font-size: 11px;
      color: var(--dex-color-text-muted, #999);
      user-select: none;
      cursor: default;
    }

    .kind-name {
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--dex-color-text-secondary, #666);
    }

    .kind-dest {
      flex: 1 1 auto;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 4px;
    }

    .tile {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 26px;
      padding: 3px 6px;
      box-sizing: border-box;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 3px;
      background: var(--dex-bg-primary, #fff);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      outline: none;
    }

    .tile:hover {
      background: var(--dex-bg-hover, #e8e8e8);
    }

    .tile:focus-visible {
      border-color: var(--dex-color-accent, #0078d4);
    }

    .tile-label {
      flex: 1 1 auto;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    /* Only on a tile whose section differs from its heading's, which is 6 of 28.
       Badging every tile would make the badge furniture instead of a warning. */
    .tile-badge {
      flex: 0 0 auto;
      padding: 0 4px;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 8px;
      font-size: 10px;
      line-height: 14px;
      color: var(--dex-color-text-secondary, #666);
      background: var(--dex-bg-secondary, #f3f3f3);
    }

    /* Forced colors drops every background and border above, which would take the
       badge and the tile outline with it — the badge is the only thing on a mixed
       tile saying the row lands somewhere other than the heading claims. */
    @media (forced-colors: active) {
      .tile,
      .tile-badge {
        border: 1px solid ButtonText !important;
      }
      .tile:focus-visible {
        outline: 2px solid Highlight !important;
        outline-offset: 1px !important;
      }
    }
  `;

  /**
   * Whether an add keeps the popover open.
   *
   * Owned by the table, not here, so the choice survives closing and reopening within a
   * session: a user who pins is telling you about their next several minutes, not about
   * this one popover.
   */
  @property({ type: Boolean }) pinned = false;

  /** Focus the first tile, so the popover is usable from the keyboard on open. */
  override firstUpdated(): void {
    this.renderRoot.querySelector<HTMLButtonElement>('.tile')?.focus();
  }

  private _onTile(tile: GalleryTile): void {
    this.dispatchEvent(
      new CustomEvent('dex-add-tile', {
        detail: { className: tile.className, section: tile.section, label: tile.label },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onPin(pinned: boolean): void {
    this.pinned = pinned;
    this.dispatchEvent(new CustomEvent('dex-add-pin-changed', { detail: { pinned }, bubbles: true, composed: true }));
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent('dex-add-closed', { bubbles: true, composed: true }));
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    // Stopped so the table's own Escape — which clears the whole filter — does not also
    // fire. Dismissing a popover must not throw away the user's search.
    e.preventDefault();
    e.stopPropagation();
    this._close();
  }

  /**
   * What a heading says about where its tiles land.
   *
   * A uniform category states the section outright. A mixed one names the section most
   * of its tiles go to and points at the badges for the rest, because the alternative —
   * saying nothing — leaves the unbadged majority unexplained.
   */
  private _destText(category: GalleryCategory): string {
    const label = SECTION_LABEL[categorySection(category)];
    return category.uniformSection ? `→ ${label}` : `→ ${label}, except where badged`;
  }

  override render() {
    return html`
      <div role="dialog" aria-label="Add an entry" @keydown=${this._onKeyDown}>
        <div class="gallery-header">
          <span class="gallery-title">Add</span>
          <label
            class="gallery-pin"
            title="Stay open after each add. Entries land immediately and are not renamed; closing selects the whole run."
          >
            <input
              type="checkbox"
              .checked=${this.pinned}
              @change=${(e: Event) => this._onPin((e.target as HTMLInputElement).checked)}
            />
            Keep open
          </label>
        </div>
        ${ADD_CATALOG.map(
          (category) => html`
            <div class="kind-header">
              <span class="kind-name">${category.title}</span>
              <span class="kind-dest">${this._destText(category)}</span>
            </div>
            <div class="tiles" role="group" aria-label=${category.title}>
              ${category.tiles.map((tile) => this._renderTile(category, tile))}
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderTile(category: GalleryCategory, tile: GalleryTile) {
    const badge = badgeOf(category, tile);
    // The accessible name has to carry the destination whether or not a badge does:
    // a screen reader gets no heading context from a button inside a group, and the
    // destination is the one thing about a tile that is not in its label.
    const description = `Add ${tile.label} to ${SECTION_LABEL[tile.section]}`;
    return html`
      <button
        type="button"
        class="tile"
        data-class-name=${tile.className}
        data-section=${tile.section}
        aria-label=${description}
        title=${description}
        @click=${() => this._onTile(tile)}
      >
        <dex-icon .iconId=${tile.iconId} .size=${16}></dex-icon>
        <span class="tile-label">${tile.label}</span>
        ${badge ? html`<span class="tile-badge">${badge}</span>` : ''}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-add-gallery': DexAddGallery;
  }
}
