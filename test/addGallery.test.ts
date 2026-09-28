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
import '../src/webview/components/dex-add-gallery.js';
import type { DexAddGallery } from '../src/webview/components/dex-add-gallery.js';
import '../src/webview/components/dex-tree-table.js';
import type { DexTreeTable, TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { ADD_CATALOG, allTiles } from '../src/common/addCatalog.js';

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
      'Simulink.VariantConfigurationData Config',
    ]);
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

  // The width is the table's, not a constant: a 300px popover under a 1400px editor read as
  // a narrow strip of a much larger surface (maintainer, from using it), and the column count
  // follows from the width, so this is also what decides how many tiles are in a row. Taken
  // from the table rather than from `window` because a split editor gives the table a
  // fraction of the window, and it is the table the user is aiming at.
  //
  // The rect is stubbed because happy-dom lays nothing out — every box there is 0 by 0, so
  // without this the test could only watch a 0 travel. What the popover then DOES with the
  // width is layout, and is measured in the browser harness, not here.
  it('hands the gallery the table’s own width, inset on both sides and clamped to the viewport', async () => {
    const el = await table();
    const stubRect = (left: number, width: number) => {
      el.getBoundingClientRect = () =>
        ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0 }) as DOMRect;
    };
    const reopen = async (left: number, width: number) => {
      if (popover(el)) {
        button(el)!.click();
        await el.updateComplete;
      }
      stubRect(left, width);
      return open(el);
    };
    const box = (g: DexAddGallery) => [g.style.left, g.style.getPropertyValue('--dex-add-gallery-width')];

    // A margin each side, so it floats over the table instead of meeting its edges
    // (maintainer's call): 12px in from 40, and 24px off 600.
    expect(box(await reopen(40, 600))).toEqual(['52px', '576px']);

    // A table scrolled horizontally can start left of the viewport, and one wider than the
    // window would otherwise spill off its right edge. Neither may push the gallery out — and
    // the clamp wins over the margin, because a table with no visible edge inside the window
    // has no edge to leave a margin against.
    expect(box(await reopen(-30, window.innerWidth + 200))).toEqual(['0px', `${window.innerWidth}px`]);

    // The inset is the part that gives way. At exactly the popover's own width there is no
    // margin to spend — 300px of tiles beats 276px of tiles with a gap down each side — and
    // between there and 324 the inset takes the growth so the gallery stays at its floor.
    expect(box(await reopen(0, 300))).toEqual(['0px', '300px']);
    expect(box(await reopen(0, 310))).toEqual(['5px', '300px']);
    expect(box(await reopen(0, 324))).toEqual(['12px', '300px']);
    expect(box(await reopen(0, 400))).toEqual(['12px', '376px']);
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
