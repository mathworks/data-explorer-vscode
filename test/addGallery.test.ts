// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Add gallery popover, and the table's button that opens it.
//
// What is worth pinning here is not that 28 buttons render — the catalog guard already
// owns the tiles' truth (addCatalog.test.ts) — but the interaction model, which is where
// the design made choices that are easy to undo by accident:
//
//   - the button is ABSENT on a read-only view, not disabled;
//   - an unpinned add closes the popover, a pinned one does not;
//   - the pin outlives a close, because it describes the user's next few minutes;
//   - Escape and a click outside dismiss, and Escape does not also wipe the search box;
//   - the popover creates nothing itself — it names a class and a section and the table
//     relays that outward, which is the split that keeps one path writing documents.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../src/webview/components/dex-add-gallery.js';
import type { DexAddGallery } from '../src/webview/components/dex-add-gallery.js';
import '../src/webview/components/dex-tree-table.js';
import type { DexTreeTable, TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { ADD_CATALOG, allTiles } from '../src/common/addCatalog.js';

// The popover's geometry used to be two exported TS constants that both components interpolated
// into their css`` templates. It is two custom properties in vscode-theme.css now — the
// maintainer's ask, twice: "why do you do styling calculation in TS code, it should be done
// through CSS only" (2026-09-29), after the same objection about the responsive width. So the
// numbers these tests reason about are READ FROM THAT STYLESHEET rather than imported, which is
// also the only way this file can still check that the two shadow roots agree: a document custom
// property is the one value they can share, and nothing in TS knows it any more.
//
// Read off the cwd rather than import.meta.url: this file runs under happy-dom, where that URL is
// an http one and fileURLToPath throws on it (same note as treeTableCellStates.test.ts). Comments
// go first, because that stylesheet quotes token names in its prose to explain them.
const THEME_CSS = readFileSync(resolve('src/webview/vscode-theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** A geometry token's declared px value, as a number. */
function px(name: string): number {
  const m = new RegExp(`${name}\\s*:\\s*(\\d+)px\\s*;`).exec(THEME_CSS);
  expect(m, `${name} is not declared in px in vscode-theme.css`).not.toBeNull();
  return Number(m![1]);
}

const INSET = px('--dex-add-gallery-inset');
const FLOOR = px('--dex-add-gallery-min-width');

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement;
const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];

async function gallery(pinned = false): Promise<DexAddGallery> {
  const el = document.createElement('dex-add-gallery') as DexAddGallery;
  el.pinned = pinned;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('dex-add-gallery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders every category in order, and states no destination in the heading', async () => {
    const el = await gallery();
    expect($$(el, '.kind-name').map((n) => n.textContent!.trim())).toEqual(
      ADD_CATALOG.map((c) => c.title),
    );
    // A heading names the kind and nothing else (maintainer's call, 2026-09-28). Where a
    // row lands is carried by the badge on the tiles that depart from their neighbours and
    // by every tile's accessible name — not by a line under each heading repeating it.
    expect($$(el, '.kind-dest')).toEqual([]);
  });

  it('renders one tile per catalog entry, in catalog order', async () => {
    const el = await gallery();
    const tiles = $$(el, '.tile');
    expect(tiles.map((t) => t.dataset.className)).toEqual(allTiles().map((t) => t.className));
    expect(tiles.map((t) => t.dataset.section)).toEqual(allTiles().map((t) => t.section));
  });

  // The destination is the one fact about a tile that is not in its label, and a button
  // inside a group gets no heading context read to it — so it has to be in the name.
  it('names the destination in every tile’s accessible name, badged or not', async () => {
    const el = await gallery();
    const unbadged = $$(el, '.tile').find((t) => t.dataset.className === 'Simulink.Parameter')!;
    const badged = $$(el, '.tile').find((t) => t.dataset.className === 'Constant')!;
    expect(unbadged.getAttribute('aria-label')).toBe('Add Simulink Parameter to Design Data');
    expect(badged.getAttribute('aria-label')).toBe('Add Constant to Architectural Data');
    // `Variant Config` used to be the case this claim carried alone — it departed from its
    // heading with no badge, so a screen reader got the destination from here or from nothing.
    // Its destination is Design Data now, measured against MATLAB (core's SectionNode), and the
    // name is still asserted because the label does not contain it: the tile reads `Variant
    // Config`, so `Design Data` is spoken only if this attribute says it.
    const noBadge = $$(el, '.tile').find(
      (t) => t.dataset.className === 'Simulink.VariantConfigurationData',
    )!;
    expect(noBadge.getAttribute('aria-label')).toBe('Add Variant Config to Design Data');
  });

  // The break is data, not something the text box arrived at: one word per line, so a tile
  // only has to be as wide as the longest WORD in the catalog rather than the longest label.
  // The accessible name above stays one line — a newline there would be read aloud and shown
  // in the tooltip.
  it('draws a label one word to a line, and the one three-word label as two', async () => {
    const el = await gallery();
    const linesOf = (className: string) =>
      [
        ...$$(el, '.tile')
          .find((t) => t.dataset.className === className)!
          .querySelectorAll('.tile-line'),
      ].map((n) => n.textContent!.trim());
    expect(linesOf('Simulink.Parameter')).toEqual(['Simulink', 'Parameter']);
    expect(linesOf('Simulink.Breakpoint')).toEqual(['Breakpoint']);
    expect(linesOf('Simulink.VariantBankCoderInfo')).toEqual(['Bank', 'Coder Info']);
  });

  // The icon is 24px because that is what the MATLAB toolstrip's gallery draws in this exact
  // layout — an item with the icon over a two-line label — where 16px is what the same widget
  // uses for its dense list-style variants. Pinned as a number because it is not a free
  // parameter: the badge is right-anchored and the icon is centred, so every 2px of icon
  // spends 1px of the gap between them, and at 24 that gap is down to 1px (measured in the
  // browser harness, which is the only place any of this has a size at all — happy-dom
  // reports every box as 0x0). A well-meant bump to 28 or 32 here silently puts the badge on
  // top of the glyph; the harness's `badge.iconGap` is the other half of this guard.
  it('draws every tile’s icon at the toolstrip gallery’s size, not the dense-list size', async () => {
    const el = await gallery();
    const sizes = $$(el, '.tile dex-icon').map((n) => (n as any).size);
    expect(sizes.length).toBe(allTiles().length);
    expect([...new Set(sizes)]).toEqual([24]);
  });

  it('badges only the tiles that depart from their category', async () => {
    const el = await gallery();
    const badged = $$(el, '.tile')
      .filter((t) => t.querySelector('.tile-badge'))
      .map((t) => `${t.dataset.className} ${t.querySelector('.tile-badge')!.textContent!.trim()}`);
    expect(badged).toEqual([
      'Constant Arch',
      'Simulink.NumericType Arch',
      'Simulink.AliasType Arch',
      'Simulink.ValueType Arch',
      'Simulink.data.dictionary.EnumTypeDefinition Arch',
    ]);
  });

  // `Variant Config` draws no badge, and now for the ordinary reason: its destination is Design
  // Data, the same as every other tile under the Variants heading, so the heading states it once.
  // It reached the same place by a route that is gone — it used to write into Configurations and
  // carry a catalog opt-out from the badge, because its label already said `Config` (maintainer,
  // F6 2026-09-29) — and MATLAB then refused that destination outright in both file formats
  // (core's SectionNode carries the measurement). Kept as a DOM claim because the section it
  // lands in is what the tile hands the host, and this is the only place that attribute is read
  // back off the rendered tile.
  it('draws no badge on a Variants tile, which all land in Design Data', async () => {
    const el = await gallery();
    const tile = $$(el, '.tile').find((t) => t.dataset.className === 'Simulink.VariantConfigurationData')!;
    expect(tile.dataset.section).toBe('design');
    expect(tile.querySelector('.tile-badge')).toBeNull();
  });

  it('asks for the class and section the tile names, and nothing more', async () => {
    const el = await gallery();
    let detail: unknown = null;
    el.addEventListener('dex-add-tile', (e) => {
      detail = (e as CustomEvent).detail;
    });
    $$(el, '.tile')
      .find((t) => t.dataset.className === 'Simulink.ServiceBus')!
      .click();
    expect(detail).toEqual({
      className: 'Simulink.ServiceBus',
      section: 'arch',
      label: 'Service Interface',
    });
  });

  it('reports the pin rather than acting on it, so the table can keep the choice', async () => {
    const el = await gallery();
    const seen: unknown[] = [];
    el.addEventListener('dex-add-pin-changed', (e) => seen.push((e as CustomEvent).detail));
    const box = $(el, '.gallery-pin input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(seen).toEqual([{ pinned: true }]);
    expect(el.pinned).toBe(true);
  });

  it('opens showing the pin it was given', async () => {
    const el = await gallery(true);
    expect(($(el, '.gallery-pin input') as HTMLInputElement).checked).toBe(true);
  });

  it('Escape asks to close, and keeps the key to itself', async () => {
    const el = await gallery();
    let closed = 0;
    el.addEventListener('dex-add-closed', () => closed++);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
    $(el, '.tile').dispatchEvent(ev);
    expect(closed).toBe(1);
    // Not propagated: the table's own Escape clears the whole search, and dismissing a
    // popover must not throw away what the user typed to find the tile.
    expect(ev.cancelBubble).toBe(true);
  });

  it('puts focus on the first tile, so it is usable without the mouse', async () => {
    const el = await gallery();
    expect(el.shadowRoot!.activeElement).toBe($(el, '.tile'));
  });

  // --- Roving tabindex -------------------------------------------------------
  //
  // 28 tiles were 28 tab stops: Configurations was twenty-odd presses of Tab away, and
  // leaving the gallery was the rest of them. One stop for the grid, arrows within it.

  const stop = (el: DexAddGallery) => $$(el, '.tile').findIndex((t) => t.getAttribute('tabindex') === '0');
  const focused = (el: DexAddGallery) => $$(el, '.tile').indexOf(el.shadowRoot!.activeElement as HTMLElement);
  const press = async (el: DexAddGallery, key: string) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
    (el.shadowRoot!.activeElement as HTMLElement).dispatchEvent(ev);
    await el.updateComplete;
    return ev;
  };

  it('is one tab stop, not twenty-eight', async () => {
    const el = await gallery();
    const tiles = $$(el, '.tile');
    expect(tiles.filter((t) => t.getAttribute('tabindex') === '0').length).toBe(1);
    expect(tiles.filter((t) => t.getAttribute('tabindex') === '-1').length).toBe(tiles.length - 1);
    expect(stop(el)).toBe(0);
  });

  it('steps sideways with the arrows, and the stop follows the focus', async () => {
    const el = await gallery();
    await press(el, 'ArrowRight');
    expect(focused(el)).toBe(1);
    expect(stop(el)).toBe(1);
    await press(el, 'ArrowLeft');
    expect(focused(el)).toBe(0);
    expect(stop(el)).toBe(0);
  });

  // The step is along the flat list, so it runs off the end of one category into the start
  // of the next rather than stopping at a heading. Parameters holds six tiles, so the
  // seventh is the first Signal.
  it('steps across a category boundary, because the list is flat', async () => {
    const el = await gallery();
    const first = ADD_CATALOG[0].tiles.length;
    for (let i = 0; i < first; i++) await press(el, 'ArrowRight');
    expect(focused(el)).toBe(first);
    expect($$(el, '.tile')[first].dataset.className).toBe(ADD_CATALOG[1].tiles[0].className);
  });

  // Clamped, not wrapped: a gallery is a surface with a shape, and Right at the last tile
  // landing back on the first would lose the user's place in a list six headings long.
  it('stops at both ends rather than wrapping round', async () => {
    const el = await gallery();
    await press(el, 'ArrowLeft');
    expect(focused(el)).toBe(0);
    await press(el, 'End');
    const last = $$(el, '.tile').length - 1;
    expect(focused(el)).toBe(last);
    await press(el, 'ArrowRight');
    expect(focused(el)).toBe(last);
    await press(el, 'Home');
    expect(focused(el)).toBe(0);
  });

  // Home is the top of the CATALOG, not just its first tile. Focusing a tile scrolls it no
  // further than it has to, which leaves the "Parameters" heading above it out of sight and the
  // gallery looking untouched by the key. Only reachable when the popover scrolls, which the
  // 24px icon made ordinary — the taller tile took the catalog past the cap. happy-dom lays
  // nothing out, so the scroll offset is set by hand here; that the offset the browser really
  // has comes back to 0 is `homeReturnsToTop` in the harness.
  it('takes Home to the top of the list, not just to the first tile', async () => {
    const el = await gallery();
    await press(el, 'End');
    el.scrollTop = 120;
    await press(el, 'Home');
    expect(focused(el)).toBe(0);
    expect(el.scrollTop).toBe(0);
  });

  // Vertical movement is measured off the boxes the grid drew, because the column count is
  // not a constant — the gallery is as wide as the editor tab, so a row holds nine tiles in
  // a maximised window and two in a narrow pane. happy-dom draws no boxes at all, so what is
  // pinned here is the degenerate answer ("no row that way", focus unmoved, nothing thrown);
  // that it really moves a row is measured in the browser harness.
  it('answers up and down without a layout engine by not moving', async () => {
    const el = await gallery();
    await press(el, 'ArrowDown');
    expect(focused(el)).toBe(0);
    await press(el, 'ArrowUp');
    expect(focused(el)).toBe(0);
  });

  it('keeps the arrows to itself, so the table behind does not move its selection', async () => {
    const el = await gallery();
    const ev = await press(el, 'ArrowRight');
    expect(ev.defaultPrevented).toBe(true);
    expect(ev.cancelBubble).toBe(true);
  });

  it('leaves a key pressed on the pin to the pin', async () => {
    const el = await gallery();
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true });
    $(el, '.gallery-pin input').dispatchEvent(ev);
    await el.updateComplete;
    expect(ev.defaultPrevented).toBe(false);
    expect(focused(el)).toBe(0);
    expect(stop(el)).toBe(0);
  });

  // A click, or a Shift+Tab back in from the pin, moves the focus without an arrow key. If
  // the stop did not follow, Tab would leave from one tile while the arrows carried on from
  // another, and the first arrow press after a click would jump somewhere unrelated.
  it('moves the stop to a tile that was focused some other way', async () => {
    const el = await gallery();
    $$(el, '.tile')[5].focus();
    await el.updateComplete;
    expect(stop(el)).toBe(5);
    await press(el, 'ArrowRight');
    expect(focused(el)).toBe(6);
  });
});

