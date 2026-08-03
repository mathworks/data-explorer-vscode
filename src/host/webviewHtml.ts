// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { getNonce } from './nonce.js';

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
