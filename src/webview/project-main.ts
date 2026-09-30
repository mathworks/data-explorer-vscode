// Copyright 2026 The MathWorks, Inc.
//
// The project main page's webview entry: the DOM, the events, and the postMessage
// boundary. Everything about WHAT the page says is in projectPage.ts, which is pure
// and unit-tested; this file is the part that needs a document.
//
// No dex components and no component stylesheet import: the page has no <dex-*>
// element on it, so it borrows nothing from the table's widget library. Its own
// styles are injected from projectPageStyle.ts — see the header there for why that
// is a string and not a `.css` file.

import { renderProjectPage, newSectionState } from './projectPage.js';
import type { PageState, ProjectPagePayload } from './projectPage.js';
import { PROJECT_PAGE_CSS } from './projectPageStyle.js';
import type { HostToProjectMessage, OpenFileMessage } from '../common/protocol.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const style = document.createElement('style');
style.textContent = PROJECT_PAGE_CSS;
document.head.appendChild(style);

// Both elements are created here rather than declared in a shell, so the host's
// shell and vite's dev shell (project.html) can both be empty and there is no hand
// copy to drift — the split that test/webviewOverlays.test.ts exists to catch for
// the table's banner strip.
const error = document.createElement('div');
error.id = 'dex-error';
error.setAttribute('role', 'alert');
error.style.cssText =
  'display:none;color:var(--vscode-errorForeground,#f14c4c);padding:8px;' +
  'font-family:var(--vscode-font-family,sans-serif);';
document.body.appendChild(error);

const page = document.createElement('div');
page.className = 'dex-page';
document.body.appendChild(page);

/**
 * Per-section filter and expansion state, held OUTSIDE the payload.
 *
 * It survives a repaint on purpose: the page repaints when the store changes on
 * disk, and a user who has narrowed the Project Path to `slprj` while working is not
 * asking for that to be undone because something saved. Reset only when a different
 * project arrives in this panel.
 */
let state: PageState = {};
let payload: ProjectPagePayload | null = null;
let shownRoot: string | null = null;

function repaint(): void {
  if (!payload) {
    return;
  }
  page.innerHTML = renderProjectPage(payload, state);
}

function sectionState(id: string) {
  return (state[id] ??= newSectionState());
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToProjectMessage;
  if (msg.type === 'setProject') {
    if (shownRoot !== null && shownRoot !== msg.root) {
      state = {};
    }
    shownRoot = msg.root;
    payload = { page: msg.page, root: msg.root, warnings: msg.warnings, msp: msg.msp };
    error.style.display = 'none';
    repaint();
  } else if (msg.type === 'error') {
    error.textContent = msg.message;
    error.style.display = 'block';
  }
});

// Delegated, because every row is thrown away and rebuilt on each repaint — a
// listener per link would have to be re-attached each time, and one of those
// re-attachments is the one that gets forgotten.
page.addEventListener('input', (event: Event) => {
  const input = event.target as HTMLInputElement | null;
  if (!input || !input.classList?.contains('filter')) {
    return;
  }
  const id = input.dataset.section;
  if (!id) {
    return;
  }
  // The caret, not just the focus: a repaint replaces the input element itself, and
  // restoring focus alone sends the caret to wherever the browser decides — which
  // put it at position 0, so editing the middle of a query typed backwards.
  const caret = input.selectionStart;
  const caretEnd = input.selectionEnd;
  sectionState(id).query = input.value;
  repaint();
  const again = page.querySelector<HTMLInputElement>(`input.filter[data-section="${id}"]`);
  if (again) {
    again.focus();
    if (caret !== null) {
      again.setSelectionRange(caret, caretEnd ?? caret);
    }
  }
});

/**
 * What a click on a link asks the host for.
 *
 * `preferProject` is present only where the markup asked for it (a component row), and
 * absent — not `false` — everywhere else, so every link that existed before this posts
 * byte-identically to what it posted before.
 */
function openMessage(el: HTMLElement): OpenFileMessage {
  const msg: OpenFileMessage = { type: 'openFile', path: el.dataset.open as string };
  if (el.dataset.prj !== undefined) {
    msg.preferProject = true;
  }
  return msg;
}

page.addEventListener('click', (event: Event) => {
  const target = event.target as HTMLElement | null;
  // `closest`, not the target itself: a link's text is wrapped in <mark> spans as
  // soon as a filter matches inside it, and a click landing on the highlighted part
  // of a path has that <mark> as its target.
  const open = target?.closest?.('[data-open]') as HTMLElement | null;
  if (open) {
    vscode.postMessage(openMessage(open));
    return;
  }
  const expand = (target?.closest?.('[data-expand]') as HTMLElement | null)?.dataset.expand;
  if (expand) {
    sectionState(expand).expanded = true;
    repaint();
  }
});

// The links are <a> without href — a real href would navigate the webview away from
// itself — so the browser gives them neither keyboard activation nor a default
// tabstop. `role="button"` and `tabindex="0"` in the markup supply the latter; this
// supplies the former, on both keys a button answers to.
page.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const open = (event.target as HTMLElement | null)?.closest?.('[data-open]') as HTMLElement | null;
  if (!open) {
    return;
  }
  // Space scrolls the page by default, which is exactly what a user pressing it on a
  // focused control does not mean.
  event.preventDefault();
  vscode.postMessage(openMessage(open));
});

vscode.postMessage({ type: 'ready' });
