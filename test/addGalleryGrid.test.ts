// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Up and Down in the Add gallery move by the boxes the grid drew (dex-add-gallery's _rowStep),
// because the column count is however many tiles fit the editor's width. happy-dom draws no
// boxes, so addGallery.test.ts pins only the degenerate answer; here each tile is given the box
// a grid of a chosen width would give it, laid out category by category with a heading's gap
// between, and the arrows are asked to hold a column, cross a heading, land on the nearest tile
// of a short row, and stop at the ends.
//
// And the MAT-file gallery standing alone (its `classes` given): no tile names a destination,
// to the eye or to a screen reader, and the add it asks for names no section.
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/webview/components/dex-add-gallery.js';
import type { DexAddGallery } from '../src/webview/components/dex-add-gallery.js';
import { ADD_CATALOG, matCatalog } from '../src/common/addCatalog.js';

const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];

const TILE_W = 100;
const TILE_H = 60;
const HEADING = 30;

/**
 * Give every tile the box a `columns`-wide grid draws: categories one after another, each
 * starting a new row under a heading. Returns each tile's [row, column] in that layout.
 */
function layOut(el: DexAddGallery, columns: number, sizes: number[] = ADD_CATALOG.map((c) => c.tiles.length)): [number, number][] {
  const tiles = $$(el, '.tile');
  const place: [number, number][] = [];
  let top = 0;
  let row = 0;
  let i = 0;
  for (const size of sizes) {
    top += HEADING;
    for (let k = 0; k < size; k++, i++) {
      const r = Math.floor(k / columns);
      const c = k % columns;
      const box = { top: top + r * TILE_H, left: c * TILE_W, width: TILE_W, height: TILE_H };
      tiles[i].getBoundingClientRect = () =>
        ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON() {} }) as DOMRect;
      place.push([row + r, c]);
    }
    const rows = Math.ceil(size / columns);
    top += rows * TILE_H;
    row += rows;
  }
  expect(i).toBe(tiles.length);
  return place;
}

async function gallery(classes: readonly string[] | null = null): Promise<DexAddGallery> {
  const el = document.createElement('dex-add-gallery') as DexAddGallery;
  el.classes = classes;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const focused = (el: DexAddGallery) => $$(el, '.tile').indexOf(el.shadowRoot!.activeElement as HTMLElement);
const press = async (el: DexAddGallery, key: string) => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
  (el.shadowRoot!.activeElement as HTMLElement).dispatchEvent(ev);
  await el.updateComplete;
  return ev;
};
const focusTile = async (el: DexAddGallery, index: number) => {
  $$(el, '.tile')[index].focus();
  await el.updateComplete;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Up and Down follow the grid as drawn', () => {
  it('Down holds the column within a category', async () => {
    const el = await gallery();
    const place = layOut(el, 3);
    expect(ADD_CATALOG[0].tiles.length).toBeGreaterThan(3);
    await focusTile(el, 1);
    const ev = await press(el, 'ArrowDown');
    expect(ev.defaultPrevented).toBe(true);
    expect(place[focused(el)]).toEqual([place[1][0] + 1, 1]);
    await press(el, 'ArrowUp');
    expect(focused(el)).toBe(1);
  });

  it('crosses a heading: Down from a category’s last row is the next category’s first row', async () => {
    const el = await gallery();
    const place = layOut(el, 4);
    const first = ADD_CATALOG[0].tiles.length;
    // The last tile of the first category, then Down: a tile of the second category, in the
    // column nearest the one it left.
    await focusTile(el, first - 1);
    await press(el, 'ArrowDown');
    const landed = focused(el);
    expect(landed).toBeGreaterThanOrEqual(first);
    expect(landed).toBeLessThan(first + ADD_CATALOG[1].tiles.length);
    expect(place[landed][0]).toBe(place[first - 1][0] + 1);
    const wanted = Math.min(place[first - 1][1], ADD_CATALOG[1].tiles.length - 1);
    expect(place[landed][1]).toBe(wanted);
    // And Up from there comes back across the same heading, to the row it left.
    await press(el, 'ArrowUp');
    expect(place[focused(el)][0]).toBe(place[first - 1][0]);
  });

  it('lands on the nearest tile of a shorter row', async () => {
    // Seven tiles four wide: the row below column 3 holds columns 0-2, and column 2 is nearest.
    const el = await gallery();
    const place = layOut(el, 4);
    const at = place.findIndex(([r, c], i) => c === 3 && place.some(([r2], j) => j > i && r2 === r + 1));
    expect(at).toBeGreaterThanOrEqual(0);
    await focusTile(el, at);
    await press(el, 'ArrowDown');
    const [row, col] = place[focused(el)];
    expect(row).toBe(place[at][0] + 1);
    const rowCols = place.filter(([r]) => r === row).map(([, c]) => c);
    expect(col).toBe(Math.max(...rowCols.filter((c) => c <= 3)));
  });

  it('stops at the first row going up and the last row going down', async () => {
    const el = await gallery();
    const place = layOut(el, 5);
    await focusTile(el, 2);
    await press(el, 'ArrowUp');
    expect(focused(el)).toBe(2);
    const last = place.length - 1;
    await focusTile(el, last);
    await press(el, 'ArrowDown');
    expect(focused(el)).toBe(last);
  });

  it('a one-column grid steps one tile at a time, as Right does', async () => {
    const el = await gallery();
    layOut(el, 1);
    await focusTile(el, 0);
    for (let i = 1; i <= 8; i++) {
      await press(el, 'ArrowDown');
      expect(focused(el)).toBe(i);
    }
  });

  it('leaves a key it has no answer for alone', async () => {
    const el = await gallery();
    layOut(el, 3);
    await focusTile(el, 4);
    const ev = await press(el, 'PageDown');
    expect(ev.defaultPrevented).toBe(false);
    expect(focused(el)).toBe(4);
  });
});

describe('the MAT-file gallery', () => {
  const CLASSES = ['MatlabVariable', 'MatlabStruct', 'Simulink.Parameter', 'Simulink.Signal', 'Simulink.Bus', 'string'];

  it('offers the tiles of the classes it was given, naming no destination', async () => {
    const el = await gallery(CLASSES);
    const tiles = $$(el, '.tile');
    const expected = matCatalog(CLASSES).flatMap((c) => c.tiles);
    expect(tiles.map((t) => t.dataset.className)).toEqual(expected.map((t) => t.className));
    expect(el.shadowRoot!.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Add a variable');
    expect($$(el, '.tile-badge')).toEqual([]);
    for (const [i, tile] of tiles.entries()) {
      expect(tile.getAttribute('aria-label')).toBe(`Add ${expected[i].label}`);
      expect(tile.getAttribute('title')).toBe(`Add ${expected[i].label}`);
    }
  });

  it('asks for an add in no section', async () => {
    const el = await gallery(CLASSES);
    const asked: any[] = [];
    el.addEventListener('dex-add-tile', (e) => asked.push((e as CustomEvent).detail));
    const tile = $$(el, '.tile')[0];
    tile.click();
    expect(asked).toEqual([{ className: tile.dataset.className, section: '', label: matCatalog(CLASSES)[0].tiles[0].label }]);
  });

  it('a file that can take no new variable shows an empty gallery the keys do nothing in', async () => {
    const el = await gallery([]);
    expect($$(el, '.tile')).toEqual([]);
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true });
    el.shadowRoot!.querySelector('[role="dialog"]')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
