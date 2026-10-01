// Copyright 2026 The MathWorks, Inc.
//
// One failure mode, three times in one change: a `--dex-*` token maps onto a `--vscode-*`
// variable that some theme variant does not define, so the declaration is INVALID at
// computed-value time. CSS does not then skip to some neighbouring value — it drops the
// custom property entirely, and every consumer silently falls back to the literal it
// happened to write as its own `var()` default. Those literals are light-theme greys and
// blues, so the symptom is a pale row under pale text in a high-contrast theme, measured
// at 1.24:1, and nothing anywhere says a variable was missing.
//
// The three that got caught:
//   input.border                   {dark:null, light:null, hcDark/hcLight:contrastBorder}
//   list.activeSelectionBackground {dark:.., light:.., hcDark:NULL, hcLight:#0F4A85@.1}
//   disabledForeground             defined everywhere, but at 50% alpha — issue #26 itself
//
// So the rule these tests pin is not "have a fallback" (most VS Code colours are defined
// in every variant, and a blanket rule would flag a dozen safe tokens and get muted). It
// is: the tokens carrying the issue #26 design must degrade to something DERIVED FROM
// --vscode-foreground, which the registry defines in all four variants — never to a
// hard-coded colour, which cannot be themed and is wrong in half the themes by
// construction.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../src/webview/vscode-theme.css', import.meta.url)),
  'utf8',
)
  // Comments FIRST, and this is not tidiness: the comments in that file quote token names
  // and `var(--vscode-input-border, …)` expressions verbatim to explain the trap. Matching
  // against them would let a token pass on the strength of the prose describing it.
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The declared value of one custom property, comments already gone. */
function token(name: string): string {
  const m = new RegExp(`(^|[;{]|\\s)${name}\\s*:([^;]*);`).exec(CSS);
  expect(m, `${name} is not declared in vscode-theme.css`).not.toBeNull();
  return m![2].replace(/\s+/g, ' ').trim();
}

// The tokens the hover-reveal design rests on. Each is read by a rule that has a literal
// fallback of its own, so each one failing silently means that literal ships.
const DERIVED = [
  '--dex-color-text-muted', // read-only ink
  '--dex-color-bg-na', // the wash over a cell that holds nothing
  '--dex-selection-bg', // the surface both of those land on when a row is selected
];

