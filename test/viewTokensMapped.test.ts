// Copyright 2026 The MathWorks, Inc.
//
// EVERY --dex-* TOKEN THE VIEW'S WIDGETS READ IS DECLARED IN vscode-theme.css.
//
// The widgets carry no VS Code variable of their own (data-explorer-view since 0.2): each var()
// they read is a --dex-* token whose fallback is the view's LIGHT theme literal, and the view's
// theme.css declares its own light, dark and high-contrast sets. Neither of those may decide
// anything a VS Code user sees. The trap this pins: a token vscode-theme.css forgets renders
// theme.css's value, or the widget's light literal, in every VS Code theme — a white tooltip on
// Dark Modern, say — and nothing warns, because the declaration that is missing cannot fail.
//
// Read from the INSTALLED view (its dist and its theme.css), so a view bump that starts reading
// a new token fails here until this file maps it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DECORATIONS } from 'data-explorer-view/model';

// Off the cwd, as the other stylesheet tests here: vitest runs from the repo root.
const VIEW = join(process.cwd(), 'node_modules', 'data-explorer-view');
const noComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function widgetFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return widgetFiles(path);
      return name.endsWith('.js') ? [path] : [];
    });
}

const WIDGETS = widgetFiles(join(VIEW, 'dist', 'widgets')).map((f) => noComments(readFileSync(f, 'utf8')));
const VIEW_THEME = noComments(readFileSync(join(VIEW, 'src', 'theme', 'tokens.css'), 'utf8'));
const VSCODE_THEME = noComments(readFileSync(join(process.cwd(), 'src', 'webview', 'vscode-theme.css'), 'utf8'));

