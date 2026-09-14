// Copyright 2026 The MathWorks, Inc.
import './components/styles/global.css';
import './vscode-theme.css';
import './components/dex-property-inspector.js';
import './components/dex-variable-editor.js';
import { installMatrixOpen } from './matrixOpen.js';
import type { HostToPropsMessage } from '../common/protocol.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const pi = document.querySelector('dex-property-inspector') as any;
const empty = document.getElementById('dex-empty');

// The Variable Editor: the same overlay, opened by the same glyph, as the table's
// Value cell. Created here rather than declared in markup for the reason
// test/webviewOverlays.test.ts records — the shipped shell is a string built by
// PropertiesViewProvider, so a tag required in pi.html would only reach vite's dev
// entry. The inspector is the event source because the glyph is in its shadow tree.
const variableEditor = document.createElement('dex-variable-editor');
document.body.appendChild(variableEditor);
const matrixOpen = installMatrixOpen(pi, variableEditor as any);

function setEmpty(show: boolean): void {
  if (empty) empty.style.display = show ? 'block' : 'none';
  if (pi) (pi as HTMLElement).style.display = show ? 'none' : 'block';
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToPropsMessage;
  // Either message replaces every row an open grid was anchored to, so it closes
  // first. Same rule as the table's setRows.
  matrixOpen.close();
  if (msg.type === 'showProps') {
    const groups = msg.groups ?? [];
    pi.groups = groups;
    setEmpty(groups.length === 0);
  } else if (msg.type === 'empty') {
    setEmpty(true);
  }
});

// A cross-reference in the inspector was clicked. This webview has no rows to select in —
// the target is a row in a TABLE, which is a different webview — so the host resolves it,
// exactly as it does for a cross-tab Usage link (host/navigate.ts).
//
// Until now nothing listened for this event, so the inspector's link path was inert. It was
// invisible because it was also unreachable: its only trigger was a `type: 'link'` row,
// which needs a `link` field nothing in core sets.
pi?.addEventListener('dex-pi-navigate', (e: Event) => {
  const target = (e as CustomEvent).detail?.sourceId;
  if (typeof target === 'string' && target !== '') vscode.postMessage({ type: 'navigate', target });
});

setEmpty(true);
vscode.postMessage({ type: 'ready' });
