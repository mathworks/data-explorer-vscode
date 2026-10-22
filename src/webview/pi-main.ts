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
const matrixOpen = installMatrixOpen(pi, variableEditor as any, (m) => vscode.postMessage(m));

function setEmpty(show: boolean): void {
  if (empty) empty.style.display = show ? 'block' : 'none';
  if (pi) (pi as HTMLElement).style.display = show ? 'none' : 'block';
}

// The node the panel shows, as the last showProps named it: what an edit made here is of.
let shownNodeId: string | null = null;

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToPropsMessage;
  // `showProps` and `empty` each replace every row an open grid was anchored to, so
  // each closes it first. Same rule as the table's setRows, and per branch for the
  // same reason: `matrixCells` reaches this listener too, as the answer to the open
  // panel's own request, and a close ahead of the branches closed the panel it was
  // sent to fill. That message is installMatrixOpen's, so it has no branch here.
  if (msg.type === 'showProps') {
    matrixOpen.close();
    const groups = msg.groups ?? [];
    shownNodeId = typeof msg.nodeId === 'string' ? msg.nodeId : null;
    pi.refusal = null;
    pi.groups = groups;
    setEmpty(groups.length === 0);
  } else if (msg.type === 'empty') {
    matrixOpen.close();
    shownNodeId = null;
    pi.refusal = null;
    setEmpty(true);
  } else if (msg.type === 'propertyRefused') {
    pi.refusal = typeof msg.reason === 'string' ? msg.reason : null;
  }
});

// An edit committed in an editable row (the host made rows editable only where it takes them):
// sent with the node it is of, which the host holds to the node it is showing.
pi?.addEventListener('dex-property-changed', (e: Event) => {
  const detail = (e as CustomEvent).detail ?? {};
  if (!shownNodeId || typeof detail.propName !== 'string') return;
  vscode.postMessage({ type: 'editProperty', nodeId: shownNodeId, propName: detail.propName, newValue: String(detail.newValue ?? ''), oldValue: String(detail.oldValue ?? '') });
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
