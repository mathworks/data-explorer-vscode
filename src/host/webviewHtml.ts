// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { getNonce } from './nonce.js';

// Shared loading overlay for the three table views (table.js). Starts hidden:
// the webview only reveals it if the first payload hasn't arrived after a short
// delay (see table-main.ts), so a fast open never flashes a spinner. The webview
// renderer runs this timer independently of the extension host's synchronous
// parse, so the delay is honored even while the host is busy. `hideLoading()`
// hides it again on the first setRows/error.
export const LOADING_OVERLAY_HTML = `    <style>@keyframes dex-spin { to { transform: rotate(360deg); } }</style>
    <div id="dex-loading" role="status" aria-label="Loading" style="display:none;position:absolute;inset:0;z-index:3;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:var(--vscode-font-family,sans-serif);font-size:12px;color:var(--vscode-descriptionForeground,var(--vscode-foreground));background:var(--vscode-editor-background,transparent);">
      <div style="width:28px;height:28px;border:3px solid var(--vscode-progressBar-background,#0e70c0);border-top-color:transparent;border-radius:50%;animation:dex-spin 0.8s linear infinite;"></div>
      <div>Loading…</div>
    </div>`;

// Shared webview-shell builder for all three providers (table editor, binary
// editor, Property Inspector). They differ only in the entry script, the
// document <title>, and the <body> markup; the CSP, <base href>, nonce, and the
// single shared `assets/property.css` stylesheet are identical.
//
// Vite bundles every webview CSS import into one shared, unhashed asset named
// `property.css`, so every entry links the same file. dex-icon renders relative
// img src `./icons/x.svg` (vite base:'./'), so <base href> points at the
// dist/webview root; the absolute asWebviewUri script/style tags ignore <base>.
export function renderWebviewHtml(
  webview: vscode.Webview,
  distRoot: vscode.Uri,
  options: { scriptFile: string; title: string; body: string },
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, options.scriptFile));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, 'assets', 'property.css'));
  const baseUri = webview.asWebviewUri(distRoot).toString();
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `worker-src ${webview.cspSource} blob:`,
  ].join('; ');

  return `<!doctype html>
<html lang="en">
  <head>
    <base href="${baseUri}/" />
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>${options.title}</title>
  </head>
  <body>
${options.body}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
