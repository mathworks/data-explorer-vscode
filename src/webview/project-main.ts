// Copyright 2026 The MathWorks, Inc.
//
// The project main page's webview entry: the postMessage boundary around view's
// `<dex-project-page>`. WHAT the page says, its filters and Show all, the focus and caret
// across a repaint, and its links' keys are the element's (data-explorer-view/project-page);
// this file hands it the host's payload, shows the host's error, and turns the element's
// `dex-project-open` into the `openFile` the host has always been sent.

import {
  defineProjectPage,
  PROJECT_PAGE_CSS,
  type DexProjectPage,
  type ProjectOpenDetail,
} from 'data-explorer-view/project-page';
import type { HostToProjectMessage, OpenFileMessage } from '../common/protocol.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

// The page's stylesheet is in the element's shadow root; this copy is for the DOCUMENT, whose
// half of it (the html/body rules: this view is a document that scrolls, in the page's font and
// background) the shadow root cannot reach. The page's own rules match nothing out here.
const style = document.createElement('style');
style.textContent = PROJECT_PAGE_CSS;
document.head.appendChild(style);

// Both elements are created here rather than declared in a shell, so the host's
// shell and vite's dev shell (project.html) can both be empty and there is no hand
// copy to drift — the split that test/webviewOverlays.test.ts exists to catch for
// the table's banner strip. The error stays this host's own banner, above the page,
// in VS Code's error colour, as it always was.
const error = document.createElement('div');
error.id = 'dex-error';
error.setAttribute('role', 'alert');
error.style.cssText =
  'display:none;color:var(--vscode-errorForeground,#f14c4c);padding:8px;' +
  'font-family:var(--vscode-font-family,sans-serif);';
document.body.appendChild(error);

defineProjectPage();
const page = document.createElement('dex-project-page') as DexProjectPage;
document.body.appendChild(page);

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToProjectMessage;
  if (msg.type === 'setProject') {
    // A page of another project starts with its filters cleared; a repaint of the same one
    // (its store saved on disk) keeps them — the element decides, from `root`.
    page.payload = { page: msg.page, root: msg.root, warnings: msg.warnings, msp: msg.msp };
    error.style.display = 'none';
  } else if (msg.type === 'error') {
    error.textContent = msg.message;
    error.style.display = 'block';
  }
});

/**
 * What a followed link asks the host for.
 *
 * `preferProject` is present only where the element says so (a component row), and
 * absent — not `false` — everywhere else, so every link posts byte-identically to what it
 * posted before.
 */
function openMessage(detail: ProjectOpenDetail): OpenFileMessage {
  const msg: OpenFileMessage = { type: 'openFile', path: detail.path };
  if (detail.preferProject) {
    msg.preferProject = true;
  }
  return msg;
}

// A click, Enter or Space on a link: the element sends one event for all three.
page.addEventListener('dex-project-open', (event) => {
  vscode.postMessage(openMessage(event.detail));
});

vscode.postMessage({ type: 'ready' });
