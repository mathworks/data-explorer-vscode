// Copyright 2026 The MathWorks, Inc.
//
// The shared stylesheet's filename is a contract between two build steps that
// never see each other: vite emits the file, and the host writes the <link> that
// loads it. Nothing failed when they disagreed — the webview simply rendered
// without its shared styles, and the integration suite logged
// `Webview.loadLocalResource - Error using fileReader ... property.css` on every
// single test while still reporting 73 passing. So the disagreement is what these
// tests look for.
//
// How it broke: vite named the CSS after the chunk it was hoisted into, which
// happened to be `property`; the host hardcoded `property.css`. Adding a module
// that BOTH webview entries import renamed the chunk to `matrixOpen`, and with it
// the stylesheet.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_STYLESHEET } from '../src/common/webviewAssets.js';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('the shared stylesheet name is one constant, not two literals', () => {
  it('the host resolves it from the constant', () => {
    const src = read('src/host/webviewHtml.ts');
    expect(src).toContain('SHARED_STYLESHEET');
    // The literal reappearing here is how the drift happened the first time.
    expect(src).not.toContain("'property.css'");
  });

  it('the vite config emits it under the constant, not under [name]', () => {
    const src = read('vite.config.ts');
    expect(src).toContain('SHARED_STYLESHEET');
    expect(src).not.toContain("assetFileNames: 'assets/[name][extname]'");
  });

  it('is a bare filename, since both sides join it onto assets/ themselves', () => {
    expect(SHARED_STYLESHEET).toBe('property.css');
    expect(SHARED_STYLESHEET).not.toContain('/');
  });

  // CI builds before it runs the unit suite, so this is a real check there. It is
  // skipped rather than failed on a clean checkout, where dist/ does not exist.
  it('the built webview actually contains that file', () => {
    const dist = join(root, 'dist', 'webview');
    if (!existsSync(dist)) {
      return;
    }
    expect(existsSync(join(dist, 'assets', SHARED_STYLESHEET))).toBe(true);
  });
});

// A second contract between TS and CSS, and the maintainer has raised it twice. The Add gallery's
// responsive width arrived as a resize listener that measured the tab and wrote inline styles —
// "the responsiveness of the popup dialog should be done throught css directly, why do you need TS
// code?" (2026-09-28) — and the CSS that replaced it still read three TS constants interpolated
// into its declarations, one of them as the literal arithmetic `${2 * ADD_GALLERY_INSET}px`:
// "why do you do styling calculation in TS code, it should be done through CSS only" (2026-09-29).
//
// So the rule is a property of every component, not of the one that broke it: a `css` template is
// CSS text and nothing else. Custom properties are how a number gets in — declared on `:host` when
// only that shadow root needs it, in vscode-theme.css when two do — and calc() is how it gets
// multiplied. What this buys beyond doing as asked: an interpolated constant is baked per bundle at
// build time, so two components sharing one can still ship two different numbers, while a var() is
// resolved once at run time and cannot disagree with itself.
describe('a component stylesheet is CSS, with no TS interpolated into it', () => {
  const dir = 'src/webview/components';
  const files = [
    ...readdirSync(join(root, dir))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `${dir}/${f}`),
    ...readdirSync(join(root, dir, 'styles'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `${dir}/styles/${f}`),
  ];

  // The guard is only as good as the set it runs over — an empty glob passes everything.
  it('finds the components at all', () => {
    expect(files).toContain(`${dir}/dex-add-gallery.ts`);
    expect(files).toContain(`${dir}/dex-tree-table.ts`);
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file} interpolates nothing into its css template`, () => {
      const src = read(file);
      let found = 0;
      // Every css`…` body: from the tag to the backtick that closes it. A tagged template cannot
      // contain a backtick, so the next one is the end — which is also why the numbers had to be
      // interpolated rather than written inline in the first place.
      for (const tag of src.matchAll(/(^|[^\w.])css`/g)) {
        const start = tag.index! + tag[0].length;
        const end = src.indexOf('`', start);
        expect(end, `unterminated css template in ${file}`).toBeGreaterThan(start);
        const body = src.slice(start, end);
        expect(
          body.match(/\$\{[^}]*\}/g),
          `${file} interpolates TS into CSS — declare a custom property instead`,
        ).toBeNull();
        found++;
      }
      // Not every component has styles of its own, but the ones named above do, and a regex that
      // silently matched nothing is the way this check would rot.
      if (/dex-(add-gallery|tree-table)\.ts$/.test(file)) expect(found).toBeGreaterThan(0);
    });
  }
});
