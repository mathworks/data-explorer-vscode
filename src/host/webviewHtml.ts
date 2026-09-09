// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { getNonce } from './nonce.js';
import { renderShell } from './webviewShell.js';
import { SHARED_STYLESHEET } from '../common/webviewAssets.js';

// There is deliberately NO loading overlay here. The wait for the first payload is
// drawn by <dex-tree-table> itself (`loading` property → .loading-state), in the
// region the table will occupy. As shell markup it was an overlay at inset:0 over
// the whole panel, so it covered the search bar the table had already painted: the
// bar showed, disappeared under the overlay, then came back with the rows. It was
// also missing from src/webview/table.html, the vite dev shell, where the lookup
// silently found nothing — one rule over four shells, which is what
// test/webviewOverlays.test.ts is about.

// Shared banner strip for the three table views: the persistent read-only notice
// (#dex-notice) and the parse-warning banner (#dex-warning), stacked above the
// table in one absolutely-positioned container so table-main.ts can offset the
// full-bleed table by ONE measured height however many banners are showing.
//
// Shared because the notice used to exist in the read-only provider's markup
// alone. table-main.ts is one module running inside four shells, so an element it
// looks up that only some shells declare is the split webviewOverlays.test.ts was
// written about — and warnings are meaningful in every view, not just that one.
// (src/webview/table.html, the vite dev shell, is a fourth copy that cannot
// interpolate this constant; the test scans all four for agreement.)
//
// Both start hidden and are revealed only by a payload that carries them, so a
// clean file shows nothing and the table keeps the whole panel. The container
// scrolls rather than growing without bound: a `.mat` whose record chain broke can
// report a warning per variable, and a banner taller than the table hides the very
// rows it is describing.
export const BANNERS_HTML = `    <div id="dex-banners" style="position:absolute;top:0;left:0;right:0;z-index:2;max-height:40%;overflow:auto;font-family:var(--vscode-font-family,sans-serif);font-size:12px;">
      <div id="dex-notice" role="status" style="display:none;box-sizing:border-box;padding:6px 10px;color:var(--vscode-inputValidation-infoForeground,var(--vscode-foreground));background:var(--vscode-inputValidation-infoBackground,rgba(100,148,237,0.12));border-bottom:1px solid var(--vscode-inputValidation-infoBorder,#4084d0);"></div>
      <div id="dex-warning" role="status" style="display:none;box-sizing:border-box;padding:6px 10px;color:var(--vscode-inputValidation-warningForeground,var(--vscode-foreground));background:var(--vscode-inputValidation-warningBackground,rgba(255,190,60,0.12));border-bottom:1px solid var(--vscode-inputValidation-warningBorder,#b89500);">
        <div id="dex-warning-headline" style="font-weight:600;"></div>
        <ul id="dex-warning-details" style="margin:4px 0 0;padding-inline-start:18px;"></ul>
      </div>
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
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(distRoot, 'assets', SHARED_STYLESHEET))
        .toString(),
      baseUri: webview.asWebviewUri(distRoot).toString(),
      cspSource: webview.cspSource,
      nonce: getNonce(),
    },
    options,
  );
}
