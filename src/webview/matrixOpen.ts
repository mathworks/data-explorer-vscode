// Copyright 2026 The MathWorks, Inc.
//
// The single piece of wiring between the glyph and the editor. Both webview
// mains (table-main.ts, pi-main.ts) call this rather than each adding its own
// listener, so the two surfaces cannot end up with different open/close rules.
import type { MatrixOpenDetail } from './components/dex-matrix-open.js';

// Structural, not nominal: keeps this module free of a hard dependency on the
// component class, so the mains can pass the `document.querySelector` result
// they already hold as `any`.
export interface MatrixEditorLike {
  show(anchorEl: HTMLElement, matrix: MatrixOpenDetail['matrix']): void;
  close(): void;
}

export interface MatrixOpenHandle {
  // Called from the message handlers: rows or properties were replaced, so an
  // open grid now describes data that may no longer be on screen.
  close(): void;
  dispose(): void;
}

export function installMatrixOpen(source: EventTarget, editor: MatrixEditorLike): MatrixOpenHandle {
  const onOpen = (e: Event) => {
    const detail = (e as CustomEvent<Partial<MatrixOpenDetail>>).detail;
    if (!detail?.matrix || !detail.anchorEl) {
      return;
    }
    editor.show(detail.anchorEl, detail.matrix);
  };
  source.addEventListener('dex-matrix-open', onOpen);
  return {
    close: () => editor.close(),
    dispose: () => source.removeEventListener('dex-matrix-open', onOpen),
  };
}
