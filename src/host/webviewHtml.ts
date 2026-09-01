// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { getNonce } from './nonce.js';
import { renderShell } from './webviewShell.js';

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
// This function is only the vscode Uri resolution; the shell markup and the CSP
// itself live in webviewShell.ts so they can be unit-tested without a live
// vscode. See that file for why each CSP directive is what it is.
export function renderWebviewHtml(
  webview: vscode.Webview,
  distRoot: vscode.Uri,
  options: { scriptFile: string; title: string; body: string },
): string {
  return renderShell(
    {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(distRoot, options.scriptFile)).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(distRoot, 'assets', 'property.css')).toString(),
      baseUri: webview.asWebviewUri(distRoot).toString(),
      cspSource: webview.cspSource,
      nonce: getNonce(),
    },
    options,
  );
}
