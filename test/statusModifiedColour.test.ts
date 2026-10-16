// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The table's Status "Modified" mark takes its colour from the theme, and from the SAME
// theme colour as the sections tree's Modified badge (DECORATIONS.modified in
// src/host/health.ts), so "modified" is one colour on both surfaces.
//
// It used to be the literal #b45309, chosen against a light background: 3.54:1 on Dark
// Modern's #181818 and 4.18:1 on HC Black's #000, both under WCAG AA's 4.5. A theme colour
// is the theme's own answer for each variant, high contrast included. The literal stays as
// the fallback, reached only where the colour is not registered at all: it is contributed
// by the built-in git extension, so it is absent when that extension is disabled and in
// VS Code for the Web, which does not load it.
//
// happy-dom computes no colour, so the rule is asserted as text here, through the element
// the real render path produces; the rendered contrast was measured in a browser against
// the shipped bundle.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { DECORATIONS } from '../src/host/health.js';

beforeEach(() => localStorage.clear());

const sheet = (): string =>
  (DexTreeTable.styles as unknown as { cssText: string }[])
    .map((s) => s.cssText)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every innermost rule in the stylesheet as [selector list, declaration block]. */
const rules = (): [string, string][] =>
  [...sheet().matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

/** The `color` the declaration block sets, whitespace-normalised, or null. */
function colorOf(block: string): string | null {
  const m = /(?:^|[;\s])color\s*:([^;]*)(;|$)/.exec(block);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** The VS Code webview variable for a ThemeColor id: `a.b` -> `--vscode-a-b`. */
const cssVarFor = (colorId: string): string => `--vscode-${colorId.replace(/\./g, '-')}`;

async function mountModifiedRow(): Promise<{ table: DexTreeTable; mark: HTMLElement }> {
  const table = new DexTreeTable();
  table.columns = ['Name', 'Status'];
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  const row: TreeTableRow = { ID: 'm', parent: null, Name: { label: 'Kp' }, Status: 'Modified' };
  table.rows = [row];
  table.requestUpdate();
  await table.updateComplete;
  const td = table.shadowRoot!.querySelector('tr[data-row-id="m"] td.col-Status') as HTMLElement;
  expect(td, 'the Status cell rendered').not.toBeNull();
  const mark = td.querySelector('span') as HTMLElement;
  expect(mark?.textContent?.trim()).toBe('Modified');
  return { table, mark };
}

/** The colour of every rule that selects the rendered mark itself (not an ancestor). */
function colorsSelecting(mark: HTMLElement): { selector: string; color: string }[] {
  const out: { selector: string; color: string }[] = [];
  for (const [selectorList, block] of rules()) {
    const color = colorOf(block);
    if (color === null || selectorList.startsWith('@')) continue;
    for (const selector of selectorList.split(',').map((s) => s.trim())) {
      let hit = false;
      try {
        hit = mark.matches(selector);
      } catch {
        // :host(...), ::part and friends: not a selector a light element can match.
      }
      if (hit) out.push({ selector, color });
    }
  }
  return out;
}

describe('the Status "Modified" mark reads the theme', () => {
  it('reads gitDecoration.modifiedResourceForeground, with the old literal as its fallback', async () => {
    const { table, mark } = await mountModifiedRow();
    const colours = colorsSelecting(mark);
    expect(colours.map((c) => c.selector)).toContain('.status-modified');
    // Every rule that colours the mark: a second, literal one (a "high contrast override")
    // would put back exactly the unthemed colour this replaces.
    for (const { selector, color } of colours) {
      expect(color, selector).toBe('var(--vscode-gitDecoration-modifiedResourceForeground, #b45309)');
    }
    // And it keeps its weight, the half of the cue that is not colour.
    const own = rules().find(([sel]) => sel === '.status-modified');
    expect(own![1]).toMatch(/font-weight\s*:\s*500\s*;/);
    table.remove();
  });

  it('is the same theme colour as the sections tree badge for the same state', async () => {
    const { table, mark } = await mountModifiedRow();
    const colours = colorsSelecting(mark);
    expect(colours.length).toBeGreaterThan(0);
    const expected = cssVarFor(DECORATIONS.modified.colorId);
    for (const { selector, color } of colours) {
      const read = /^var\(\s*(--[A-Za-z0-9-]+)\s*,/.exec(color);
      expect(read, `${selector} reads no theme variable: ${color}`).not.toBeNull();
      expect(read![1], selector).toBe(expected);
    }
    table.remove();
  });
});
