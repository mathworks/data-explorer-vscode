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

  it('renders every category in order, each heading naming where its tiles land', async () => {
    const el = await gallery();
    expect($$(el, '.kind-name').map((n) => n.textContent!.trim())).toEqual(
      ADD_CATALOG.map((c) => c.title),
    );
    const dests = $$(el, '.kind-dest').map((n) => n.textContent!.trim());
    expect(dests).toEqual([
      '→ Design Data, except where badged',
      '→ Design Data',
      '→ Architectural Data',
      '→ Design Data, except where badged',
      '→ Design Data, except where badged',
      '→ Configurations',
    ]);
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

  it('shows the button on an editable view and toggles the popover with it', async () => {
    const el = await table();
    expect(button(el)!.getAttribute('aria-expanded')).toBe('false');
    await open(el);
    expect(button(el)!.getAttribute('aria-expanded')).toBe('true');
    button(el)!.click();
    await el.updateComplete;
    expect(popover(el)).toBeNull();
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
    expect(seen).toEqual([{ className: 'Simulink.Signal', section: 'design', label: 'Simulink Signal' }]);
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
