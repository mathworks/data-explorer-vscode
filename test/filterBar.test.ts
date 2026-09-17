// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/webview/components/dex-filter-bar.js';
import type { DexFilterBar } from '../src/webview/components/dex-filter-bar.js';
import { parseFilterExpression } from '../src/webview/rowFilter.js';

const COLUMNS = ['Name', 'Value', 'DataType'];
const VOCAB = { labels: { Name: 'Name', Value: 'Value', DataType: 'Data Type' }, keys: COLUMNS };

/** A bar showing `text`, parsed exactly as the table parses it. */
async function bar(text = ''): Promise<DexFilterBar> {
  const el = document.createElement('dex-filter-bar') as DexFilterBar;
  el.text = text;
  el.tokens = parseFilterExpression(text, COLUMNS, () => '', VOCAB).tokens;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const input = (el: DexFilterBar) => el.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
const chips = (el: DexFilterBar) => [...el.shadowRoot!.querySelectorAll('.chip')] as HTMLElement[];

/** Type into the tail without committing it. */
async function type(el: DexFilterBar, value: string): Promise<void> {
  input(el).value = value;
  input(el).dispatchEvent(new Event('input', { bubbles: true }));
  await el.updateComplete;
}

async function press(el: DexFilterBar, key: string): Promise<void> {
  input(el).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await el.updateComplete;
}

function applied(el: DexFilterBar): string[] {
  const seen: string[] = [];
  el.addEventListener('dex-filter-applied', (e) => seen.push((e as CustomEvent).detail.text));
  return seen;
}

describe('dex-filter-bar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one chip per condition, in order', async () => {
    const el = await bar('abc Name:gain Value>10');
    expect(chips(el).map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'abc ×',
      'Name : gain ×',
      'Value > 10 ×',
    ]);
  });

  it('keeps the column label and the typed value as separate elements', async () => {
    // Pinned so the three-tier typography cannot be lost to a refactor: the label is
    // a quiet 11px grey, the value is content, and the operator carries the meaning.
    const el = await bar('"Data Type"!=double');
    const chip = chips(el)[0];
    expect(chip.querySelector('.chip-label')!.textContent).toBe('Data Type');
    expect(chip.querySelector('.chip-op')!.textContent!.trim()).toBe('≠');
    expect(chip.querySelector('.chip-value')!.textContent).toBe('double');
  });

  it('a bare term has no label and no operator glyph', async () => {
    const el = await bar('gain');
    const chip = chips(el)[0];
    expect(chip.querySelector('.chip-label')).toBeNull();
    expect(chip.querySelector('.chip-op')).toBeNull();
    expect(chip.querySelector('.chip-value')!.textContent).toBe('gain');
    expect(chip.className).toContain('bare');
  });

  it('tints a column chip differently from a bare one', async () => {
    const el = await bar('gain Name:gain');
    expect(chips(el)[0].className).toContain('bare');
    expect(chips(el)[1].className).toContain('column');
  });

  it('marks a warning chip and says why in its tooltip', async () => {
    const el = await bar('Value>abc');
    const chip = chips(el)[0];
    expect(chip.className).toContain('warning');
    expect(chip.title).toContain('not a number');
  });

  it('shows ≥ and ≤ rather than their ASCII spellings', async () => {
    const el = await bar('Value>=1 Value<=9');
    expect(chips(el).map((c) => c.querySelector('.chip-op')!.textContent!.trim())).toEqual(['≥', '≤']);
  });

  it('exposes the chip strip as a list with a labelled remove button each', async () => {
    const el = await bar('Name:gain');
    expect(el.shadowRoot!.querySelector('.chip-strip')!.getAttribute('role')).toBe('list');
    expect(chips(el)[0].getAttribute('role')).toBe('listitem');
    const remove = chips(el)[0].querySelector('.chip-remove')!;
    expect(remove.tagName).toBe('BUTTON');
    expect(remove.getAttribute('aria-label')).toBe('Remove filter Name contains gain');
  });

  it('removing a chip proposes the text without it', async () => {
    const el = await bar('abc Name:gain Value>10');
    const seen = applied(el);
    (chips(el)[1].querySelector('.chip-remove') as HTMLElement).click();
    expect(seen).toEqual(['abc Value>10']);
  });
});
