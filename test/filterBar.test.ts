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

describe('dex-filter-bar clear-all', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const clearAll = (el: DexFilterBar) => el.shadowRoot!.querySelector('.clear-all') as HTMLButtonElement | null;

  it('offers nothing to clear when there is nothing to clear', async () => {
    // A × on an empty box is a control that does nothing, sitting where the eye
    // looks for one that does.
    expect(clearAll(await bar())).toBeNull();
  });

  it('appears once anything is in the box, applied or still being typed', async () => {
    expect(clearAll(await bar('abc'))).not.toBeNull();
    const el = await bar();
    await type(el, 'ga');
    expect(clearAll(el)).not.toBeNull();
  });

  it('clears the applied filter and the pending tail in one click', async () => {
    const el = await bar('abc Name:gain');
    const seen = applied(el);
    await type(el, 'Value>1');
    clearAll(el)!.click();
    await el.updateComplete;
    expect(seen).toEqual(['']);
    expect(input(el).value).toBe('');
  });

  it('leaves the caret in the box, ready for the next search', async () => {
    const el = await bar('abc');
    clearAll(el)!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(input(el));
  });

  it('is a labelled button, so it is reachable without a mouse', async () => {
    const el = await bar('abc');
    const button = clearAll(el)!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBe('Clear search');
  });

  it('proposes nothing when only a tail was pending — there is no filter to replace', async () => {
    // Clearing an uncommitted tail is a local edit. Proposing '' would look the
    // same here and would clear an applied filter that a later Escape should have
    // kept, so the two cases stay distinct.
    const el = await bar();
    const seen = applied(el);
    await type(el, 'ga');
    clearAll(el)!.click();
    await el.updateComplete;
    expect(seen).toEqual([]);
    expect(input(el).value).toBe('');
  });
});

describe('dex-filter-bar keyboard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('typing proposes nothing; Enter proposes', async () => {
    const el = await bar();
    const seen = applied(el);
    await type(el, 'gain');
    expect(seen).toEqual([]);
    await press(el, 'Enter');
    expect(seen).toEqual(['gain']);
  });

  it('appends the tail to what is already applied and clears the tail', async () => {
    const el = await bar('abc');
    const seen = applied(el);
    await type(el, 'Name:gain');
    await press(el, 'Enter');
    expect(seen).toEqual(['abc Name:gain']);
    expect(input(el).value).toBe('');
  });

  it('one Enter can commit several conditions at once', async () => {
    const el = await bar();
    const seen = applied(el);
    await type(el, 'Name:a Value>1');
    await press(el, 'Enter');
    // Two chips once the table re-parses; here, one proposal holding both.
    expect(seen).toEqual(['Name:a Value>1']);
  });

  it('Enter on an empty tail proposes nothing', async () => {
    const el = await bar('abc');
    const seen = applied(el);
    await press(el, 'Enter');
    expect(seen).toEqual([]);
  });

  it('shows the ⏎ hint only while a tail is pending', async () => {
    const el = await bar();
    expect(el.shadowRoot!.querySelector('.pending-hint')).toBeNull();
    await type(el, 'ga');
    expect(el.shadowRoot!.querySelector('.pending-hint')!.textContent).toContain('to filter');
    await press(el, 'Enter');
    expect(el.shadowRoot!.querySelector('.pending-hint')).toBeNull();
  });

  it('Backspace at the start of an empty tail pops the last chip back as text', async () => {
    const el = await bar('abc Name~=gain');
    const seen = applied(el);
    input(el).setSelectionRange(0, 0);
    await press(el, 'Backspace');
    // The user's own spelling comes back, `~=` and all — not the normalized `!=`.
    expect(input(el).value).toBe('Name~=gain');
    expect(seen).toEqual(['abc']);
  });

  it('Backspace with a tail present deletes text, not a chip', async () => {
    const el = await bar('abc');
    const seen = applied(el);
    await type(el, 'g');
    input(el).setSelectionRange(1, 1);
    await press(el, 'Backspace');
    expect(seen).toEqual([]);
  });

  it('Escape clears a pending tail first and the filter second', async () => {
    const el = await bar('abc');
    const seen = applied(el);
    await type(el, 'gain');
    await press(el, 'Escape');
    expect(input(el).value).toBe('');
    expect(seen).toEqual([]);
    await press(el, 'Escape');
    expect(seen).toEqual(['']);
  });
});

describe('dex-filter-bar leaves the browser its own keys', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not preventDefault on ordinary typing, arrows or select-all', async () => {
    const el = await bar('abc');
    await type(el, 'gain');
    for (const key of ['a', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      input(el).dispatchEvent(e);
      expect(e.defaultPrevented, key).toBe(false);
    }
  });

  it('leaves ArrowLeft at position 0 to the browser rather than eating a chip', async () => {
    const el = await bar('abc Name:gain');
    const seen = applied(el);
    input(el).setSelectionRange(0, 0);
    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    input(el).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(seen).toEqual([]);
  });

  it('pastes a whole query as one tail, committed by one Enter', async () => {
    const el = await bar();
    const seen = applied(el);
    await type(el, 'Name:a "Data Type"=double Value>1');
    await press(el, 'Enter');
    expect(seen).toEqual(['Name:a "Data Type"=double Value>1']);
  });

  it('Backspace on a selection deletes the selection, not a chip', async () => {
    const el = await bar('abc');
    const seen = applied(el);
    await type(el, 'gain');
    input(el).setSelectionRange(0, 4);
    await press(el, 'Backspace');
    expect(seen).toEqual([]);
  });
});
