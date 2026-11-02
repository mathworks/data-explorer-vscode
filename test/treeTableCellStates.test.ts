// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The cell states of issue #26 (editable, read-only, and not applicable), as this extension's
// theme meets them. The table's half (which state each cell carries, that a cell marked editable
// opens an editor, and the stylesheet's rules for each state) is view's, and view proves it
// (test/treeTableCellStates.test.ts). What stays here is vscode-theme.css's half: the selected
// row's ink, and the one strength of dimmed ink the widget and this sheet both declare.
//
// What happy-dom cannot do is evaluate any of the CSS — no color-mix, no :hover, no layout — so
// the rules are asserted as text, and the rendered colours are qualified separately by the
// browser harness against the shipped bundle.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DexTreeTable, defineTreeTable } from 'data-explorer-view/tree-table';

defineTreeTable();

const sheet = (): string =>
  (DexTreeTable.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');

// Read off the cwd, not off import.meta.url: this file runs under happy-dom, where
// import.meta.url is an http URL and fileURLToPath throws on it.
const themeCss = (): string =>
  readFileSync(resolve('src/webview/vscode-theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the stylesheet spends each channel on one job', () => {
  it("falls back to the editor foreground for the selected row's ink, in every theme kind", () => {
    // VS Code chooses list.activeSelectionBackground and list.activeSelectionForeground as a
    // pair, and the widget takes the selected row's ink through --dex-selection-fg, beside the
    // surface (view's treeTableCellStates.test.ts). This sheet declares that token in every theme
    // kind, as a VS Code colour falling back to --vscode-foreground. The fallback is not
    // optional: both selection foregrounds are registered NULL in some variant (hcDark/hcLight
    // for the list one, light/dark for the editor one), so an unfallbacked read is the normal
    // path into a broken one. (vscodeThemeTokens.test.ts pins that every declaration of the
    // token reads the theme.)
    const inks = [...themeCss().matchAll(/--dex-selection-fg:\s*([^;]*);/g)].map((m) =>
      m[1].replace(/\s+/g, ' ').trim(),
    );
    expect(inks.length).toBeGreaterThan(0);
    for (const ink of inks) {
      expect(ink, 'the selection ink must fall back to the foreground').toMatch(/var\(--vscode-foreground\)\)$/);
    }
  });

  it('dims read-only ink against the row ink, at one strength everywhere', async () => {
    // Read-only text has to be dim relative to whatever ink the ROW is using, or a selected
    // row keeps 78% of the editor foreground and the dim cells vanish into a saturated
    // selection. That means the muted token is declared twice — once at :root over
    // --vscode-foreground, once here over the selection foreground — because a var() nested
    // in a custom property is substituted where the property is DECLARED, not where it is
    // used, so one parameterised declaration is not expressible.
    //
    // Two declarations of one number is exactly how the two drift apart, which is the bug
    // shape this file already carries three examples of. So the percentages are compared
    // rather than trusted.
    const sel = sheet().indexOf('tr.data-row.selected {');
    const rowMix = /--dex-color-text-muted:\s*color-mix\(\s*in srgb,\s*var\(--dex-row-ink(?:,[^)]*)?\)\s*(\d+)%/.exec(
      sheet().slice(sel),
    );
    expect(rowMix, 'the selected row does not redeclare --dex-color-text-muted').not.toBeNull();
    const theme = themeCss();
    const rootMix = /--dex-color-text-muted:\s*color-mix\(\s*in srgb,\s*var\(--vscode-foreground\)\s*(\d+)%/.exec(
      theme,
    );
    expect(rootMix, 'vscode-theme.css does not declare --dex-color-text-muted as a mix').not.toBeNull();
    expect(rowMix![1], 'the two muted-ink strengths have drifted apart').toBe(rootMix![1]);
  });
});
