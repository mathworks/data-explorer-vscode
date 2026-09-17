// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The per-column filter popup. Its `writes:` line is the whole discoverability
// mechanism — it teaches the search syntax by showing the exact text Apply is
// about to put in the box — so every case here pins the two to the same string.
// A preview that could drift from what Apply writes would teach a syntax the box
// does not accept, which is worse than showing nothing at all.
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/webview/components/dex-column-filter.js';
import type { DexColumnFilter } from '../src/webview/components/dex-column-filter.js';
import '../src/webview/components/dex-tree-table.js';
import type { DexTreeTable, TreeTableRow } from '../src/webview/components/dex-tree-table.js';

async function open(props: Partial<DexColumnFilter> = {}): Promise<DexColumnFilter> {
  const el = document.createElement('dex-column-filter') as DexColumnFilter;
  el.column = 'DataType';
  el.columnLabel = 'Data Type';
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const $ = (el: DexColumnFilter, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement;
const writes = (el: DexColumnFilter) => $(el, '.writes-value').textContent!.trim();

describe('dex-column-filter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('titles itself with the column label and offers all seven operators', async () => {
    const el = await open();
    expect($(el, '.popup-title').textContent).toContain('Data Type');
    const ops = [...el.shadowRoot!.querySelectorAll('.op-button')].map((b) => b.getAttribute('data-op'));
    expect(ops).toEqual(['contains', '=', '!=', '>', '<', '>=', '<=']);
    expect($(el, '.op-button[data-op="contains"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the exact text it will write, updating as the value is typed', async () => {
    const el = await open();
    expect(writes(el)).toBe('');
    const input = $(el, '.popup-value') as HTMLInputElement;
    input.value = 'double';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(writes(el)).toBe('"Data Type":double');

    $(el, '.op-button[data-op="!="]').click();
    await el.updateComplete;
    expect(writes(el)).toBe('"Data Type"!=double');
  });

  it('emits exactly what the writes line promised', async () => {
    const el = await open({ op: '=', value: 'single' });
    let detail: unknown = null;
    el.addEventListener('dex-column-filter-applied', (e) => {
      detail = (e as CustomEvent).detail;
    });
    const promised = writes(el);
    $(el, '.popup-apply').click();
    expect(detail).toEqual({ column: 'DataType', op: '=', value: 'single', text: promised });
  });

  it('opens on the operator and value it was prefilled with', async () => {
    const el = await open({ op: '>', value: '10' });
    expect(($(el, '.popup-value') as HTMLInputElement).value).toBe('10');
    expect($(el, '.op-button[data-op=">"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('Enter applies and Escape closes without applying', async () => {
    const el = await open({ value: 'x' });
    const seen: string[] = [];
    el.addEventListener('dex-column-filter-applied', () => seen.push('applied'));
    el.addEventListener('dex-column-filter-closed', () => seen.push('closed'));
    const input = $(el, '.popup-value');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(seen).toEqual(['closed']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(seen).toEqual(['closed', 'applied']);
  });

  it('Clear asks for the column condition to be removed', async () => {
    const el = await open({ op: '=', value: 'single', hasExisting: true });
    let detail: unknown = null;
    el.addEventListener('dex-column-filter-cleared', (e) => {
      detail = (e as CustomEvent).detail;
    });
    $(el, '.popup-clear').click();
    expect(detail).toEqual({ column: 'DataType' });
  });

  it('applies an empty value, because Unit= is a real question', async () => {
    const el = await open({ op: '=', value: '' });
    let detail: { text?: string } | null = null;
    el.addEventListener('dex-column-filter-applied', (e) => {
      detail = (e as CustomEvent).detail;
    });
    $(el, '.popup-apply').click();
    expect(detail!.text).toBe('"Data Type"=');
  });
});

describe('the table and the popup together', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function table(): Promise<DexTreeTable> {
    const el = document.createElement('dex-tree-table') as DexTreeTable;
    el.columns = ['Name', 'DataType', 'Value'];
    el.columnLabels = { Name: 'Name', DataType: 'Data Type', Value: 'Value' };
    // One row, because the empty-rows branch renders "No data" instead of a header
    // row — and the headers are what this block right-clicks on.
    el.rows = [{ ID: 'a', parent: null, Name: { label: 'gain' }, Value: '5', DataType: 'double' } as TreeTableRow];
    document.body.appendChild(el);
    await el.updateComplete;
    (el as any)._hiddenColumns = new Set<string>();
    el.requestUpdate();
    await el.updateComplete;
    return el;
  }

  // By label, not by index: the header order is the table's own default column
  // order, not the order `columns` was handed in.
  const headerFor = (el: DexTreeTable, label: string): HTMLElement =>
    [...el.shadowRoot!.querySelectorAll('th')].find(
      (th) => th.querySelector('.th-label')?.textContent?.trim() === label,
    ) as HTMLElement;

  const popupOf = (el: DexTreeTable) =>
    el.shadowRoot!.querySelector('dex-column-filter') as DexColumnFilter | null;

  it('a right-click on a header opens the popup for that column', async () => {
    const el = await table();
    headerFor(el, 'Data Type').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await el.updateComplete;
    expect(popupOf(el)!.column).toBe('DataType');
  });

  it('Apply puts the popup text in the search box', async () => {
    const el = await table();
    (el as any)._openColumnFilter('DataType', el.shadowRoot!.querySelector('th')!);
    await el.updateComplete;
    popupOf(el)!.value = 'double';
    await popupOf(el)!.updateComplete;
    (popupOf(el)!.shadowRoot!.querySelector('.popup-apply') as HTMLElement).click();
    await el.updateComplete;
    expect((el as any)._filterText).toBe('"Data Type":double');
    expect(popupOf(el)).toBeNull();
  });

  it('the search bar shows the condition the popup wrote, as a chip', async () => {
    // Apply that filters without updating the bar would leave the user looking at a
    // table narrowed by a condition they cannot see, edit, or clear. The bar shows
    // it as a chip rather than as raw text now, so the chip is what this reads —
    // spelled from the same label and value the popup applied.
    const el = await table();
    (el as any)._applyColumnFilter('DataType', 'contains', 'double');
    await el.updateComplete;
    const bar = el.shadowRoot!.querySelector('dex-filter-bar') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await bar.updateComplete;
    const chip = bar.shadowRoot!.querySelector('.chip') as HTMLElement;
    expect(chip.querySelector('.chip-label')!.textContent).toBe('Data Type');
    expect(chip.querySelector('.chip-value')!.textContent).toBe('double');
    expect((el as any)._filterText).toBe('"Data Type":double');
  });

  it('applying twice on one column replaces its condition rather than stacking', async () => {
    const el = await table();
    (el as any)._applyColumnFilter('DataType', 'contains', 'double');
    (el as any)._applyColumnFilter('DataType', '=', 'single');
    await el.updateComplete;
    expect((el as any)._filterText).toBe('"Data Type"=single');
  });

  it('keeps the other conditions when it replaces one', async () => {
    const el = await table();
    (el as any)._filterText = 'gain Value>1';
    (el as any)._applyColumnFilter('DataType', '=', 'single');
    await el.updateComplete;
    expect((el as any)._filterText).toBe('gain Value>1 "Data Type"=single');
    (el as any)._applyColumnFilter('Value', '<', '9');
    await el.updateComplete;
    expect((el as any)._filterText).toBe('gain Value<9 "Data Type"=single');
  });

  it('Clear removes only that column condition', async () => {
    const el = await table();
    (el as any)._filterText = 'gain "Data Type"=single Value>1';
    (el as any)._clearColumnFilter('DataType');
    await el.updateComplete;
    expect((el as any)._filterText).toBe('gain Value>1');
  });

  it('the funnel is solid only on the columns that actually have a condition', async () => {
    const el = await table();
    (el as any)._applyColumnFilter('DataType', '=', 'single');
    await el.updateComplete;
    const funnel = (label: string) => headerFor(el, label).querySelector('.th-filter') as HTMLElement;
    expect(funnel('Data Type').classList.contains('active')).toBe(true);
    expect(funnel('Value').classList.contains('active')).toBe(false);
  });

  it('a funnel click opens the popup without sorting the column', async () => {
    // The funnel sits inside the <th>, whose own click handler sorts. Reordering the
    // table under the user as they reach for a filter is the bug this pins.
    const el = await table();
    const funnel = headerFor(el, 'Data Type').querySelector('.th-filter') as HTMLElement;
    funnel.click();
    await el.updateComplete;
    expect(popupOf(el)!.column).toBe('DataType');
    expect((el as any)._sortState).toEqual([]);
  });
});
