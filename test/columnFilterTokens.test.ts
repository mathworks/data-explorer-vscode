// Copyright 2026 The MathWorks, Inc.
//
// THE PER-COLUMN FILTER POPUP READS ONLY TOKENS THE THEME DECLARES.
//
// The same failure mode as variableEditorTheme.test.ts, in a different component, found
// by sweeping every webview file for `var(--dex-*)` reads with no declaration anywhere.
// An undeclared token is not a missing colour, it is a SILENT one: the `var()` takes its
// own literal fallback, nothing warns, and the literal is a light-theme value by
// construction, because a light theme is what the author had on screen.
//
// Two of them shipped here, and the colour one was severe. `.op-button[aria-pressed=true]`
// — the button that says WHICH comparison Apply is about to write, i.e. the popup's entire
// state display — read `--dex-bg-selected`, which neither global.css nor vscode-theme.css
// declares. So it painted #cce4f7 in every theme. Measured on the shipped bundle through
// the browser harness (scenarios/column-filter-tokens.mjs), pressed button vs its own ink:
//
//   Dark Modern   #cce4f7 under #cccccc   1.22:1   fails AA *and* AA-Large
//   HC Black      #cce4f7 under #ffffff   1.31:1   fails AA *and* AA-Large
//   Light Modern  #cce4f7 under #3b3b3b   8.54:1   passes, which is why nobody saw it
//   HC Light      #cce4f7 under #292929  11.09:1   passes
//
// The unpressed buttons beside it measured 10.26:1 (Dark) and 21:1 (HC Black) off the
// declared --dex-bg-primary, so the pressed one was the single unreadable element in the
// popup. 1.22:1 is below the 2.13:1 that issue #26 was filed about.
//
// The declared token for this surface already existed and is two characters away:
// --dex-color-accent-bg, which vscode-theme.css aliases onto --dex-selection-bg (pinned in
// vscodeThemeTokens.test.ts) and global.css declares per theme kind. Its light value is
// #cde4f7 — the shipped literal was that value with one hex digit changed, which is the
// evidence that the token name was a slip and not a design.
//
// The second was --dex-font-family-mono on `.writes-value`, where --dex-font-mono is
// declared. Not a contrast bug: the consequence is that the teaching line showing the
// literal filter syntax ignored the user's configured editor font and hard-coded a stack.
//
// WHY THIS READS SOURCE TEXT: happy-dom resolves no custom property, so it cannot tell a
// declared token from an undeclared one — the measurement that proves the consequence is
// the harness's, in a browser that composites. What is left for a unit test is the
// invariant: every token this component reads has to be declared SOMEWHERE, which is a
// fact about the text and the one that would have caught both of these at review.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    // Comments first, exactly as variableEditorTheme.test.ts does it: the prose in these
    // files (and in this one's own subject matter) quotes token names verbatim to explain
    // the trap, so matching against it would let a token pass on the strength of its
    // own obituary.
    .replace(/\/\*[\s\S]*?\*\//g, '');

// Where a --dex-* token is allowed to come from. Two files, because vscode-theme.css
// REPLACES some of global.css's values and adds no names of its own — a token declared
// only in the theme file would be undeclared in a webview whose theme file never loaded.
const DECLARED = new Set(
  [read('../src/webview/components/styles/global.css'), read('../src/webview/vscode-theme.css')]
    .flatMap((css) => [...css.matchAll(/(--dex-[a-z0-9-]+)\s*:/g)].map((m) => m[1])),
);

// The file list is explicit, and short, for the same reason vscodeThemeTokens.test.ts
// transcribes its colour ids by hand: the whole of src/webview does NOT satisfy this
// invariant today, and a test that fails on arrival gets widened until it passes, which is
// how it would come to assert nothing. One file is knowingly outside it, captured on the
// maintenance agenda rather than silently exempted here:
//
//   dex-tree-table.ts         --dex-border-color-ultralight, fallback rgba(0, 0, 0, 0.05),
//                             inside :host([table-style='light']) — a rule nothing can
//                             reach, because nothing in the repo ever sets `table-style`
//                             away from its 'normal' default. The open question there is
//                             whether that property should exist at all.
//
// Add a file here when it is clean. Do not add an exemption to keep one in.
const FILES = {
  'dex-column-filter.ts': read('../src/webview/components/dex-column-filter.ts'),
  'dex-filter-bar.ts': read('../src/webview/components/dex-filter-bar.ts'),
};

describe('the column filter popup and the filter bar read no token that nothing declares', () => {
  for (const [name, css] of Object.entries(FILES)) {
    it(`${name} reads only declared --dex-* tokens`, () => {
      const used = [...css.matchAll(/var\(\s*(--dex-[a-z0-9-]+)/g)].map((m) => m[1]);
      // Counted, because a file whose tokens were all renamed away would otherwise pass
      // this test by reading none at all.
      expect(used.length, `${name} reads no --dex-* token`).toBeGreaterThan(0);
      // A token the component declares itself is fine — it is a local alias, not an
      // invented global. dex-column-filter has none today; the branch is here so adding
      // one does not read as this bug.
      const local = new Set([...css.matchAll(/(--dex-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
      const undeclared = [...new Set(used)].filter((t) => !DECLARED.has(t) && !local.has(t));
      expect(undeclared, `${name} reads undeclared token(s)`).toEqual([]);
    });
  }
});

describe('the two tokens that shipped undeclared stay gone', () => {
  // Named individually, on top of the sweep above, because the sweep passes the moment a
  // name is DECLARED — and declaring --dex-bg-selected in global.css would be the wrong
  // repair: it would add a fourth spelling of "the selected surface" beside
  // --dex-selection-bg, --dex-color-accent-bg and --dex-bg-active, which is the drift
  // vscodeThemeTokens.test.ts exists to prevent. The requirement is that this component
  // reads the EXISTING token, not that the invented name acquires a value.
  const CSS = FILES['dex-column-filter.ts'];

  it('takes the pressed operator surface from --dex-color-accent-bg', () => {
    const rule = /\.op-button\[aria-pressed='true'\]\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, "no rule styling .op-button[aria-pressed='true']").not.toBeNull();
    const background = /background:([^;]*);/.exec(rule![1]);
    expect(background, 'the pressed operator declares no background').not.toBeNull();
    expect(background![1]).toMatch(/var\(\s*--dex-color-accent-bg\b/);
    expect(CSS).not.toContain('--dex-bg-selected');
  });

  it('takes the syntax line monospace from --dex-font-mono', () => {
    const rule = /\.writes-value\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, 'no rule styling .writes-value').not.toBeNull();
    expect(rule![1]).toMatch(/font-family:\s*var\(\s*--dex-font-mono\b/);
    expect(CSS).not.toContain('--dex-font-family-mono');
  });
});

describe('the filter bar chip wash is declared, at the value it was measured at', () => {
  // --dex-bg-badge was the filter bar's one undeclared read: the term chips painted
  // `var(--dex-bg-badge, rgba(128, 128, 128, 0.18))` and nothing declared the name, so the
  // fallback always won. The repair DECLARES it with that literal, so the chips render as
  // before. A mid-grey at 18% alpha is self-neutral, and the chip-ink contrast measured in
  // the browser on 2026-10-04 (11.47 / 8.16 / 17.92 / 14.88 :1 across Dark Modern, Light
  // Modern, HC Black, HC White) was taken at exactly this value. A theme override, or a
  // remap onto a VS Code colour (--vscode-badge-background is a SOLID colour), would change
  // every chip and void those numbers, so this pins ONE declaration, in :root, and holds the
  // chip's own fallback to the same value so the two cannot drift apart.
  const WASH = 'rgba(128, 128, 128, 0.18)';
  const sheets = {
    'global.css': read('../src/webview/components/styles/global.css'),
    'vscode-theme.css': read('../src/webview/vscode-theme.css'),
  };

  it(`.chip reads --dex-bg-badge, which global.css :root alone declares, as ${WASH}`, () => {
    const rule = /\.chip\s*\{([^}]*)\}/.exec(FILES['dex-filter-bar.ts']);
    expect(rule, 'no rule styling .chip').not.toBeNull();
    const background = /background:([^;]*);/.exec(rule![1]);
    expect(background, 'the .chip rule declares no background').not.toBeNull();
    const reads = /^\s*var\(\s*--dex-bg-badge\s*(?:,\s*(.*))?\)\s*$/.exec(background![1]);
    expect(reads, `.chip background is not var(--dex-bg-badge): ${background![1]}`).not.toBeNull();

    const declarations = Object.entries(sheets).flatMap(([name, css]) =>
      [...css.matchAll(/--dex-bg-badge\s*:\s*([^;]*);/g)].map((m) => `${name}: ${m[1].trim()}`),
    );
    expect(declarations, 'every declaration of --dex-bg-badge').toEqual([`global.css: ${WASH}`]);
    const root = /:root\s*\{([^}]*)\}/.exec(sheets['global.css']);
    expect(root, 'global.css has no :root block').not.toBeNull();
    expect(root![1]).toContain(`--dex-bg-badge: ${WASH};`);

    if (reads![1] !== undefined) expect(reads![1].trim(), 'the .chip fallback').toBe(WASH);
  });
});
