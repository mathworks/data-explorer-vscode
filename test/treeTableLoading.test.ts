// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The wait for the first payload, and what the panel shows during it.
//
// Three states share the "no rows" render, and the bug was that only two existed.
// The host parses synchronously before it can post 'setRows', so for the first
// second of a large file the table genuinely has nothing — which is not the same
// claim as "this file is empty", and was being rendered as if it were. Meanwhile a
// spinner overlay in the shell markup, pinned over the whole panel, hid the search
// bar the table had already painted: bar, then no bar, then bar and rows.
//
// Both halves of that are structure, not timing, so they are testable here. What
// isn't: the delay that keeps a fast open from flashing the spinner is a CSS
// animation delay, and happy-dom runs no animations — so that one is pinned as the
// declaration it is.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status'];

const makeRow = (id: string): TreeTableRow => ({
  ID: id,
  parent: null,
  Name: { label: id },
  Value: '',
  DataType: '',
  Description: '',
  Status: '',
});

// A table in the state the webview boots in: columns known (they ship with the
// shell), no rows yet, and the host-facing module having said so.
async function mount(opts: { loading?: boolean; rows?: TreeTableRow[] } = {}): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  if (opts.loading !== undefined) table.loading = opts.loading;
  document.body.appendChild(table);
  if (opts.rows) table.rows = opts.rows;
  await table.updateComplete;
  return table;
}

const q = (table: DexTreeTable, sel: string) => table.shadowRoot!.querySelector(sel);

// The component's own stylesheet text, whitespace collapsed so a rule reads as one
// line — the only place a keyframe or an animation delay can be pinned.
const styleText = (): string => {
  const s = (DexTreeTable as any).styles;
  return (Array.isArray(s) ? s : [s]).map((x: any) => String(x.cssText)).join('\n').replace(/\s+/g, ' ');
};

const ruleFor = (selector: string): string => {
  const css = styleText();
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('waiting for the first payload', () => {
  it('shows the spinner instead of "No data", because no payload has answered yet', async () => {
    const table = await mount({ loading: true });
    expect(q(table, '.loading-state')).not.toBeNull();
    // The bug this replaces: an empty table one moment after open was reported to
    // the user as an empty FILE.
    expect(q(table, '.empty-state')).toBeNull();
    table.remove();
  });

  it('keeps the search bar, which is the flicker this whole state exists to fix', async () => {
    // The old spinner was an overlay at inset:0 in the shell markup, so it covered
    // the bar; the bar appeared at boot, vanished, and came back with the rows.
    const table = await mount({ loading: true });
    expect(q(table, '.filter-bar')).not.toBeNull();
    expect(q(table, '.filter-input')).not.toBeNull();
    table.remove();
  });

  it('says "No data" once a payload has arrived and it was empty', async () => {
    // The state the spinner must not swallow: an empty dictionary is a real answer.
    const table = await mount({ loading: false, rows: [] });
    expect(q(table, '.empty-state')?.textContent).toContain('No data');
    expect(q(table, '.loading-state')).toBeNull();
    table.remove();
  });

  it('defaults to answering, so a consumer that never sets the property is unchanged', async () => {
    const table = await mount();
    expect(table.loading).toBe(false);
    expect(q(table, '.empty-state')).not.toBeNull();
    table.remove();
  });

  it('drops the spinner for the table when rows land', async () => {
    const table = await mount({ loading: true });
    table.loading = false;
    table.rows = [makeRow('a'), makeRow('b')];
    await table.updateComplete;
    expect(q(table, '.loading-state')).toBeNull();
    expect(q(table, '.rows-table')).not.toBeNull();
    table.remove();
  });

  it('renders the same bar element across that repaint, so nothing at the top moves', async () => {
    // One _renderFilterBar() shared by both branches is what lets Lit reuse the
    // node: a second literal would be a different template, the input would be
    // rebuilt, and text typed while waiting (plus the caret) would be lost.
    const table = await mount({ loading: true });
    const before = q(table, '.filter-input') as HTMLInputElement;
    before.value = 'gain';
    table.loading = false;
    table.rows = [makeRow('a')];
    await table.updateComplete;
    const after = q(table, '.filter-input') as HTMLInputElement;
    expect(after).toBe(before);
    expect(after.value).toBe('gain');
    table.remove();
  });
});

describe('the spinner is delayed, so a fast open never flashes it', () => {
  it('fades in only after a delay, held invisible until then', () => {
    // Two declarations carry this, and either one alone is a bug: the delay, and
    // the 'both' fill that holds opacity at 0 through it. Without the fill the
    // region paints at full strength immediately and the delay does nothing.
    const rule = ruleFor('.loading-state');
    const animation = /animation:([^;]+)/.exec(rule)?.[1] ?? '';
    expect(animation, rule).toContain('dex-loading-in');
    expect(animation, rule).toContain('both');
    const delay = /(\d+)ms\s+both/.exec(animation);
    expect(delay, animation).not.toBeNull();
    expect(Number(delay![1])).toBeGreaterThanOrEqual(300);
    expect(styleText()).toContain('@keyframes dex-loading-in');
  });

  it('spins, and brings its own keyframes now that it is inside the shadow root', () => {
    // dex-spin used to be declared in the shell's light DOM next to the overlay. A
    // keyframe there does not reach a shadow tree, so moving the markup in without
    // the animation would have left a motionless ring.
    expect(ruleFor('.loading-spinner')).toContain('dex-spin');
    expect(styleText()).toContain('@keyframes dex-spin');
  });
});
