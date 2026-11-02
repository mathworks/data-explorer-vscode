// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Add gallery's tokens, as this extension declares them. The gallery and the table's button
// that opens it are view's, and view proves them (test/addGalleryWidget.test.ts,
// test/addGalleryGrid.test.ts, test/addCatalog.test.ts). What stays here is vscode-theme.css's
// half: the geometry tokens the two widgets read, and the colours the pressed button takes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineAddGallery, defineTreeTable } from 'data-explorer-view/tree-table';

defineAddGallery();
defineTreeTable();

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

describe('the table and the gallery together', () => {
  const cssOf = (tag: string) =>
    [(customElements.get(tag) as any).styles]
      .flat()
      .map((s: any) => s.cssText)
      .join('\n');
  const tableCss = () => cssOf('dex-tree-table');
  const galleryCss = () => cssOf('dex-add-gallery');

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

  it("maps the pressed bar button's border onto inputOption's, and takes no surface from that group", () => {
    // The pressed rule is the widget's (view's addGalleryWidget.test.ts): a border as well as a
    // surface, because in Light Modern the surface alone (#E8E8E8 selection over #F2F2F2 hover) is
    // four percent of grey. The widget reads the border as --dex-border-color-active, which this
    // extension maps onto inputOption's.
    expect(THEME_CSS).toMatch(/--dex-border-color-active:\s*var\(--vscode-inputOption-activeBorder\b/);
    // And the surface is NOT taken from that same group: inputOption.activeBackground is
    // registered `transparent` on the high-contrast themes, where a var() fallback therefore
    // never fires and the button would lose its only cue. Cheap to write, invisible to review,
    // and exactly the kind of regression a browser harness cannot catch either — the harness
    // leaves the HC token undefined, so the trap would measure as though it worked.
    expect(THEME_CSS).not.toContain('--vscode-inputOption-activeBackground');
  });
});
