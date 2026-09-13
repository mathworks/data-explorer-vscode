// Copyright 2026 The MathWorks, Inc.
//
// Who creates the webview's overlay elements.
//
// The table webview's HTML is assembled as a string by ONE shared host function —
// webviewHtml.ts's renderTableWebview, which all three table providers delegate to —
// and a second shell (src/webview/table.html) exists for vite dev. table-main.ts is
// shared by both, so every element it looks up in markup is one rule spread over TWO
// paths.
//
// It was four paths until the three providers each carried their own byte-identical
// copy of that markup, and the wider split is where both of these real bugs came from:
//
//   * BinaryEditorProvider never had <dex-error-dialog>, so `errorDialog?.show()`
//     silently did nothing and invalid-value errors were invisible in that view.
//   * <dex-variable-editor> was added to table.html only — vite's dev entry, not
//     a shipped shell — so the element was null at runtime and a close() call in
//     the setRows handler threw, blanking the table for every file.
//
// The rule now is: markup owns the CONTENT element, table-main.ts owns every
// OVERLAY. Neither fault is reachable from a DOM test, because the providers
// import vscode and the markup is a template literal — so this reads the sources.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// Self-positioning, initially hidden popovers. None has a place in the shell's
// layout, so none belongs in the shell's markup.
const OVERLAYS = ['dex-context-menu', 'dex-error-dialog', 'dex-variable-editor'];

// Every shell that table-main.ts runs inside. Two, not five: the three providers
// share renderTableWebview, so their shell IS webviewHtml.ts and they cannot
// disagree with each other. PROVIDERS below asserts they still hold no markup of
// their own — that is what keeps this list honest at two entries.
const TABLE_SHELLS = ['src/host/webviewHtml.ts', 'src/webview/table.html'];

// The providers that delegate to the shared shell rather than being one.
const PROVIDERS = [
  'src/host/SlddTextEditorProvider.ts',
  'src/host/BinarySlddEditorProvider.ts',
  'src/host/BinaryEditorProvider.ts',
];

describe('table webview overlays are created in code, not declared in markup', () => {
  // Providers as well as shells: a provider no longer holds shell markup, but this is
  // the assertion that says an overlay must not be declared ANYWHERE in a host source,
  // so narrowing it to the two shells would have stopped checking three files it used
  // to check.
  it.each([...TABLE_SHELLS, ...PROVIDERS])('%s declares no overlay element', (shell) => {
    const src = read(shell);
    for (const tag of OVERLAYS) {
      expect(src).not.toContain(`<${tag}>`);
    }
  });

  it.each(OVERLAYS)('table-main.ts creates %s itself', (tag) => {
    expect(read('src/webview/table-main.ts')).toContain(`overlay('${tag}')`);
  });

  it('still takes the content element from markup, since only the shell places it', () => {
    // The inverse of the rule: dex-tree-table is positioned by each shell
    // (position:absolute;inset:0), so the shell must be the one to create it.
    expect(read('src/webview/table-main.ts')).toContain("document.querySelector('dex-tree-table')");
    for (const shell of TABLE_SHELLS) {
      expect(read(shell)).toContain('<dex-tree-table');
    }
  });

  it('uses the overlays unguarded, because they can no longer be missing', () => {
    // `errorDialog?.show(...)` was load-bearing while a provider could omit the
    // tag. Now that this module creates it, the optional call would only hide a
    // typo — and the guard's absence is what keeps the invariant honest.
    expect(read('src/webview/table-main.ts')).not.toContain('errorDialog?.');
  });
});

