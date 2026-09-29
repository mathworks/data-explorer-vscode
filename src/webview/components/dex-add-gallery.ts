// Copyright 2026 The MathWorks, Inc.
//
// The Add gallery: the popover the `+ Add` button opens, and the only surface in this
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
import { customElement, property, state } from 'lit/decorators.js';
import './dex-icon.js';
import { ADD_CATALOG, SECTION_LABEL, badgeOf, labelLinesOf } from '../../common/addCatalog.js';
import type { GalleryCategory, GalleryTile } from '../../common/addCatalog.js';

/**
 * The popover's width when nobody says otherwise, in px.
 *
 * Normally somebody does: the table sets `--dex-add-gallery-width` to its own width, so the
 * gallery spans the editor tab rather than sitting in a column beside it (the maintainer's
 * call — a 300px popover in a 1400px editor read as a narrow strip of a much larger surface).
 * The column count follows from that width instead of being fixed, which is what the wrapping
 * row of fixed-size tiles gives.
 *
 * This fallback is what a `dex-add-gallery` rendered on its own gets. 300px holds two tile
 * columns of `TILE_WIDTH`, which is a legible gallery rather than a good one — it is a
 * default that keeps the component standalone-renderable, not a size anybody sees. Measured
 * with the browser harness; happy-dom lays nothing out, so no unit test here can see how wide
 * anything rendered.
 */
export const ADD_GALLERY_WIDTH = 300;

/**
 * How far in from each side of the table the popover sits, in px.
 *
 * So it reads as something floating over the table rather than a panel welded to the editor
 * tab (the maintainer's call): spanning the tab exactly, the popover's own border met the
 * tab's edges and the drop shadow had nowhere to fall, which is the whole of how a shadow
 * says "above". A strip of the table showing down each side is that cue.
 *
 * 8, because that is the filter bar's own horizontal padding, which puts this popover's left
 * border under the Add button's left border and its right border under the Columns button's
 * right border (the maintainer's ask, F5 2026-09-29). The two buttons are the first and last
 * items in that bar, so the bar's padding IS the line they stand on, and the popover hanging
 * off the same box should stand on it too — at 12 it was inset 4px further than the control
 * that opens it, which reads as a near-miss rather than as a margin. `.filter-bar` in
 * dex-tree-table.ts takes its padding from this constant so the two cannot drift.
 *
 * It is also the part that gives way first. {@link ADD_GALLERY_WIDTH} is the floor — the width
 * two tile columns need — and the table shrinks this inset toward 0 rather than squeezing the
 * gallery below it, because a margin is a nicety and a column of tiles is the content.
 */
export const ADD_GALLERY_INSET = 8;

/**
 * How wide every tile is, in px. Exactly this wide — not a minimum.
 *
 * The maintainer's call: the tiles are a fixed size and the gallery wraps them, rather than the
 * row stretching them to share out whatever the editor's width left over. Which means a tile is
 * the same size in a 1400px editor as in a 340px pane, and resizing the editor moves tiles
 * between rows instead of resizing all 28 of them. The cost is the ragged right-hand edge — the
 * remainder that used to be shared out is now dead space at the end of each row — and that is
 * the price of a stable target to click.
 *
 * 112 is what the BADGE allows, and that is the whole answer to why it is not smaller. The
 * maintainer asked for the narrowest width that still works for all the labels, and the labels
 * turn out never to have been the constraint: a line gets `TILE_WIDTH` less 10px of padding and
 * border, and the widest word in the catalog ("Connection") inks 65px, so on the labels alone a
 * tile of 80 would do.
 *
 * The badge in the top-right corner is what stops it. It is right-anchored 3px in from the tile's
 * edge and the icon is centred, so the icon approaches it at half the rate the tile narrows:
 *
 *     gap = width / 2 - ICON_SIZE / 2 - rightInset - badgeWidth
 *         = width / 2 - 12 - 3 - badgeWidth
 *         = width / 2 - 55        (the widest badge, "Config", inks 40)
 *
 * So this width leaves **1px**, measured in all four themes, and the floor is 110. It was 102
 * while the icon was 16px, and {@link ICON_SIZE} spent 8 of those 10 spare pixels on the icon
 * the maintainer asked for — the two constants are one decision, and this is the half that has
 * almost no slack left. 100 was measured in the browser at a 1px OVERLAP, which is what set a
 * floor here in the first place, and trimming the badge's own padding from 4px to 3px is what
 * bought the last pixel back.
 *
 * Down from 124, which left a 9px gap at a 16px icon — air nobody was looking at, inside tiles
 * whose emptiness the maintainer was (F5, 2026-09-28). A 1px gap is tight on purpose and it is
 * where the reference lands too: the MATLAB toolstrip's gallery clears its corner star by 2px
 * over an icon this size, in an item 44px narrower than this tile. The difference is that its
 * corner carries an 18px star and ours carries a word, because the internal app ships a
 * SEPARATE add gallery per destination — ten toolstrip tabs build one each — and so never has
 * to say where an entry lands, where this one merges all 28 tiles into a single popover and says
 * it in the corner. A 72px tile is available to whoever is willing to give that up.
 *
 * `badge.iconGap` in the browser harness is what notices when a platform's 10px font makes
 * that word wider than this one's does.
 *
 * The packing is better too, which was luck rather than design: 10 columns fit a 1200px editor
 * with 2px left over, where 124 fit 9 with 10px and 116 would fit 9 with 82. The cost is at the
 * other end — a 340px pane still holds two columns, so its dead space at the end of a row grows
 * from 46px to 70. Changing this number is a harness measurement, not an edit here.
 */
