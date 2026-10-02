// Copyright 2026 The MathWorks, Inc.
//
// THE VARIABLE EDITOR'S COLOURS COME FROM THE THEME, AND ITS STICKY HEADERS ARE OPAQUE.
//
// Reported 2026-10-01: "the mini table column header and row header cell background are
// transparent, when scroll, it overlap on the cell content."
//
// The header was `rgba(0, 0, 0, 0.04)` — a 4%-black wash — so every cell that scrolled
// behind it stayed visible: measured on the shipped bundle at 208/255 worst-case change
// over 13.8% of the header's pixels, i.e. the digits of the row underneath, painted
// through the numbers labelling the column. dex-tree-table solved the same problem on its
// frozen first column and wrote the rule down there: a sticky cell paints its own
// background, nothing is painted between it and what it covers, so anything short of a
// FULLY opaque background lets the content slide visibly underneath.
//
// But the wash was a SYMPTOM. The cause is that these three files read a token family
// nobody declares — --dex-fg, --dex-popover-bg, --dex-muted-fg, --dex-hover-bg,
// --dex-matrix-header-bg, --dex-matrix-header-fg, --dex-matrix-grid-line — while the rest
// of the webview reads the one global.css declares and vscode-theme.css remaps onto
// --vscode-*. An undeclared token is not a missing colour, it is a SILENT one: every
// `var()` takes its own literal fallback, those literals are light-theme greys, and
// nothing anywhere says a variable was missing. Measured in a dark theme, the panel
// painted rgba(252, 252, 252, 0.98) under #1f1f1f ink — a light-theme island in a dark
// editor — and the header's share of that mistake was the one visible enough to report.
//
// Same failure mode as vscodeThemeTokens.test.ts, one level out: that file pins tokens
// that could go invalid at computed-value time, this one pins tokens that were never
// declared at all. Both end in the same place, a hard-coded grey nobody chose.
//
// WHY THESE TESTS READ SOURCE TEXT: happy-dom resolves no custom property, evaluates no
// color-mix and composites no alpha, so "is this surface opaque" is not a question it can
// answer — and in a real browser it is a question about a PAIR of colours and which is
// behind the other (see png.mjs). The pixels are measured by the harness scenario
// matrix-grid-sticky-headers.mjs, which shoots a header cell unscrolled, scrolls a whole
// row of content behind it and shoots the same rectangle again: opaque means the same
// image. What is left for a unit test is the INVARIANT the pixels confirm — that the
// declaration cannot be translucent whichever token resolves — and that is a fact about
// the text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    // Comments first, and for the reason vscodeThemeTokens.test.ts gives: the prose in
    // these files quotes token names and whole declarations verbatim to explain the trap,
    // so matching against it would let a token pass on the strength of its own obituary.
    .replace(/\/\*[\s\S]*?\*\//g, '');

// Where a --dex-* token is allowed to come from. Two files, because vscode-theme.css
// REPLACES some of global.css's values and adds none of its own names — a token declared
// only in the theme file would be undeclared in a webview whose theme file never loaded.
const DECLARED = new Set(
  [read('../src/webview/components/styles/global.css'), read('../src/webview/vscode-theme.css')]
    .flatMap((css) => [...css.matchAll(/(--dex-[a-z0-9-]+)\s*:/g)].map((m) => m[1])),
);

// The Variable Editor: the floating panel, the grid inside it, and the glyph in the table
// that opens it. One feature, three files, one invented token family between them.
const FILES = {
  'dex-variable-editor.ts': read('../src/webview/components/dex-variable-editor.ts'),
  'dex-matrix-grid.ts': read('../src/webview/components/dex-matrix-grid.ts'),
  'dex-matrix-open.ts': read('../src/webview/components/dex-matrix-open.ts'),
};

// Tokens this feature reads that NOTHING declares on purpose. Every one is a LENGTH, and
// that distinction is the whole of why they are exempt: a length is a layout knob, and the
// literal beside it is the design — the panel really is capped at 640x320 and a cell
// really is one line of text tall. A COLOUR is not a design, it is the theme's to choose,
// so an undeclared colour token means a grey nobody picked ships in every theme.
// test/matrixGridWindow.test.ts drives the grid's geometry through four of these, because
// happy-dom measures everything as zero.
const GEOMETRY = new Set([
  '--dex-matrix-max-height',
  '--dex-matrix-max-width',
  '--dex-matrix-row-height',
  '--dex-matrix-col-width',
  '--dex-matrix-rowheader-width',
]);

describe('every colour in the Variable Editor comes from a declared token', () => {
  for (const [name, css] of Object.entries(FILES)) {
    it(`${name} reads no token that nothing declares`, () => {
      const used = [...css.matchAll(/var\(\s*(--dex-[a-z0-9-]+)/g)].map((m) => m[1]);
      // Counted, because a file whose tokens were all renamed away would otherwise pass
      // this test by reading none at all.
      expect(used.length, `${name} reads no --dex-* token`).toBeGreaterThan(0);
      const undeclared = [...new Set(used)].filter((t) => !DECLARED.has(t) && !GEOMETRY.has(t));
      expect(undeclared, `${name} reads undeclared token(s)`).toEqual([]);
    });
  }
});

describe('a sticky header cell paints an opaque surface', () => {
  // The grid pins its column numbers to the top and its row numbers to the left, so every
  // cell in the matrix eventually passes behind one of them.
  const GRID = FILES['dex-matrix-grid.ts'];
  const rule = /\[role='columnheader'\],\s*\[role='rowheader'\]\s*\{([^}]*)\}/.exec(GRID);

  it('is the rule this test thinks it is', () => {
    // A renamed selector would make every assertion below vacuous.
    expect(rule, "no rule styling [role='columnheader'], [role='rowheader']").not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*sticky/);
    expect(rule![1]).toMatch(/background:/);
  });

  it('declares a background that carries no alpha, whichever token resolves', () => {
    const background = /background:([^;]*);/.exec(rule![1])![1];
    // Every way CSS has of being see-through. `transparent` is listed because it is the
    // sneaky one: color-mix(in srgb, <colour> 8%, transparent) reads like a tint and is
    // 92% see-through, which is how this bug would come back.
    for (const alpha of [/rgba\(/, /hsla\(/, /\btransparent\b/, /#[0-9a-fA-F]{4}\b/, /#[0-9a-fA-F]{8}\b/]) {
      expect(background, `header background may not be translucent: ${background.trim()}`).not.toMatch(alpha);
    }
    // And it has to be a colour the theme chose. A bare opaque literal would pass the
    // check above and paint a grey header in every theme on earth.
    expect(background).toMatch(/var\(\s*--dex-/);
  });
});

describe('--dex-focus-ring is a shadow, so it cannot be an outline colour', () => {
  // `--dex-focus-ring: 0 0 0 1px #0078D4` (vscode-theme.css; global.css declares the same
  // shape). Read as `outline: 2px solid var(--dex-focus-ring, …)` the declaration is
  // invalid at computed-value time and the browser drops it ENTIRELY — measured on the
  // shipped bundle, a focused cell in the mini table reported outlineStyle: none, i.e. a
  // keyboard user navigating the grid could not see where they were. dex-context-menu.ts
  // reads the same token correctly, as `box-shadow: inset var(--dex-focus-ring, …)`.
  for (const [name, css] of Object.entries(FILES)) {
    it(`${name} does not put it in an outline`, () => {
      const outlines = [...css.matchAll(/outline:([^;]*);/g)].map((m) => m[1]);
      for (const value of outlines) {
        expect(value, `outline:${value}`).not.toMatch(/--dex-focus-ring/);
      }
    });
  }
});