/** Text made literal inside a RegExp. */
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const declared = (css: string): Set<string> => new Set([...css.matchAll(/(--dex-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
// In a widget's JavaScript a token is declared in its stylesheet (`--dex-row-ink: …`) or set on an
// element through the CSSOM, as a quoted key (`'--dex-table-min-width': …`).
const declaredInJs = (js: string): Set<string> =>
  new Set([...js.matchAll(/(--dex-[a-z0-9-]+)['"]?\s*:/g)].map((m) => m[1]));
const READ = new Set(WIDGETS.flatMap((js) => [...js.matchAll(/var\(\s*(--dex-[a-z0-9-]+)/g)].map((m) => m[1])));
const IN_WIDGETS = new Set(WIDGETS.flatMap((js) => [...declaredInJs(js)]));
const IN_VIEW_THEME = declared(VIEW_THEME);
const IN_VSCODE_THEME = declared(VSCODE_THEME);

// A token a widget declares for itself and reads back (the table's --dex-row-ink, the project
// page's --dex-muted) is the widget's business. One the view's theme also declares stays a theme
// token, whoever else redeclares it — the selected row redeclares --dex-color-text-muted.
const THEME_TOKENS = [...READ].filter((t) => !IN_WIDGETS.has(t) || IN_VIEW_THEME.has(t)).sort();

/** Every declared value of one custom property in vscode-theme.css, in source order. */
const values = (name: string): string[] =>
  [...VSCODE_THEME.matchAll(new RegExp(`(?:^|[;{\\s])${escape(name)}\\s*:([^;]*);`, 'g'))].map((m) =>
    m[1].replace(/\s+/g, ' ').trim(),
  );

describe('vscode-theme.css maps every token the view reads', () => {
  it('reads the view this test thinks it does', () => {
    // A moved dist or a view whose widgets read nothing would pass the check below vacuously.
    expect(WIDGETS.length).toBeGreaterThan(10);
    expect(THEME_TOKENS.length).toBeGreaterThan(50);
  });

  it('declares each one, so neither theme.css nor a widget literal decides a VS Code pixel', () => {
    const missing = THEME_TOKENS.filter((t) => !IN_VSCODE_THEME.has(t));
    expect(missing, 'read by a view widget, not declared in vscode-theme.css').toEqual([]);
  });

  it('declares each one on :root, so a page carrying no theme class still gets all of them', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(VSCODE_THEME);
    expect(root, 'vscode-theme.css has no :root block').not.toBeNull();
    const atRoot = declared(root![1]);
    expect(THEME_TOKENS.filter((t) => !atRoot.has(t))).toEqual([]);
  });
});

describe('the tokens that replaced a VS Code variable in a widget map onto that variable', () => {
  // Each pair is what the widget used to read itself, fallback chain included, so a theme where
  // the variable is undefined takes the same fallback it always did.
  const WAS: Record<string, string> = {
    '--dex-border-color-active': 'var(--vscode-inputOption-activeBorder, var(--dex-color-accent, #0078d4))',
    '--dex-tooltip-fg': 'var(--vscode-editorHoverWidget-foreground, #fff)',
    '--dex-tooltip-bg': 'var(--vscode-editorHoverWidget-background, #252526)',
    '--dex-tooltip-border': 'var(--vscode-editorHoverWidget-border, #454545)',
    '--dex-color-progress': 'var(--vscode-progressBar-background, var(--dex-color-accent, #0e70c0))',
    '--dex-color-modified': 'var(--vscode-gitDecoration-modifiedResourceForeground, #b45309)',
    '--dex-color-link': 'var(--vscode-textLink-foreground)',
    '--dex-input-fg': 'var(--vscode-input-foreground, var(--vscode-foreground))',
    '--dex-input-bg': 'var(--vscode-input-background, var(--vscode-editor-background))',
    '--dex-input-border': 'var(--vscode-input-border, var(--vscode-panel-border))',
    '--dex-match-highlight-bg': 'var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,.33))',
    '--dex-warning-fg': 'var(--vscode-inputValidation-warningForeground, var(--vscode-foreground))',
    '--dex-warning-bg': 'var(--vscode-inputValidation-warningBackground, rgba(255,190,60,0.12))',
    '--dex-warning-border': 'var(--vscode-inputValidation-warningBorder, #b89500)',
    '--dex-tag-bg': 'var(--vscode-badge-background, var(--vscode-editorWidget-background))',
    '--dex-tag-fg': 'var(--vscode-badge-foreground, var(--vscode-foreground))',
  };
  for (const [token, was] of Object.entries(WAS)) {
    it(`${token} = ${was}`, () => {
      expect(values(token)).toEqual([was]);
    });
  }

  it('the placeholder takes the field ink where the theme gives none, as `inherit` did', () => {
    expect(values('--dex-input-placeholder-fg')).toEqual([
      'var(--vscode-input-placeholderForeground, var(--dex-input-fg))',
    ]);
  });

  it('"modified" is the sections tree badge colour', () => {
    // Read from the view's own decoration table, so the two surfaces cannot name different ids.
    const id = `--vscode-${DECORATIONS.modified.colorId.replace(/\./g, '-')}`;
    expect(values('--dex-color-modified')[0]).toMatch(new RegExp(`^var\\(${escape(id)},`));
  });
});

describe('the frozen column shade keeps its three theme kinds', () => {
  // These were :host-context(body.vscode-dark|vscode-high-contrast) rules inside the table,
  // which only Chromium understands and which named VS Code; the same values, by the same
  // body classes, now live here. HC Light's body carries vscode-high-contrast as well.
  const block = (selector: string): string => {
    const m = new RegExp(`(?:^|\\})\\s*${escape(selector)}\\s*\\{([^}]*)\\}`).exec(VSCODE_THEME);
    expect(m, `no ${selector} block`).not.toBeNull();
    return m![1].replace(/\s+/g, ' ');
  };

  it('light, dark, high contrast', () => {
    expect(block(':root')).toContain('--dex-frozen-shade: 8px 0 6px -3px rgba(0, 0, 0, 0.28);');
    expect(block('body.vscode-dark')).toContain('--dex-frozen-shade: 11px 0 8px -4px rgba(0, 0, 0, 0.7);');
    expect(block('body.vscode-high-contrast')).toContain('--dex-frozen-shade: 0 0 0 0 transparent;');
    expect(values('--dex-frozen-shade')).toHaveLength(3);
  });
});