const TILE_WIDTH = 112;

/**
 * How big a tile's icon is, in px.
 *
 * 24, which is the size the MATLAB toolstrip's own gallery draws in exactly this layout — an
 * item with the icon above a two-line label. Its rule is `oneRow twoLine .iconWrapper
 * { height: 24px; width: 24px; margin: 4px auto 0 }` against a 68x64 item, so the icon is
 * more than a third of the item's width there. Ours was 16, which is the size that same
 * widget uses for its *dense* variants (the two- and three-row icon views, where a row is
 * 22-30px tall and an icon has to share it with text) — the wrong end of the same
 * stylesheet, and the reason a 112px tile read as mostly empty (maintainer, F5 2026-09-29).
 *
 * The badge is what caps it, on the same arithmetic {@link TILE_WIDTH} is built from: every
 * 2px of icon spends 1px of the gap between the centred icon and the right-anchored badge.
 * 24 leaves 1px, measured. That is deliberately tight and it is where the reference lands
 * too: the toolstrip puts its favourites star at `right: 2px` over a 24px icon in a 68px
 * item, which clears it by 2px. We are a pixel under that in a tile 44px wider, because our
 * corner carries a WORD ("Config", 40px) where theirs carries an 18px star — see
 * {@link TILE_WIDTH} for why that word exists at all.
 *
 * So this number and `TILE_WIDTH` are now one decision with two halves: at 24 the floor
 * under `TILE_WIDTH` is 110, not the 102 the labels ask for. Growing either without
 * re-measuring the other puts the badge on top of the icon, which is what `badge.iconGap`
 * in the browser harness exists to catch.
 */
const ICON_SIZE = 24;

