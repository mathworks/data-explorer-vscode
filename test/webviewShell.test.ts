// Copyright 2026 The MathWorks, Inc.
// The webview's Content-Security-Policy is its only sandbox: these views render
// data read out of a user's .slx/.sldd/.mat file, so a CSP that admits an inline
// script or a remote origin turns a malformed model file into code execution in
// the extension host's webview. This suite pins the directives that make that
// impossible, plus the shell structure the three table views depend on.
//
// The vscode-coupled half (asWebviewUri resolution) lives in webviewHtml.ts and
// is exercised by the @vscode/test-electron suite; everything below is the pure
// half, split out for exactly this reason.
import { describe, it, expect } from 'vitest';
import { buildCsp, renderShell, type ShellUris } from '../src/host/webviewShell.js';

const CSP_SOURCE = 'vscode-resource://abc';

function uris(overrides: Partial<ShellUris> = {}): ShellUris {
  return {
    scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/table.js',
    styleUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview/assets/property.css',
    baseUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview',
    cspSource: CSP_SOURCE,
    nonce: 'deadbeefdeadbeefdeadbeefdeadbeef',
    ...overrides,
  };
}

function directives(csp: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of csp.split('; ')) {
    const sp = part.indexOf(' ');
    // A directive with no value (there are none today) still gets a key.
    map.set(sp === -1 ? part : part.slice(0, sp), sp === -1 ? '' : part.slice(sp + 1));
  }
  return map;
}

describe('buildCsp', () => {
  it("denies everything by default, so a directive nobody wrote can't be exploited", () => {
    // `default-src 'none'` is what makes the rest of the policy an allowlist. If
    // it were absent (or 'self'), any resource kind not named below — a fetch to
    // an attacker's host, an <object>, a websocket — would be permitted.
    expect(directives(buildCsp(CSP_SOURCE, 'n1')).get('default-src')).toBe(`'none'`);
  });

  it('admits scripts by nonce ONLY, never by origin alone or inline', () => {
    // The nonce is regenerated per render, so a <script> injected into a cell
    // value cannot carry a valid one. Admitting 'unsafe-inline' or 'unsafe-eval'
    // here would defeat that entirely.
    const scriptSrc = directives(buildCsp(CSP_SOURCE, 'n1')).get('script-src')!;
    expect(scriptSrc).toContain(`'nonce-n1'`);
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('carries the nonce into script-src verbatim', () => {
    // A mismatch between this nonce and the <script nonce> attribute means the
    // entry bundle silently never runs and the view renders blank.
    expect(buildCsp(CSP_SOURCE, 'abc123')).toContain(`script-src 'nonce-abc123'`);
  });

  it("allows inline styles, which Lit's adopted stylesheets require", () => {
    // The webview components ship their styles via Lit; without 'unsafe-inline'
    // in style-src every table renders unstyled. This is the one deliberate
    // relaxation, and it is scoped to styles only.
    expect(directives(buildCsp(CSP_SOURCE, 'n1')).get('style-src')).toBe(`${CSP_SOURCE} 'unsafe-inline'`);
  });

  it('restricts every resource kind to the extension origin (plus data: images, blob: workers)', () => {
    // dex-icon inlines some icons as data: URIs, and the parser runs off-thread
    // from a blob: worker. Nothing else may load from anywhere else.
    const d = directives(buildCsp(CSP_SOURCE, 'n1'));
    expect(d.get('img-src')).toBe(`${CSP_SOURCE} data:`);
    expect(d.get('font-src')).toBe(CSP_SOURCE);
    expect(d.get('worker-src')).toBe(`${CSP_SOURCE} blob:`);
  });

  it('names no origin other than the webview cspSource', () => {
    // A hardcoded CDN or http: origin here would be a remote-code path that no
    // amount of care in the components could close.
    const csp = buildCsp(CSP_SOURCE, 'n1');
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp.replace(new RegExp(CSP_SOURCE, 'g'), '')).not.toContain('://');
  });

  it('emits exactly the six directives the views need', () => {
    // Pinned as a set so a future edit that drops one (silently widening the
    // policy back to default-src) fails here rather than in review.
    expect([...directives(buildCsp(CSP_SOURCE, 'n1')).keys()]).toEqual([
      'default-src',
      'img-src',
      'font-src',
      'style-src',
      'script-src',
      'worker-src',
    ]);
  });
});

describe('renderShell', () => {
  it('links the shared stylesheet and the entry script it was given', () => {
    const html = renderShell(uris(), { title: 'Data Explorer', body: '<dex-tree-table></dex-tree-table>' });
    expect(html).toContain(`<link rel="stylesheet" href="${uris().styleUri}" />`);
    expect(html).toContain(`src="${uris().scriptUri}"`);
  });

  it('tags the entry script with the same nonce the CSP admits', () => {
    // These two must agree or the bundle is blocked and the view stays empty.
    // Reading the nonce back out of both places is the only assertion that
    // actually proves they were not wired from different sources.
    const html = renderShell(uris({ nonce: 'n0deadbe' }), { title: 'T', body: '' });
    expect(html).toMatch(/script-src 'nonce-n0deadbe'/);
    expect(html).toMatch(/<script type="module" nonce="n0deadbe"/);
  });

  it('appends a trailing slash to <base href> so relative icon paths resolve', () => {
    // dex-icon renders `./icons/x.svg`. Without the trailing slash the browser
    // resolves that against the PARENT of dist/webview and every icon 404s.
    const html = renderShell(uris({ baseUri: 'https://host/ext/dist/webview' }), { title: 'T', body: '' });
    expect(html).toContain('<base href="https://host/ext/dist/webview/" />');
  });

  it('loads the entry as a module (the bundles use import/export)', () => {
    expect(renderShell(uris(), { title: 'T', body: '' })).toContain('type="module"');
  });

  it('places the body markup inside <body>, before the script tag', () => {
    // The entry script upgrades the custom elements the body declares, so the
    // markup has to already be in the document when it runs.
    const html = renderShell(uris(), { title: 'T', body: '<dex-tree-table></dex-tree-table>' });
    expect(html.indexOf('<dex-tree-table>')).toBeGreaterThan(html.indexOf('<body>'));
    expect(html.indexOf('<dex-tree-table>')).toBeLessThan(html.indexOf('<script'));
  });

  it('is a complete, standalone HTML document', () => {
    const html = renderShell(uris(), { title: 'T', body: '' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('interpolates title and body without escaping — both are trusted callers', () => {
    // PRECONDITION, pinned deliberately: every call site passes a HARDCODED
    // title ('Data Explorer' / 'Properties') and a hardcoded body template. No
    // file content reaches either. This test documents that contract; if a
    // future caller ever forwards a model-derived string here, it becomes an
    // injection and this test is the place that says so.
    const html = renderShell(uris(), { title: 'a<b', body: '<x-y></x-y>' });
    expect(html).toContain('<title>a<b</title>');
    expect(html).toContain('<x-y></x-y>');
  });
});
