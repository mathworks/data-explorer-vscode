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
