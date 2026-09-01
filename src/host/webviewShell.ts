// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) webview shell + Content-Security-Policy assembly. Split from
// webviewHtml.ts (which resolves the vscode Uris) so the CSP is unit-testable
// without a live vscode — mirrors the nameExtract.ts ↔ nameIndex.ts and
// searchFilter.ts ↔ searchSources.ts pure-core / host-IO splits.
//
// The CSP is the webview's only sandbox: `default-src 'none'` plus one allowance
// per resource kind the table views actually load. Scripts are admitted by nonce
// ONLY, so a stray injected <script> without the per-render nonce cannot run.

/** The already-resolved, webview-safe URIs and CSP source for one render. */
export interface ShellUris {
  /** asWebviewUri of the entry script. */
  scriptUri: string;
  /** asWebviewUri of the shared assets/property.css. */
  styleUri: string;
  /** asWebviewUri of the dist/webview root, used as <base href>. */
  baseUri: string;
  /** The webview's cspSource (its vscode-resource origin). */
  cspSource: string;
  /** Per-render script nonce. */
  nonce: string;
}

export function buildCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${cspSource}`,
    `worker-src ${cspSource} blob:`,
  ].join('; ');
}

// Vite bundles every webview CSS import into one shared, unhashed asset named
// `property.css`, so every entry links the same file. dex-icon renders relative
// img src `./icons/x.svg` (vite base:'./'), so <base href> points at the
// dist/webview root; the absolute asWebviewUri script/style tags ignore <base>.
export function renderShell(uris: ShellUris, options: { title: string; body: string }): string {
  const csp = buildCsp(uris.cspSource, uris.nonce);
  return `<!doctype html>
<html lang="en">
  <head>
    <base href="${uris.baseUri}/" />
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${uris.styleUri}" />
    <title>${options.title}</title>
  </head>
  <body>
${options.body}
    <script type="module" nonce="${uris.nonce}" src="${uris.scriptUri}"></script>
  </body>
</html>`;
}