@customElement('dex-add-gallery')
export class DexAddGallery extends LitElement {
  static override styles = css`
    /* No position and no z-index here. WHERE this goes is the table's business, because the
       anchor is the table's search bar and the width comes off the editor tab — see the
       dex-add-gallery rule in dex-tree-table.ts, which hangs this box under the bar in CSS
       alone. What is left here is what the panel IS, which is the same wherever it hangs. */
    :host {
      display: block;
      box-sizing: border-box;
      /* The table sets this to its own width so the gallery matches the editor tab; the
         constant is the fallback for a gallery rendered on its own. */
      width: var(--dex-add-gallery-width, ${ADD_GALLERY_WIDTH}px);
      /* ...but no wider than the tiles need, which is the maintainer's ask (F5 2026-09-29):
         "if the tab width is larger, the gallery should not follow, just show enough width to
         show all buttons in one row". Above about 960px of editor the width above was buying
         nothing — the widest category is 8 tiles, so a tenth column was empty in every row and
         the popover was mostly margin on the right.

         max-content, not a number. The intrinsic width of this box is the widest of its
         children, and the widest child is a .tiles row, whose own max-content is all of that
         category's tiles on ONE line (flex-wrap only wraps when it has to). So this says
         exactly "as wide as the biggest category needs and no wider" — 8 x TILE_WIDTH + 7 gaps
         + this padding and border, ~942px today — and it re-derives itself if a category gains
         a tile, which a constant here would not. The width above still shrinks below it, so a
         narrow pane is unaffected: the used width is min(tab - insets, this).

         One platform caveat, unmeasurable from macOS: where the scrollbar is classic rather
         than overlay, Chromium adds its thickness to a scroll container's intrinsic width, so
         the cap grows with it and the last tile stays on the row. If it ever does not, the fix
         is scrollbar-gutter: stable here, not a wider cap. */
      max-width: max-content;
      /* Six headings and 28 tiles do not fit a short editor. Capped against the
         viewport rather than a constant so a split pane scrolls instead of spilling
         past the bottom of the table it belongs to. 70vh also keeps it inside that
         table, which matters now that the table clips it: the bar it hangs from is
         ~35px tall, so the two only add up past 100vh in an editor no taller than a
         toolbar, where nothing would have been readable anyway.

         The absolute cap is 640 and not the 560 it was, because a 24px icon made every
         tile 8px taller and the whole catalog 610px: at 560 an editor of any height
         scrolled the last category out of sight, which is a worse trade than 80 more
         pixels of a tall editor. It is still a cap and not the content height, so one
         more category would scroll rather than grow this without a decision. */
      max-height: min(70vh, 640px);
      overflow-y: auto;
      font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 12px;
      color: var(--dex-color-text, inherit);
      /* Glass, on purpose (the maintainer's ask, F5 2026-09-29): the table stays visible
         through the popover as blurred shapes, which says "this is over your data, and it is
         temporary" in a way an opaque panel cannot.

         Three things have to be true for that to be VISIBLE, and the first round of this got
         two of them wrong in a way no computed style could show — it measured as translucent
         and blurred, and the F5 came back "I don't see any transparent effect":
           1. the tint must differ from the table. That is the token's job, and where the first
              round failed: 82% of the editor background over a table painted the editor
              background is the same colour. See --dex-add-gallery-tint in vscode-theme.css.
           2. the tiles must not paint over it (see .tile below).
           3. the blur must leave something to see. 12px, not the context menu's 20: a menu is
              a small box over a mostly uniform background, so 20px costs it nothing, but this
              panel covers ~600px of rows and at 20px their banding averages into a flat wash —
              a blur strong enough to hide that anything was behind it at all. 12px still
              smears a row's text well past reading while leaving the rows visible AS rows.

         The fallback in the var() is an OPAQUE background, deliberately: a webview whose theme
         file did not load gets a legible panel rather than a transparent one, and the blur
         below then has nothing to show through it. */
      background: var(--dex-add-gallery-bg, var(--dex-bg-primary, #fff));
      backdrop-filter: blur(12px) saturate(180%);
      -webkit-backdrop-filter: blur(12px) saturate(180%);
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      padding: 8px;
    }

    /* Sticky so the pin stays reachable after scrolling to Configurations: the pin is
       what a user reaches for once they realise they want several adds, which is
       usually after they have already gone looking through the list.

       It carries the glass too, and its own blur. A sticky bar over a translucent panel is
       the one place transparency can go wrong: the tiles slide UNDER this, and translucent it
       would show them through as legible, moving text next to the word "Add". Blurring its own
       backdrop — which is the tiles, not the table — turns that into the frosted strip the
       pattern is supposed to be, and its token is the solider of the two for the same reason:
       this strip has work to do while things move behind it.

       It carries the gloss as well, which is the last word of the ask ("a glossy glass
       effect") and belongs here rather than on the host: a sheen is a lit top EDGE, the host's
       top edge is underneath this bar, and being sticky this one stays at the visual top while
       the catalog scrolls past. White at 12% rather than a themed colour, because a highlight
       is light falling on the pane and not a colour the theme chose — on a light theme it
       lands on a pale sheet and barely shows, which is what a sheen does there too. Forced
       colors takes it off with the same one-line background substitution as everything else,
       since a shorthand resets the image. */
    .gallery-header {
      backdrop-filter: blur(12px) saturate(180%);
      -webkit-backdrop-filter: blur(12px) saturate(180%);
      position: sticky;
      top: -8px;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: -8px -8px 6px;
      padding: 8px;
      background: var(--dex-add-gallery-header-bg, var(--dex-bg-primary, #fff));
      background-image: linear-gradient(
        to bottom,
        rgba(255, 255, 255, 0.12),
        rgba(255, 255, 255, 0)
      );
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

    /* The heading names the kind and nothing else. It used to carry the destination
       section too ("→ Design Data, except where badged"); the maintainer's call is that
       the line was noise — where a row lands is on the tiles that depart from their
       neighbours, and in every tile's accessible name. */
    .kind-header {
      padding: 8px 2px 4px;
      font-size: 11px;
      user-select: none;
      cursor: default;
    }

    .kind-name {
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--dex-color-text-secondary, #666);
    }

    /* Wrap fixed-size tiles; do not stretch them to fill the row (the maintainer's call).
       This was a grid of repeat(auto-fill, minmax(124px, 1fr)) tracks, whose 1fr shared the
       row's remainder across the tiles — so a tile was 125px in a wide editor and 147px in a
       narrow pane, and every drag of the editor's edge resized all 28 of them. Flex-wrap with
       a rigid basis moves tiles between rows instead.

       Left-aligned rather than centred or space-between, so the columns line up across all
       six categories and with the headings above them: a row of two tiles and a row of nine
       start at the same x. Centring each row would make the grid look ragged on both sides
       instead of one, for nothing. */
    .tiles {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: 4px;
    }

    /* A gallery tile, not a menu row: the icon sits over the label, centred, the way the
       MATLAB toolstrip's galleries and the internal app's side panel draw one. The cost
       against a single dense row is height — 28 tiles are ~10 rows, so the popover
       scrolls — and the gain is that a label gets the full tile width on two lines
       instead of whatever the icon and a badge left it on one. */
    .tile {
      /* For the badge, which is positioned into this tile's own top-right corner. */
      position: relative;
      /* The fixed size, and the shorthand says all three parts of it on purpose: never grow
         into the row's remainder, never shrink out of the way of a neighbour, and take the
         basis from the constant. With box-sizing: border-box below, that is the whole tile
         including its 1px border. A pane too narrow for one tile scrolls sideways rather than
         squeezing it, which the grid did too — and a pane that narrow shows no usable table. */
      flex: 0 0 ${TILE_WIDTH}px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      min-height: 58px;
      padding: 6px 4px;
      box-sizing: border-box;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 3px;
      /* No surface of its own: a tile is a border and a label, and what fills it is the glass
         behind it. This is the second of the three things :host lists, and the first round got
         it wrong. A tile is 112x58 and there are 28 of them behind 4px gutters, so the tiles
         are ~90% of this panel's area — paint them and the effect survives only in the gutters,
         which is indistinguishable from no effect. A wash was tried there first (88% of the
         same mix) and it was the worst of both: still enough chrome to hide the pane, and one
         more number to keep in step with the surface's.

         What replaces the fill as the "this is a button" cue is the hover, which is now a
         change from nothing to a surface rather than one surface to another — a stronger cue
         than it was. That colour is the theme's own list-hover (opaque in the standard themes,
         a 10% wash in the high-contrast ones; VS Code's call either way). The border and the
         focus ring are untouched, so the grid stays legible against the blurred rows. */
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: center;
      cursor: pointer;
      outline: none;
    }

    .tile:hover {
      background: var(--dex-bg-hover, #e8e8e8);
    }

    .tile:focus-visible {
      border-color: var(--dex-color-accent, #0078d4);
    }

    /* One element per line, and the lines are chosen in the catalog rather than by this
       box running out of room (labelLinesOf). So a tile is only as wide as the longest
       WORD, never the longest label — which is what made the popover 80px narrower — and
       no label can be clipped the way "Variant Config Data" once was to "Variant Co…". */
    .tile-label {
      flex: 0 0 auto;
      align-self: stretch;
    }

    /* break-word is a backstop, not the mechanism: it only matters if a future one-word
       label outgrows the 102px a line gets, and then it wraps inside its own tile rather
       than over its neighbour. */
    .tile-line {
      display: block;
      line-height: 14px;
      overflow-wrap: break-word;
    }

    /* Only on a tile whose section differs from the rest of its category, which is 6 of
       28 — and, now that the heading states no destination, the only thing on the face of
       the gallery distinguishing the four Types tiles that appear twice under one heading.
       Badging every tile would make the badge furniture instead of a warning.

       In the corner and OUT OF THE FLOW, which is what makes every tile the same height: as
       a flex child it added a third row to the six tiles that carry one, and a row of tiles
       is as tall as its tallest, so those six dragged twelve neighbours up with them. The
       corner it sits in is the tile's own, beside the centred icon — TILE_WIDTH and ICON_SIZE
       together are what keep the two from touching, and since both are fixed so is the 1px gap
       they leave: it no longer widens in a wide editor. Still last in DOM order, after the
       label; nothing about the reading order changed, and the tile's accessible name was never
       these words.

       3px of horizontal padding rather than 4, which is 2px off the widest badge and so 1px of
       the gap above bought back. It is the cheapest px in this component: the badge is a 10px
       word on a rounded surface, and at 4px it had more air inside it than the tile has beside
       it. That pixel is now the whole margin between a 24px icon and this badge, so this is a
       declaration to leave alone rather than tidy. */
    .tile-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      padding: 0 3px;
      border: 1px solid var(--dex-border-color, #d0d0d0);
      border-radius: 8px;
      font-size: 10px;
      line-height: 14px;
      color: var(--dex-color-text-secondary, #666);
      background: var(--dex-bg-secondary, #f3f3f3);
    }

    /* Forced colors drops every background and border above, which would take the badge
       and the tile outline with it — and the badge is the only thing telling a tile from
       the same-labelled one a few rows up that writes to a different section. */
    @media (forced-colors: active) {
      .tile,
      .tile-badge {
        border: 1px solid ButtonText !important;
      }
      /* And the glass goes. Forced colors already replaces the background with Canvas, but
         the blur is not a colour and would survive it — a high-contrast user would get the
         one thing the mode exists to remove, the table smeared under the text. Canvas is
         named explicitly so the panel is opaque even where the system palette allows alpha,
         because a translucent surface in this mode is a legibility bug, not a style. */
      :host,
      .gallery-header {
        background: Canvas !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
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

  /**
   * Which tile is the grid's one tab stop — the roving tabindex.
   *
   * 28 tiles were 28 tab stops, so reaching Configurations from the keyboard cost 20-odd
   * presses of Tab and leaving the gallery cost the rest. The pattern every grid of buttons
   * uses instead is this: the grid is ONE stop, and the arrows move within it. Tab then means
   * "leave", which is what a user pressing it wants.
   *
   * An index into the tiles in DOM order, which is the catalog's order. Not a tile identity,
   * because the movement is positional: Left/Right is a step along this list and runs from the
   * end of one row into the start of the next, while Up/Down is measured off the boxes the
   * grid actually drew (see _rowStep) — the column count depends on how wide the editor is,
   * so it is not a number this component can do arithmetic with.
   */
  @state() private _activeIndex = 0;

  /** Focus the first tile, so the popover is usable from the keyboard on open. */
  override firstUpdated(): void {
    this._focusTile(0);
  }

  /** The tiles in drawn order. Read from the DOM, because that IS the order arrows step. */
  private _tiles(): HTMLButtonElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.tile')];
  }

  private _focusTile(index: number): void {
    this._activeIndex = index;
    this._tiles()[index]?.focus();
  }

  /**
   * Keep the tab stop on whatever the user last touched.
   *
   * Focus can land on a tile without an arrow key: a click, a Shift+Tab back in from the
   * pin. If the stop did not follow, Tab would leave from one tile while the arrows carried
   * on from another, and the first arrow press after a click would jump somewhere unrelated.
   */
  private _onFocusIn(e: FocusEvent): void {
    const index = this._tiles().indexOf(e.target as HTMLButtonElement);
    if (index >= 0) this._activeIndex = index;
  }

  /**
   * Where a key takes the focus, or null if this component has no answer for it.
   *
   * Clamped at both ends rather than wrapping. A gallery is a surface with a shape, not a
   * carousel: Right at the last tile wrapping to the first would lose the user's place in a
   * list six headings long, and the bottom of the list is where the arrow keys should stop.
   */
  private _nextIndex(key: string): number | null {
    const tiles = this._tiles();
    if (tiles.length === 0) return null;
    const last = tiles.length - 1;
    // Clamped on the way IN as well, so a catalog that shrank under a stale index cannot
    // make every key a no-op.
    const from = Math.min(Math.max(this._activeIndex, 0), last);
    switch (key) {
      case 'ArrowRight':
        return Math.min(from + 1, last);
      case 'ArrowLeft':
        return Math.max(from - 1, 0);
      case 'Home':
        return 0;
      case 'End':
        return last;
      case 'ArrowDown':
        return this._rowStep(tiles, from, 1);
      case 'ArrowUp':
        return this._rowStep(tiles, from, -1);
      default:
        return null;
    }
  }

  /**
   * The tile one row down (dir 1) or up (dir -1), by geometry.
   *
   * Geometry rather than index arithmetic, because the column count is not a constant here:
   * the gallery is as wide as the editor tab, so a row holds nine tiles in a maximised window
   * and two in a narrow pane. Measuring the boxes also makes a heading no obstacle — the
   * nearest row above the first row of Types is the last row of Interfaces, which is exactly
   * where Up should go.
   *
   * Finds the nearest row edge in that direction, then the tile in it whose centre is closest
   * horizontally, so a column is held while moving down it. Returns `from` at the ends.
   *
   * Needs a layout engine, so it is the one part of this that happy-dom cannot exercise: every
   * box there is 0x0, every top is equal, and this correctly answers "no row that way". It is
   * checked in the browser harness instead.
   */
  private _rowStep(tiles: HTMLElement[], from: number, dir: 1 | -1): number {
    const boxes = tiles.map((el) => el.getBoundingClientRect());
    const here = boxes[from];
    const centre = here.left + here.width / 2;
    // A row is "the same top, within a pixel" — a tile's height is uniform, but a subpixel
    // grid position is not something to compare exactly.
    let rowTop: number | null = null;
    for (const box of boxes) {
      const beyond = dir === 1 ? box.top > here.top + 1 : box.top < here.top - 1;
      if (!beyond) continue;
      if (rowTop === null || (dir === 1 ? box.top < rowTop : box.top > rowTop)) rowTop = box.top;
    }
    if (rowTop === null) return from;
    const top = rowTop;
    let best = from;
    let bestDistance = Infinity;
    boxes.forEach((box, index) => {
      if (Math.abs(box.top - top) > 1) return;
      const distance = Math.abs(box.left + box.width / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
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
    if (e.key === 'Escape') {
      // Stopped so the table's own Escape — which clears the whole filter — does not also
      // fire. Dismissing a popover must not throw away the user's search.
      e.preventDefault();
      e.stopPropagation();
      this._close();
      return;
    }
    // Only from a tile. The one other focusable thing in here is the pin checkbox, and a key
    // pressed on a checkbox belongs to the checkbox — the grid taking the arrows from it would
    // teleport the focus out of the header.
    if (!(e.target as HTMLElement | null)?.classList?.contains('tile')) return;
    const next = this._nextIndex(e.key);
    if (next === null) return;
    // Both halves matter. preventDefault stops the arrow from ALSO scrolling the popover,
    // which would move the tile out from under the focus it just landed on; stopPropagation
    // keeps it off the table behind, where an arrow moves the row selection.
    e.preventDefault();
    e.stopPropagation();
    this._focusTile(next);
    // Home and End mean the ends of the CATALOG, not just its end tiles. Focusing a tile
    // scrolls it no further than it has to ("nearest"), which stops with the tile's edge against
    // the popover's — so Home landed on the first tile with the "Parameters" heading above it
    // still scrolled out of sight, and the gallery looked untouched by the key that was meant to
    // take the user back to the start. Harmless while the whole catalog fitted; the taller tile
    // that came with a 24px icon made the popover scroll at ordinary editor heights, which is
    // where it started to show. Set after the focus, so it overrides that implicit scroll.
    if (e.key === 'Home') this.scrollTop = 0;
    if (e.key === 'End') this.scrollTop = this.scrollHeight;
  }

  override render() {
    // The flat position of each tile, counted across categories as they are drawn, because
    // that is the list the arrows walk — Right at the end of Parameters goes to the first
    // Signal, not nowhere. Counted here rather than looked up per tile so the number cannot
    // disagree with the DOM order it names.
    let index = 0;
    return html`
      <div role="dialog" aria-label="Add an entry" @keydown=${this._onKeyDown} @focusin=${this._onFocusIn}>
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
            </div>
            <div class="tiles" role="group" aria-label=${category.title}>
              ${category.tiles.map((tile) => this._renderTile(category, tile, index++))}
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderTile(category: GalleryCategory, tile: GalleryTile, index: number) {
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
        data-index=${index}
        tabindex=${index === this._activeIndex ? 0 : -1}
        aria-label=${description}
        title=${description}
        @click=${() => this._onTile(tile)}
      >
        <dex-icon .iconId=${tile.iconId} .size=${ICON_SIZE}></dex-icon>
        <span class="tile-label"
          >${labelLinesOf(tile).map((line) => html`<span class="tile-line">${line}</span>`)}</span
        >
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