describe('a theme token cannot degrade to an unthemed literal', () => {
  for (const name of DERIVED) {
    it(`${name} derives its fallback from --vscode-foreground`, () => {
      const value = token(name);
      // Either it IS the mix, or it reads a VS Code colour and falls back to one.
      expect(value, `${name} = ${value}`).toContain('--vscode-foreground');
      expect(value).toMatch(/color-mix\(\s*in srgb/);
      // A bare hex anywhere in the value means some theme gets a colour the theme did not
      // choose. #cde4f7 and #e8e8e8 are the two that actually shipped this way.
      expect(value, `${name} carries a hard-coded colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  }

  it('reads every possibly-undefined VS Code colour through a fallback', () => {
    // Only the ids with a NULL registry default in some variant. Listing them by hand is
    // the point: the fact lives in workbench.desktop.main.js, not in any theme JSON, so
    // it has to be transcribed, and transcribing it is what makes the check honest.
    //
    // `input-border` is currently read nowhere — the rule that used it was reverted — so
    // that arm asserts over an empty set. Kept deliberately: it is a guard against the
    // next unfallbacked read, not a measurement of this one, and the registry fact it
    // encodes stays true whether or not we happen to use the colour today.
    //
    // `list-activeSelectionForeground` is read by dex-tree-table.ts rather than by this
    // file — the selected row is inside the shadow tree, which a document stylesheet cannot
    // select into — so its fallback is pinned in treeTableCellStates.test.ts. It is listed
    // here for the same reason as input-border: the registry fact
    // {dark:#FFFFFF, light:#FFFFFF, hcDark:NULL, hcLight:NULL} stays true, and the next read
    // of it that lands in this file has to carry a fallback too.
    for (const id of [
      'input-border',
      'list-activeSelectionBackground',
      'list-activeSelectionForeground',
      // Registered {light:NULL, dark:NULL, hcDark:#000000, hcLight:white} — so on the two
      // themes whose selected row reads it, the variable is UNDEFINED. That null is wanted
      // (the fallback is the ordinary foreground, which is the ink a blue editor selection is
      // read with) and it is still a null, so the read has to carry the fallback.
      'editor-selectionForeground',
    ]) {
      for (const use of CSS.matchAll(new RegExp(`var\\(\\s*--vscode-${id}\\s*([,)])`, 'g'))) {
        expect(use[1], `--vscode-${id} is read with no fallback`).toBe(',');
      }
    }
  });
});

describe('the selection surface has one definition per theme kind', () => {
  /** Every declared value of one custom property, in source order, comments already gone. */
  const all = (name: string) =>
    [...CSS.matchAll(new RegExp(`(?:^|[;{]|\\s)${name}\\s*:([^;]*);`, 'g'))].map((m) =>
      m[1].replace(/\s+/g, ' ').trim(),
    );

  it('aliases both public tokens rather than repeating the mix', () => {
    // Two tokens map onto the selection colour here. Written out twice, one of them gets
    // fixed and the other keeps the bug — which is the shape the original had.
    expect(token('--dex-color-accent-bg')).toBe('var(--dex-selection-bg)');
    expect(token('--dex-bg-active')).toBe('var(--dex-selection-bg)');
  });

  it('declares the surface twice — the high-contrast pair and the blue — and no more', () => {
    // :root reads list.activeSelectionBackground, which is what a ROW is and which the
    // high-contrast themes still want; body.vscode-light/.vscode-dark read
    // editor.selectionBackground, because VS Code's 2026 default themes made the list colour a
    // neutral wash and a selected row has to read as blue (maintainer, 2026-10-01). A third
    // declaration is a third theory about what "selected" looks like.
    const surfaces = all('--dex-selection-bg');
    expect(surfaces.length).toBe(2);
    expect(surfaces[0]).toContain('--vscode-list-activeSelectionBackground');
    expect(surfaces[1]).toContain('--dex-selection-tint');
    // Both fall back to the SAME mix. Neither fallback is reachable in VS Code — both colours
    // have a registry default in all four variants — so this is about a theme-less page, where
    // an invalid declaration ships dex-tree-table.ts's #cde4f7 literal. Two copies of one
    // expression is the drift this file exists to catch, so they are compared, not trusted.
    const FALLBACK = 'color-mix(in srgb, var(--vscode-foreground) 25%, transparent)';
    for (const value of surfaces) expect(value).toContain(FALLBACK);
  });

  it('takes the editor selection at part strength, through a token that can go invalid', () => {
    // The halving is the ink's number, not the eye's: a theme's editor selection is a mid-tone,
    // and the read-only cell's ink is 78% of the row ink, so at FULL strength the dim ink
    // measured 3.03:1 on Dark 2026 and 3.89:1 on Dark Modern — the issue #26 failure, on the
    // surface issue #26 was tuned on. Mixing toward transparent moves the row back toward its
    // own background, which lightens a light theme and darkens a dark one, so it buys contrast
    // in both directions. Anything at or above full strength spends that again.
    const tints = all('--dex-selection-tint');
    expect(tints.length).toBe(1);
    const mix =
      /^color-mix\(\s*in srgb,\s*var\(--vscode-editor-selectionBackground\)\s*(\d+)%,\s*transparent\s*\)$/.exec(
        tints[0],
      );
    expect(mix, 'the selection tint must be a transparent mix of the editor selection').not.toBeNull();
    expect(Number(mix![1])).toBeLessThan(100);
    expect(Number(mix![1])).toBeGreaterThanOrEqual(25);
    // And it must be its own token rather than an inline mix, because that is what keeps the
    // fallback above reachable: a custom property whose var() cannot resolve is guaranteed-invalid,
    // and a var() reading a guaranteed-invalid property takes its fallback. Wrapped inline, a
    // page with no editor.selectionBackground would make the whole declaration invalid instead,
    // and ship the component's #cde4f7. That is not hypothetical — the maintenance harness
    // measured exactly that case as a grey selected row on Light Modern.
    expect(all('--dex-selection-bg')[1]).toMatch(/^var\(\s*--dex-selection-tint\s*,/);
  });

  it('moves the ink and both aliases with the surface, declaration for declaration', () => {
    // The pair is the requirement: list.activeSelectionForeground defaults to WHITE and
    // editor.selectionForeground to null-then-foreground, so a block that switched the surface
    // alone would paint one theme's ink on another theme's row. And the aliases have to be
    // re-declared alongside, not inherited — a var() inside a custom property is substituted
    // where the property is DECLARED, so the :root aliases hold the :root surface for good.
    const n = all('--dex-selection-bg').length;
    for (const name of ['--dex-selection-fg', '--dex-color-accent-bg', '--dex-bg-active']) {
      expect(all(name).length, `${name} does not accompany every --dex-selection-bg`).toBe(n);
    }
    for (const value of all('--dex-selection-fg')) {
      expect(value, 'the selection ink must come from the theme').toMatch(/^var\(--vscode-/);
      expect(value, 'the selection ink must not be a literal').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('keeps the blue out of the high-contrast themes', () => {
    // VS Code sets exactly one theme class on the webview body, and HC Light's is
    // `vscode-high-contrast-light`, which `.vscode-high-contrast` does NOT match. So the
    // override is a positive list of the two kinds that want it: HC Black's
    // editor.selectionBackground is #FFFFFF — a white row, on which the not-applicable wash
    // (5% of a white foreground) is nothing at all — and HC Light's is an opaque navy under
    // near-black text.
    const at = CSS.indexOf('--vscode-editor-selectionBackground');
    const block = CSS.lastIndexOf('{', at);
    const selector = CSS.slice(CSS.lastIndexOf('}', block) + 1, block).trim();
    expect(selector.split(',').map((s) => s.trim())).toEqual(['body.vscode-light', 'body.vscode-dark']);
  });

  it('keeps selection distinguishable from hover when both fall back', () => {
    // VS Code uses 10% on HC Black for list.hoverBackground. If our selection fallback
    // used the same percentage, a selected row and a hovered row would be the same pixel
    // colour in the one theme where the fallback is actually reached.
    const mix = /var\(--vscode-foreground\)\s*(\d+)%/.exec(token('--dex-selection-bg'));
    expect(mix, 'no foreground percentage in the selection fallback').not.toBeNull();
    expect(Number(mix![1])).toBeGreaterThan(10);
  });
});

// A translucent surface is translucent only where it differs from what it covers, and that is a
// fact about a PAIR of colours which no measurement of either one can catch. The Add gallery
// shipped as `color-mix(in srgb, var(--dex-bg-primary) 82%, transparent)` over a table painted
// --dex-bg-primary: 0.82X + 0.18X is X, so the panel painted the exact pixels an opaque one
// would. Everything measured correct — the computed background really carried alpha 0.82, the
// backdrop-filter really ran — and the maintainer's F5 was "I don't see any transparent effect"
// (2026-09-29). The bug was in neither declaration. It was between them.
//
// So the invariant is stated about the pair, and it is checkable in text, which is why it lives
// in a unit test rather than only in the browser harness: the sheet is tinted AWAY from the
// table's background before the alpha is applied.
describe('the Add gallery sheet must differ from the table it covers', () => {
  it('tints away from the editor background, toward white, before going translucent', () => {
    const tint = token('--dex-add-gallery-tint');
    // Mixed off the same background the table paints, so it tracks the theme...
    expect(tint).toContain('--dex-bg-primary');
    // ...but is not equal to it, and the direction is the second half of this design. The round
    // that first made the sheet visible stepped toward --vscode-foreground, which SELF-INVERTS —
    // lighter on a dark theme, darker on a light one. That is right for a wash that only has to
    // stay subtle (--dex-color-bg-na above does it deliberately) and wrong for glass: it painted
    // a grey pane over Light Modern's white table, and the F5 was "the gallery background looks
    // dark in light theme. I want to see a white glossy glass effect" (2026-09-29). Glass is lit,
    // and light is white in every theme, so the step goes ONE direction and the sheet is never
    // darker than what it covers.
    expect(tint, `--dex-add-gallery-tint = ${tint}`).toMatch(/\bwhite\b/);
    expect(tint).not.toContain('--vscode-foreground');
    // `white` is the one colour literal this file allows, for the same reason dex-add-gallery.ts
    // may write rgba(255, 255, 255, 0.12) for its sheen: a highlight is light falling on the pane,
    // not a surface the theme picked. A theme chooses its editor background; it does not choose
    // what colour light is. Every other literal here is still the bug the tests above pin, which
    // is why this is the keyword and not #fff — the hex fence stays meaningful.
    expect(tint).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // And the step is big enough to see. It only does anything on the dark themes: where the
    // editor background IS white the tint is white at any percentage, and the sheet reads by its
    // blurred content, its border and its shadow instead — which is what white glass looks like
    // on a white page. So the floor is for the dark end, where the sheet is darkest and a small
    // step in it is hardest to see.
    const step = /var\(--dex-bg-primary\)\s*(\d+)%/.exec(tint);
    expect(step, 'no editor-background percentage in the tint').not.toBeNull();
    expect(100 - Number(step![1])).toBeGreaterThanOrEqual(5);
  });

  for (const name of ['--dex-add-gallery-bg', '--dex-add-gallery-header-bg']) {
    it(`${name} takes its colour from the tint, not from the table`, () => {
      const value = token(name);
      expect(value).toContain('--dex-add-gallery-tint');
      // The edit that would revert all of this is one word — swapping the tint back for
      // --dex-bg-primary reads as a simplification and restores the invisible panel exactly.
      expect(value).not.toContain('--dex-bg-primary');
      expect(value).toContain('transparent');
    });
  }

  it('keeps the surface more transparent than the header over it', () => {
    // The header holds the title and the pin steady while tiles scroll under it, so it is the
    // solider of the two. Equal, and there was no reason for two tokens; inverted, and the one
    // strip that has to stay readable is the one you can see through.
    const alpha = (name: string) => {
      const m = /--dex-add-gallery-tint\)\s*(\d+)%/.exec(token(name));
      expect(m, `${name} does not mix the tint by a percentage`).not.toBeNull();
      return Number(m![1]);
    };
    expect(alpha('--dex-add-gallery-bg')).toBeLessThan(alpha('--dex-add-gallery-header-bg'));
    // And the surface is glass rather than a film: at 90% there is nothing to see through it.
    //
    // 65 rather than the 80 this started at, because the tiles went opaque (maintainer, F5
    // 2026-09-29: "make the gallery background a little bit more transparent, but the buttons
    // background opaque"). The tiles are ~90% of the panel's area, so the glass is now carried by
    // the 4px gutters, the run past the end of a short row, the heading bands and the sticky bar —
    // small places, which is exactly where a high alpha stops reading as glass at all. The two
    // halves of that ask are one change and this is the fence that keeps them together: raising
    // this number back toward 80 with solid tiles in front of it is the invisible panel again, in
    // a new shape.
    expect(alpha('--dex-add-gallery-bg')).toBeLessThanOrEqual(65);
  });

  // The panel is ONE colour at three alphas — sheet, header, tiles — so this file owns exactly one
  // colour for it. A --dex-add-gallery-tile-bg (or -tile-surface, or -chip-bg) would be a second
  // number to keep in step with the first, which is what the 88% tile wash two rounds ago was: the
  // tile reads the tint itself, at full opacity, from its own stylesheet.
  it('declares one colour for the gallery, not one per layer', () => {
    const tileColourTokens = [...CSS.matchAll(/--dex-add-gallery-[\w-]+/g)]
      .map((m) => m[0])
      .filter((name) => /tile|chip|button/.test(name) && !/width/.test(name));
    expect(tileColourTokens).toEqual([]);
  });
});