describe('the table and the gallery together', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function table(canAdd = true): Promise<DexTreeTable> {
    const el = document.createElement('dex-tree-table') as DexTreeTable;
    el.canAdd = canAdd;
    el.columns = ['Name', 'Value'];
    el.rows = [{ ID: 'a', parent: null, Name: { label: 'gain' }, Value: '5' } as TreeTableRow];
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  const button = (el: DexTreeTable) => el.shadowRoot!.querySelector('.add-button') as HTMLElement | null;
  const popover = (el: DexTreeTable) => el.shadowRoot!.querySelector('dex-add-gallery') as DexAddGallery | null;

  async function open(el: DexTreeTable): Promise<DexAddGallery> {
    button(el)!.click();
    await el.updateComplete;
    const g = popover(el)!;
    await g.updateComplete;
    return g;
  }

  it('shows no button at all on a read-only view', async () => {
    const el = await table(false);
    expect(button(el)).toBeNull();
  });

  // The button used to read `⊞ Add`, and at 12px that glyph is a small crossed square —
  // close enough to the MATLAB-variable row icon a few pixels below it to be mistaken for
  // one (maintainer, from using it). A drawn plus stroked in currentColor instead.
  it('draws a plus rather than a box glyph', async () => {
    const el = await table();
    const b = button(el)!;
    expect(b.querySelector('svg.add-glyph')).not.toBeNull();
    expect(b.textContent!.trim()).toBe('Add');
  });

  const cssOf = (tag: string) =>
    [(customElements.get(tag) as any).styles]
      .flat()
      .map((s: any) => s.cssText)
      .join('\n');
  const tableCss = () => cssOf('dex-tree-table');
  const galleryCss = () => cssOf('dex-add-gallery');

  // The declarations of one rule, by selector. Crude on purpose — these are our own hand-written
  // stylesheets, and a real parser would only obscure the one question being asked, which is
  // WHICH rule a declaration landed in. `position: relative` on the wrong box anchors nothing.
  // Whitespace inside a declaration is not a fact about the stylesheet, it is a fact about where
  // the formatter chose to break a long line — `margin-inline: min(8px, calc(...)) auto` is
  // serialized over five lines, so a one-line expectation misses it. Collapse runs of whitespace
  // before matching anything whose value is longer than a line.
  const squash = (css: string) => css.replace(/\s+/g, ' ');

  const ruleBody = (selector: string) => {
    const css = tableCss();
    const at = css.indexOf(`${selector} {`);
    expect(at, `no ${selector} rule`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  // Where the popover goes is a stylesheet fact, not a measurement. It followed the tab first
  // by re-measuring on resize, and the maintainer's next question was why that needed TS at all
  // (2026-09-28). It does not: an absolutely positioned box inside the search bar resolves its
  // percentages against that bar on every layout, so "as wide as the tab, inset, just below it"
  // keeps being true through a drag with no listener, no ResizeObserver and no state.
  //
  // Which leaves the two halves of the anchor to pin, both of which happy-dom can see even
  // though it lays nothing out: the pair of rules, and the popover being rendered INSIDE the
  // bar. Either half alone parks the gallery in the corner of the editor.
  it('anchors the gallery under the search bar in CSS, with nothing measured in script', async () => {
    const el = await table();
    const g = await open(el);

    // In the bar, so the bar is the box its percentages are against.
    expect(g.parentElement).toBe(el.shadowRoot!.querySelector('.filter-bar'));
    // And carrying no geometry of its own. This is the regression that matters, because the
    // code it replaces looked reasonable: an inline left/top/width written at open time, which
    // is correct exactly once and then is whatever the user last dragged past.
    expect(g.getAttribute('style')).toBeNull();

    // The bar is the containing block, and deliberately not a stacking context — no z-index
    // here, or the gallery's 1001 would sort inside the bar instead of over the table.
    const bar = ruleBody('.filter-bar');
    expect(bar).toContain('position: relative');
    expect(bar).not.toContain('z-index:');

    const gallery = ruleBody('dex-add-gallery');
    expect(gallery).toContain('position: absolute');
    // Just under the bar: its padding box ends at 100%, then 1px of bottom border, then air.
    expect(gallery).toContain('top: calc(100% + 3px)');
    // Stretched across the bar and then centred in what it does not fill, which is what makes
    // the two side margins equal without either being written down.
    expect(gallery).toContain('left: 0');
    expect(gallery).toContain('right: 0');
    // Left-aligned at the inset, with the right margin taking whatever the width cap left
    // over — it was `auto` on both sides, which centred the popover, and centring only looked
    // right while the popover grew with the tab. The min() is the same give-way the width has:
    // half the slack when there is less than an inset's worth of it.
    expect(squash(gallery)).toContain('margin-inline: min( var(--dex-add-gallery-inset,');
    expect(squash(gallery)).toContain(') auto;');
    expect(gallery).not.toContain('margin-inline: auto');
    expect(gallery).toContain('z-index: 1001');
  });

  // Ask 1 of three (maintainer, F5 2026-09-29): the popover's side borders should line up with
  // the Add button's left border and the Columns button's right border. Those two are the bar's
  // first and last items, so the line they stand on is the bar's own horizontal padding — which
  // makes this a single-number claim rather than a measurement, and the number has to be the
  // same one in both rules or the popover misses the button by a few px, which reads worse than
  // a frank margin. The pixels themselves are the harness's job (`geometry.alignsWithButtons`).
  it('insets the popover by the bar’s own padding, so its edges meet the buttons', () => {
    // One token, read by both rules. Being the same NAME is the guarantee now, where being the
    // same interpolated constant used to be — and it is the stronger one, since a var() resolves
    // at run time where interpolation baked a copy of the number into each bundle.
    expect(ruleBody('.filter-bar')).toContain('padding: 4px var(--dex-add-gallery-inset,');
    expect(squash(ruleBody('dex-add-gallery'))).toContain('min( var(--dex-add-gallery-inset,');
  });

  // Every read of a geometry token carries a literal fallback, so a webview whose theme file never
  // loaded still lays the popover out. A fallback that disagrees with the declaration is the worst
  // of both: it lays out, differently, in the one case nobody looks at. Since the declaration is
  // in a document stylesheet and the reads are inside two shadow roots, no compiler relates them —
  // the numbers only match because something checks.
  it('falls back to the tokens’ own numbers everywhere it reads them', () => {
    const declared: Record<string, number> = {
      '--dex-add-gallery-inset': INSET,
      '--dex-add-gallery-min-width': FLOOR,
    };
    const sheets = { 'dex-tree-table': tableCss(), 'dex-add-gallery': galleryCss() };
    let checked = 0;
    for (const [where, css] of Object.entries(sheets)) {
      for (const [name, value] of Object.entries(declared)) {
        // The fallback runs to the next comma or paren, which is all there is: every read of
        // these two is `var(--token, <n>px)`. Nesting happens one level out — the popover's width
        // falls back to the min-width token — and that inner read is matched here on its own.
        for (const read of css.matchAll(new RegExp(`var\\(\\s*${name}\\s*([,)])([^,()]*)`, 'g'))) {
          expect(read[1], `${where} reads ${name} with no fallback`).toBe(',');
          expect(read[2].trim(), `${where} reads ${name}`).toBe(`${value}px`);
          checked++;
        }
      }
    }
    // A loop over nothing passes. These tokens are read five times today.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  // The ROOM the popover is allowed, which since the width cap (below) is no longer the width it
  // takes: a 300px popover under a 1400px editor read as a narrow strip of a much larger surface
  // (maintainer, from using it), so the clamp says "the tab, less a margin down each side, but
  // never below two tile columns".
  //
  // One clamp carries the whole rule the six cases below used to be TS for, so what is checked is
  // that it is built from the two tokens and that those tokens still produce the intended boxes.
  // The clamp is matched WHOLE rather than by parts, because the doubling is the part that used to
  // be TS: the rule read `calc(100% - ${2 * ADD_GALLERY_INSET}px)`, a multiplication performed by
  // the bundler, and the maintainer's question was why ("it should be done through CSS only",
  // 2026-09-29). `* 2` inside calc() is the answer, and it is worth an expectation that would
  // notice it going back.
  //
  // The arithmetic below is evaluated here rather than resolved by a browser — happy-dom resolves
  // no percentage — so this pins our intent against the shipped numbers; that a browser agrees is
  // the harness's job (`narrow.width` at a 340px pane, `followsResize` at 900/308/1200 of editor).
  //
  // The margins below are what the OLD `margin-inline: auto` produced and are still what this
  // rule gives wherever the popover fills the room it is allowed — which is every width in this
  // test, since the cap only bites above ~960px of tab.
  it('takes the tab’s width less a margin down each side, and spends the margin first', () => {
    const decl = squash(ruleBody('dex-add-gallery'));
    expect(decl, 'the width is not a clamp of the two tokens').toContain(
      `--dex-add-gallery-width: clamp( min(var(--dex-add-gallery-min-width, ${FLOOR}px), 100%), ` +
        `calc(100% - var(--dex-add-gallery-inset, ${INSET}px) * 2), 100% );`,
    );
    const [floor, bothInsets] = [FLOOR, 2 * INSET];

    // clamp(MIN, VAL, MAX) is max(MIN, min(VAL, MAX)); the leftover is halved by margin-inline.
    const box = (tab: number) => {
      const width = Math.max(Math.min(floor, tab), Math.min(tab - bothInsets, tab));
      return [width, (tab - width) / 2];
    };

    // A margin each side, so it floats over the table instead of meeting its edges
    // (maintainer's call): 8px off each end — the bar's padding, so the edges meet the buttons —
    // whatever the tab is worth.
    expect(box(1200)).toEqual([1184, 8]);
    expect(box(600)).toEqual([584, 8]);
    expect(box(400)).toEqual([384, 8]);

    // The margin is the part that gives way. At exactly the popover's floor there is none left
    // to spend — 300px of tiles beats 284px with a gap down each side — and between there and
    // 316 the margin takes the growth so the gallery stays at two full columns.
    expect(box(316)).toEqual([300, 8]);
    expect(box(310)).toEqual([300, 5]);
    expect(box(300)).toEqual([300, 0]);

    // Narrower than the floor, the floor gives way too rather than the popover hanging out over
    // the edge of the tab: the lower bound is capped at the tab's own width.
    expect(box(200)).toEqual([200, 0]);
  });

  it('shows the button on an editable view and toggles the popover with it', async () => {
    const el = await table();
    expect(button(el)!.getAttribute('aria-expanded')).toBe('false');
    await open(el);
    expect(button(el)!.getAttribute('aria-expanded')).toBe('true');
    button(el)!.click();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  // Fixed-size tiles that WRAP (maintainer's ask, 2026-09-28): the gallery flexes, the tile
  // does not. This is a stylesheet assertion rather than a measurement because happy-dom lays
  // nothing out — the sizes it produces are all 0 — and the browser harness has the pixels
  // (`layout.tileWidth` is equal in a 1200px editor and a 340px pane, `columns` is not).
  //
  // Worth pinning at all because the regression is one word long and looks like a tidy-up: an
  // `auto-fill` grid with a `1fr`, or a `flex: 1`, draws a gallery that is right in every
  // screenshot of a single width and stretches the tiles at every other one.
  it('sizes every tile from one token and wraps the row instead of stretching them', async () => {
    const cssText = galleryCss();

    // A wrapping flex row, and not a grid whose tracks would share out the remainder.
    expect(cssText).toContain('flex-wrap: wrap');
    expect(cssText).not.toContain('grid-template-columns:');

    // Rigid in both directions: `0 0` is the claim. A tile that may grow fills the row it is
    // in, and a tile that may shrink gets narrower as its row fills up — either one puts the
    // badge back on a collision course with the icon, which is what set this width.
    //
    // The basis is a custom property where it was an interpolated TS constant — "styling
    // calculation" belongs in the stylesheet (maintainer, 2026-09-29). Unlike the two tokens in
    // vscode-theme.css this one is declared on this component's own :host, because nothing
    // outside this shadow root reads it and a document property would be scope it does not need.
    expect(cssText).toMatch(/flex:\s*0 0 var\(--dex-add-gallery-tile-width, \d+px\)/);

    // One number, not one per rule: every tile is the same width because they all read the same
    // token, declared once, so there is a single place to re-measure if the badge ever grows.
    const declarations = [...cssText.matchAll(/--dex-add-gallery-tile-width:\s*(\d+)px/g)];
    expect(declarations.length, 'the tile width is declared more than once').toBe(1);

    // And a fence around the number, because it is an answer and not a preference: the badge is
    // right-anchored 3px in and the icon is centred, so the room between them is
    // `width / 2 - 15 - badge`, and the widest badge left in the catalog (`Arch`) inks 30 in the
    // browser harness. 92 is therefore where the badge lands ON the icon +1px, and anything below
    // it is a collision this environment cannot see — happy-dom lays nothing out, so `iconGap` in
    // `scenarios/add-gallery.mjs` is the only witness and this is its cheap proxy.
    //
    // The ceiling is the maintainer's F6 ask ("make all buttons a little bit narrower") given a
    // number: 112 was what the wider `Config` badge demanded, and with that badge gone the same
    // arithmetic allows 96 with 3px of clearance — more than the 1px it used to have, and more
    // than the 2px the MATLAB toolstrip's own gallery leaves its corner star. Past 100 the tile is
    // on its way back to the mostly-empty box that was objected to twice, and there would need to
    // be a new reason for it, measured.
    const width = Number(declarations[0][1]);
    expect(width, 'a tile this narrow puts the badge on the icon').toBeGreaterThanOrEqual(92);
    expect(width, 'a tile this wide is mostly empty again').toBeLessThanOrEqual(100);
    const bases = [...cssText.matchAll(/flex:\s*0 0 var\(--dex-add-gallery-tile-width, (\d+)px\)/g)];
    expect(bases.length).toBeGreaterThan(0);
    // And the fallback every read carries is that same number, or a webview whose :host rule was
    // dropped lays out tiles of a width nobody measured.
    for (const use of bases) expect(use[1]).toBe(declarations[0][1]);
  });

  // Ask 2 of three (maintainer, F5 2026-09-29): "if the tab width is larger, the gallery should
  // not follow, just show enough width to show all buttons in one row." The width the table hands
  // over is still the tab's, so what stops it is a cap here.
  //
  // `max-content` rather than a computed number, and that is the point worth a test: the widest
  // child of this box is a `.tiles` row, and the max-content size of a wrapping flex container is
  // all of its items on one line. So the cap IS "the biggest category in one row", stated once,
  // and a category that gains a tile widens it with no arithmetic to update. A well-meant swap to
  // a px value is the regression this catches — it would be right on the day it was measured and
  // wrong after the next catalog change, silently, by one wrapped row.
  it('stops growing at the width the widest category needs', () => {
    expect(galleryCss()).toContain('max-width: max-content');
    // Not a second width rule: the room still comes from the table's var, and this only caps it.
    expect(galleryCss()).toContain('width: var(--dex-add-gallery-width');
  });

  // Ask 3 of three (maintainer, F5 2026-09-29): "make the gallery background semi-transparent,
  // like a glossy glass effect to blur the table under it."
  //
  // The effect is four declarations across two files, and the first round of it got two of them
  // wrong while measuring as correct — see the note in vscodeThemeTokens.test.ts, which owns the
  // half that lives in the theme (the tint the alpha is applied to). What is pinned here is the
  // half that is this component's: which box carries the surface, which carries the header and
  // the sheen, that NOTHING opaque is painted on top of the glass, and that forced colors gets
  // none of it — that mode exists to remove exactly this, and a blur is not a colour, so it
  // survives the background substitution unless it is turned off by hand. happy-dom applies no
  // stylesheet and composites nothing, so the pixels are the harness's (`glass.checks`,
  // `glass.seeThrough`, and the forced-colors screenshot).
  it('draws the panel as glass, and drops it entirely under forced colors', () => {
    const css = galleryCss();
    // By rule, not by substring: `background: transparent` would pass a contains() from
    // anywhere in this stylesheet, and what is asked below is which box each paint landed on.
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `no ${selector} rule`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };

    // The surface and the sticky header both, or the header reads as an opaque strip across the
    // top of a glass panel — each from its own token, because the header is the solider of the
    // two, and both with an OPAQUE fallback for a webview whose theme file never loaded.
    expect(rule(':host')).toContain('background: var(--dex-add-gallery-bg, var(--dex-bg-primary');
    expect(rule('.gallery-header')).toContain(
      'background: var(--dex-add-gallery-header-bg, var(--dex-bg-primary',
    );
    // 12px, not the context menu's 20. This panel covers ~600px of rows, and at 20px their
    // banding averages into a flat wash that reads as an opaque panel; the regression this
    // catches is a well-meant "make the two glasses match" edit — one effect, two very
    // different backdrops. Measured as painted pixels in the harness (glass.seeThrough).
    expect(css).toContain('backdrop-filter: blur(12px) saturate(180%)');
    // The prefixed copy is not optional here: it is what the context menu ships, and dropping it
    // would make this the one glass surface that is flat on an older webview.
    expect(css).toContain('-webkit-backdrop-filter: blur(12px) saturate(180%)');

    // "Glossy" is the last word of the ask, and a sheen is a lit top EDGE — so it goes on the
    // sticky bar, which is the panel's visual top at every scroll position, rather than on the
    // host, whose own top edge sits underneath that bar.
    expect(rule('.gallery-header')).toMatch(
      /background-image:\s*linear-gradient\(\s*to bottom,\s*rgba\(255, 255, 255, 0\.12\)/,
    );

    // A tile is OPAQUE, and painted the colour the sheet is made of rather than one of its own:
    // "make the gallery background a little bit more transparent, but the buttons background
    // opaque" (maintainer, F5 2026-09-29, after the white glass landed). Reading the tint
    // directly is what makes the two halves one change — a tile is the sheet with the
    // transparency removed, so the panel is one colour at three alphas and there is no second
    // number to keep in step. A --dex-add-gallery-tile-bg would be that number, which is why its
    // absence is asserted rather than assumed; the tile width token next to it is a length, not
    // a colour.
    const tileBackground = /background:([^;]*);/.exec(rule('.tile'))?.[1] ?? '';
    expect(tileBackground).toContain('var(--dex-add-gallery-tint');
    expect(tileBackground, 'a tile must not be translucent').not.toContain('transparent');
    expect(css).not.toContain('--dex-add-gallery-tile-bg');
    // Which is why the sheet's own alpha is the thing that has to stay low: the tiles are ~90%
    // of this panel's area, so the glass is now carried by the gutters, the run past the end of
    // a short row, the heading bands and the sticky bar. That number lives in the theme file and
    // is fenced in vscodeThemeTokens.test.ts.
    //
    // The hover still changes the surface, which is a tile's only "press" — one surface to
    // another again now that a tile has one.
    expect(rule('.tile:hover')).toContain('background: var(--dex-bg-hover');
    // And in forced colors the tile goes back to Canvas rather than keeping the tint or taking
    // the ButtonFace a <button> is forced to: its label is `color: inherit`, and CanvasText on
    // ButtonFace is not a pairing the system palette guarantees.
    expect(css.slice(css.indexOf('@media (forced-colors: active)'))).toMatch(
      /\.tile\s*\{\s*background: Canvas !important;/,
    );

    // And the whole effect comes off in forced colors. Both halves: an opaque Canvas AND no blur.
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
    expect(forced).toContain('background: Canvas !important');
    expect(forced).toContain('backdrop-filter: none !important');
    expect(forced).toContain('-webkit-backdrop-filter: none !important');
  });

  // The pressed look (maintainer's ask, 2026-09-28): while the popover is showing, the
  // button that opened it is drawn held down, so it is clear that clicking it again closes
  // what is on screen rather than opening a second one.
  //
  // What is checked here is that the state the rule keys off is the aria attribute, and that
  // the rule exists for BOTH bar buttons — Add and Columns are one kind of control and both
  // toggle, so a pressed look on one and not the other would be a bug either way. The pixels
  // are not visible from happy-dom (no stylesheet is applied and nothing is laid out); the
  // colours are measured in the browser harness.
  it('draws a bar button held down while its popover shows, keyed off aria-expanded', async () => {
    const el = await table();
    const cssText = [(customElements.get('dex-tree-table') as any).styles]
      .flat()
      .map((s: any) => s.cssText)
      .join('\n');
    expect(cssText).toContain(".add-button[aria-expanded='true']");
    expect(cssText).toContain(".columns-button[aria-expanded='true']");

    // The pressed rule carries a border as well as a surface, because in Light Modern the
    // surface alone (#E8E8E8 selection over #F2F2F2 hover) is four percent of grey.
    expect(cssText).toContain('--vscode-inputOption-activeBorder');
    // And the surface is NOT taken from that same group: inputOption.activeBackground is
    // registered `transparent` on the high-contrast themes, where a var() fallback therefore
    // never fires and the button would lose its only cue. Cheap to write, invisible to review,
    // and exactly the kind of regression a browser harness cannot catch either — the harness
    // leaves the HC token undefined, so the trap would measure as though it worked.
    expect(cssText).not.toContain('--vscode-inputOption-activeBackground');

    // And the attribute is a live answer on both, not decoration on one.
    const columns = el.shadowRoot!.querySelector('.columns-button') as HTMLElement;
    expect(columns.getAttribute('aria-expanded')).toBe('false');
    columns.click();
    await el.updateComplete;
    expect(columns.getAttribute('aria-expanded')).toBe('true');
    expect(button(el)!.getAttribute('aria-expanded')).toBe('false');
  });

  // The keyboard's way in (dataExplorer.addEntry → openAddGallery → here). A method rather
  // than a synthetic click so the host does not have to find a button in a shadow root, and
  // a TOGGLE so the accelerator behaves exactly as the button does.
  it('opens and closes from toggleAddGallery, and does nothing where nothing can be added', async () => {
    const el = await table();
    el.toggleAddGallery();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();
    expect(button(el)!.getAttribute('aria-expanded')).toBe('true');
    el.toggleAddGallery();
    await el.updateComplete;
    expect(popover(el)).toBeNull();

    // A read-only view has no button to anchor to and nothing to add. The keybinding's `when`
    // clause already excludes it, but the Command Palette does not have to.
    const readOnly = await table(false);
    readOnly.toggleAddGallery();
    await readOnly.updateComplete;
    expect(popover(readOnly)).toBeNull();
  });

  it('relays a tile as one outward request per click', async () => {
    const el = await table();
    const seen: unknown[] = [];
    el.addEventListener('dex-add-entry', (e) => seen.push((e as CustomEvent).detail));
    // The gallery's own event is composed, so a listener outside the table would see
    // both names for one click if the table did not keep the inner one.
    el.addEventListener('dex-add-tile', () => seen.push('leaked'));
    const g = await open(el);
    $$(g, '.tile').find((t) => t.dataset.className === 'Simulink.Signal')!.click();
    // `rename` rides along with the class and the section: it is a fact about THIS gesture,
    // and by the time the entry exists the pin may have been toggled.
    expect(seen).toEqual([
      { className: 'Simulink.Signal', section: 'design', label: 'Simulink Signal', rename: true },
    ]);
  });

  it('asks for no rename during a pinned run, so a batch is not interrupted', async () => {
    const el = await table();
    const g = await open(el);
    const box = $(g, '.gallery-pin input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    const seen: unknown[] = [];
    el.addEventListener('dex-add-entry', (e) => seen.push((e as CustomEvent).detail));
    $$(g, '.tile').find((t) => t.dataset.className === 'Simulink.Signal')!.click();
    expect(seen).toEqual([
      { className: 'Simulink.Signal', section: 'design', label: 'Simulink Signal', rename: false },
    ]);
  });

  it('closes after an unpinned add, because naming the new row comes next', async () => {
    const el = await table();
    const g = await open(el);
    $(g, '.tile').click();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('stays open for a pinned run, and keeps the pin for the next open', async () => {
    const el = await table();
    const g = await open(el);
    const box = $(g, '.gallery-pin input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    const adds: unknown[] = [];
    el.addEventListener('dex-add-entry', (e) => adds.push((e as CustomEvent).detail));
    $$(g, '.tile')[0].click();
    $$(g, '.tile')[1].click();
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();
    expect(adds.length).toBe(2);

    // Closed and reopened, the pin is still set: it describes the user's intent for the
    // next few minutes, not for one popover.
    button(el)!.click();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
    const again = await open(el);
    expect(again.pinned).toBe(true);
  });

  it('dismisses on a click outside, and not on one inside', async () => {
    const el = await table();
    const g = await open(el);
    // Inside, but not on a tile — the popover's own title, which does nothing. A click on
    // a tile would close an unpinned popover for the other reason and prove nothing here.
    // composedPath is what carries the gallery, since the title is in its shadow root.
    $(g, '.gallery-title').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('dismisses when the window loses focus, pinned or not', async () => {
    const el = await table();
    const g = await open(el);
    const box = $(g, '.gallery-pin input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    window.dispatchEvent(new Event('blur'));
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('dismisses on the popover’s Escape', async () => {
    const el = await table();
    const g = await open(el);
    $(g, '.tile').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
    );
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });
});
