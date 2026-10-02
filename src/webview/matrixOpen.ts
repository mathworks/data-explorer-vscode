// Copyright 2026 The MathWorks, Inc.
//
// The single piece of wiring between the glyph and the editor. Both webview
// mains (table-main.ts, pi-main.ts) call this rather than each adding its own
// listener, so the two surfaces cannot end up with different open/close rules.
//
// It owns BOTH directions of the fetch-on-open exchange:
//
//   glyph click -> editor.show(descriptor)  +  post { requestMatrix, nodeId }
//   host reply  -> editor.deliver(matrixCells)
//
// Deliberately one module. A webview that asked but never listened would open a
// panel that waits forever, and splitting the pair across the two mains is how
// that happens — the recurring defect here is one rule implemented twice.
import type { MatrixOpenDetail } from './components/dex-matrix-open.js';
import type { MatrixCellsAnswer } from './components/dex-variable-editor.js';
// Type-only, so nothing host-side enters the webview bundle — the same import the
// mains already make. It is what makes the request below a compile error if the
// host's union ever spells the message differently.
import type { RequestMatrixMessage } from '../common/protocol.js';

// Structural, not nominal: keeps this module free of a hard dependency on the
// component class, so the mains can pass the `document.querySelector` result
// they already hold as `any`.
export interface MatrixEditorLike {
  show(anchorEl: HTMLElement, matrix: MatrixOpenDetail['matrix']): void;
  deliver(answer: MatrixCellsAnswer): void | Promise<void>;
  close(): void;
}

export interface MatrixOpenHandle {
  // Called from the message handlers: rows or properties were replaced, so an
  // open grid now describes data that may no longer be on screen.
  close(): void;
  dispose(): void;
}

// `editor` is nullable on purpose. The webview shell is assembled by three
// different host providers, so an editor element can legitimately be absent —
// and the handle is called from the setRows/showProps message handlers, where an
// exception would abort the handler and leave the table EMPTY. A missing editor
// must cost the glyph, never the rows.
//
// `post` is REQUIRED, with no default, so adding a third webview cannot forget
// it: a main that compiles is a main that can fetch.
export function installMatrixOpen(
  source: EventTarget,
  editor: MatrixEditorLike | null | undefined,
  post: (message: unknown) => void,
): MatrixOpenHandle {
  if (!editor) {
    return { close: () => {}, dispose: () => {} };
  }
  const onOpen = (e: Event) => {
    const detail = (e as CustomEvent<Partial<MatrixOpenDetail>>).detail;
    if (!detail?.matrix || !detail.anchorEl) {
      return;
    }
    // No node id means nothing to fetch with, and a panel that can never be
    // answered is worse than no panel: it would wait forever with a title.
    const nodeId = detail.matrix.nodeId;
    if (typeof nodeId !== 'string' || nodeId === '') {
      return;
    }
    editor.show(detail.anchorEl, detail.matrix);
    const request: RequestMatrixMessage = { type: 'requestMatrix', nodeId };
    post(request);
  };
  const onMessage = (e: MessageEvent) => {
    const data = e.data as MatrixCellsAnswer & { type?: string };
    // This listener sees every message the webview gets — setRows, showProps, all
    // of them. Only ours, and only the editor's own staleness check decides the
    // rest (it holds the descriptor; this module does not).
    if (data?.type !== 'matrixCells') {
      return;
    }
    void editor.deliver(data);
  };
  source.addEventListener('dex-matrix-open', onOpen);
  window.addEventListener('message', onMessage);
  return {
    close: () => editor.close(),
    dispose: () => {
      source.removeEventListener('dex-matrix-open', onOpen);
      window.removeEventListener('message', onMessage);
    },
  };
}
