// Copyright 2026 The MathWorks, Inc.
import '../dex/styles/global.css';
import './vscode-theme.css';
import '../dex/components/dex-property-inspector.js';
import type { HostToPropsMessage } from '../common/protocol.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const pi = document.querySelector('dex-property-inspector') as any;
const empty = document.getElementById('dex-empty');

function setEmpty(show: boolean): void {
  if (empty) empty.style.display = show ? 'block' : 'none';
  if (pi) (pi as HTMLElement).style.display = show ? 'none' : 'block';
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToPropsMessage;
  if (msg.type === 'showProps') {
    const groups = msg.groups ?? [];
    pi.groups = groups;
    setEmpty(groups.length === 0);
  } else if (msg.type === 'empty') {
    setEmpty(true);
  }
});

setEmpty(true);
vscode.postMessage({ type: 'ready' });
