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
import { existsSync, readFileSync } from 'node:fs';
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
