// Copyright 2026 The MathWorks, Inc.
//
// A webview's end of its channel to the host, as view's wire format takes one (TablePort): what
// it posts goes through VS Code's webview API, and what the host posts arrives as window
// `message` events.
import type { TablePort } from 'data-explorer-view/model';

export function vscodePort(api: { postMessage(message: unknown): void }): TablePort {
  return {
    postMessage: (message) => api.postMessage(message),
    onMessage: (listener) => {
      const hear = (event: MessageEvent) => listener(event.data);
      window.addEventListener('message', hear);
      return () => window.removeEventListener('message', hear);
    },
  };
}