// The banner strip is the exception to the rule above, and the reason it needs its
// own guard. #dex-notice and #dex-warning are LAYOUT, not overlays: they sit above
// the table and the table's top is offset by their measured height, so they cannot
// be appended to <body> by table-main.ts like the popovers are. That puts them back
// in markup — one rule over four paths — which is precisely where the two bugs above
// came from. #dex-notice already lived in one provider alone.
//
// renderTableWebview interpolates BANNERS_HTML, so every provider view agrees by
// construction; src/webview/table.html is a static file that cannot interpolate, so it
// holds a hand copy. The ids the webview looks up are read out of banners.ts rather
// than listed here, so adding a banner element cannot pass this test without being
// added to both.
describe('the banner strip is declared by every shell, because it is layout', () => {
  const BANNERS_HTML = /BANNERS_HTML = `([\s\S]*?)`;/.exec(read('src/host/webviewHtml.ts'))![1];

  // Every element renderBanners resolves. If it looks one up and a shell omits it,
  // that view silently shows no banner for a file that is short.
  const LOOKED_UP = [...read('src/webview/banners.ts').matchAll(/getElementById\('([^']+)'\)/g)].map(
    (m) => m[1],
  );

  it('renderBanners looks up more than one element, so the list below is real', () => {
    expect(LOOKED_UP.length).toBeGreaterThan(1);
  });

  it.each(LOOKED_UP)('BANNERS_HTML declares %s', (id) => {
    expect(BANNERS_HTML).toContain(`id="${id}"`);
  });

  it.each(LOOKED_UP)('the vite dev shell declares %s too', (id) => {
    expect(read('src/webview/table.html')).toContain(`id="${id}"`);
  });

  it.each(PROVIDERS)('%s takes the whole shell from renderTableWebview', (provider) => {
    const src = read(provider);
    expect(src).toContain('renderTableWebview(');
    // An inline copy is what this test exists to prevent: it would pass the id
    // checks above and still drift the moment the shared one changed. Asserting the
    // absence of ANY shell markup, not just the banner strip, is stricter than the
    // interpolation check this replaced — a provider that grew a second copy of the
    // table element or the error banner would have satisfied that one.
    expect(src).not.toContain('id="dex-notice"');
    expect(src).not.toContain('id="dex-error"');
    expect(src).not.toContain('<dex-tree-table');
    expect(src).not.toContain('${BANNERS_HTML}');
  });

  it('table-main.ts paints the strip through that one function', () => {
    // Not two calls (one per banner): the table is offset by the strip's TOTAL
    // height, so whichever code sets one has to know about the other.
    expect(read('src/webview/table-main.ts')).toContain('renderBanners(table, {');
    expect(read('src/webview/table-main.ts')).not.toContain("getElementById('dex-notice')");
  });
});

// The loading state is neither: the COMPONENT draws it. It began as a third kind
// of element — an overlay that markup declared — and got both halves of that wrong.
// Three providers interpolated it and table.html did not, so the vite dev shell
// looked it up and silently found nothing (the split this file exists to prevent);
// and being pinned at inset:0 over the whole panel, it covered the search bar the
// table had already painted, so the bar flickered on every slow open. A component
// that draws its own wait has no shells to agree and no panel-wide layer.
describe('the loading state belongs to the table component, not to any shell', () => {
  // The providers too, not just the shells: a loading element is the one thing that
  // was wrong in BOTH directions, so this stays the widest list in the file.
  const SHELLS = [...TABLE_SHELLS, ...PROVIDERS];

  it.each(SHELLS)('%s declares no loading element', (shell) => {
    expect(read(shell)).not.toContain('dex-loading');
  });

  it('table-main.ts drives it as a property, not by reaching for an element', () => {
    const src = read('src/webview/table-main.ts');
    expect(src).toContain('table.loading = true');
    expect(src).toContain('table.loading = false');
    expect(src).not.toContain("getElementById('dex-loading')");
  });

  it('the component owns the spinner and its keyframes', () => {
    // A keyframe in a shell's light DOM does not reach a shadow tree, so the
    // animation has to live in the same stylesheet as the element it turns.
    const src = read('src/webview/components/dex-tree-table.ts');
    expect(src).toContain('class="loading-spinner"');
    expect(src).toContain('@keyframes dex-spin');
  });
});

// The Property Inspector is a second webview with a second shell, and it grew the
// same overlay for the same reason. It has only one provider today, which is
// exactly how the table's shells started out.
describe('the Property Inspector creates its overlay in code too', () => {
  const PI_SHELLS = ['src/host/PropertiesViewProvider.ts', 'src/webview/pi.html'];

  it.each(PI_SHELLS)('%s declares no overlay element', (shell) => {
    for (const tag of OVERLAYS) {
      expect(read(shell)).not.toContain(`<${tag}>`);
    }
  });

  it('pi-main.ts creates the Variable Editor itself', () => {
    const src = read('src/webview/pi-main.ts');
    expect(src).toContain("document.createElement('dex-variable-editor')");
    expect(src).toContain('installMatrixOpen(pi, ');
  });

  it('still takes the inspector element from markup', () => {
    expect(read('src/webview/pi-main.ts')).toContain("document.querySelector('dex-property-inspector')");
    for (const shell of PI_SHELLS) {
      expect(read(shell)).toContain('<dex-property-inspector');
    }
  });
});
