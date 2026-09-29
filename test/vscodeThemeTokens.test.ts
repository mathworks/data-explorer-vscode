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
    for (const id of ['input-border', 'list-activeSelectionBackground', 'list-activeSelectionForeground']) {
      for (const use of CSS.matchAll(new RegExp(`var\\(\\s*--vscode-${id}\\s*([,)])`, 'g'))) {
        expect(use[1], `--vscode-${id} is read with no fallback`).toBe(',');
      }
    }
  });
});

describe('the selection surface has one definition', () => {
  it('aliases both public tokens rather than repeating the mix', () => {
    // Two tokens map onto list.activeSelectionBackground here. Written out twice, one of
    // them gets fixed and the other keeps the bug — which is the shape the original had.
    expect(token('--dex-color-accent-bg')).toBe('var(--dex-selection-bg)');
    expect(token('--dex-bg-active')).toBe('var(--dex-selection-bg)');
    expect(CSS.match(/--dex-selection-bg\s*:/g)?.length).toBe(1);
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
    expect(alpha('--dex-add-gallery-bg')).toBeLessThanOrEqual(80);
  });
});
