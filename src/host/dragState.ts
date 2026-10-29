// Copyright 2026 The MathWorks, Inc.
//
// The drag register: a single module-level record of the rows currently being
// dragged, mirroring the clipboard singleton (clipboard.ts). It exists because
// HTML5 dataTransfer does not reliably survive the webview iframe boundary — so
// on drag start the host snapshots the dragged entries here, and on drop the
// target webview asks the host to complete the drop, which reads the payloads
// back from this register. Between the two, the host broadcasts a lightweight
// DESCRIPTOR (source document + per-item section/class/kind, NOT the payloads) to
// every webview so each can predict the drop live (dropDecision) on dragover.

import type { DropFacts } from 'data-explorer-view/model/actions/dropFacts.js';

// One dragged entry: its serialized payload (for the eventual paste), the section
// it was dragged FROM, and the display facts the webview needs to render feedback
// without a model.
//
// The section is per item, as on a ClipboardItem, because a multi-row drag can span
// sections. It used to be one value for the whole drag, the last row's, so a drag of
// design and arch rows onto arch was refused as a same-section no-op while the same
// cut and paste worked.
export interface DragRegisterItem extends DropFacts {
  payload: Record<string, unknown>;
  sourceSection: string;
  /** Its document's token for the entry as it was taken, for that document's deleter (transfer.ts). */
  origin?: object;
}

interface DragEntry {
  sourceDocUri: string;
  items: DragRegisterItem[];
}

// The lightweight descriptor broadcast to webviews. It is dropDecision's DragSource
// shape, so the webview hands it over as it is, and it deliberately OMITS the
// payloads (they can be large and the webview never needs them — the drop is
// completed host-side).
export interface DragDescriptor {
  docUri: string;
  items: (DropFacts & { sectionName: string })[];
}

let current: DragEntry | null = null;

export function setDrag(sourceDocUri: string, items: DragRegisterItem[]): void {
  current = { sourceDocUri, items };
}

export function getDrag(): DragEntry | null {
  return current;
}

export function clearDrag(): void {
  current = null;
}

/** The payload-free descriptor posted to every webview for live drag feedback. */
export function dragDescriptor(): DragDescriptor | null {
  if (!current) return null;
  return {
    docUri: current.sourceDocUri,
    items: current.items.map((it) => ({
      sectionName: it.sourceSection,
      className: it.className,
      arrayClass: it.arrayClass,
      kind: it.kind,
      isMatlabVariable: it.isMatlabVariable,
      isScalarNumeric: it.isScalarNumeric,
      ...(it.sharedName ? { sharedName: true } : {}),
    })),
  };
}
