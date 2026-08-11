// Copyright 2026 The MathWorks, Inc.
//
// The drag register: a single module-level record of the rows currently being
// dragged, mirroring the clipboard singleton (clipboard.ts). It exists because
// HTML5 dataTransfer does not reliably survive the webview iframe boundary — so
// on drag start the host snapshots the dragged entries here, and on drop the
// target webview asks the host to complete the drop, which reads the payloads
// back from this register. Between the two, the host broadcasts a lightweight
// DESCRIPTOR (source metadata + per-item class/kind, NOT the payloads) to every
// webview so each can predict the drop live (dropDecision) on dragover.

// One dragged entry: its serialized payload (for the eventual paste) plus the
// display facts the webview needs to render feedback without a model.
export interface DragRegisterItem {
  payload: Record<string, unknown>;
  className: string;
  arrayClass: string;
  kind: string;
  isMatlabVariable: boolean;
}

interface DragEntry {
  sourceDocUri: string;
  sourceSection: string;
  sourceSectionLabel: string;
  sourceIsDerived: boolean;
  items: DragRegisterItem[];
}

// The lightweight descriptor broadcast to webviews. It mirrors dropDecision's
// DragSource shape and deliberately OMITS the payloads (they can be large and
// the webview never needs them — the drop is completed host-side).
export interface DragDescriptor {
  docUri: string;
  sectionName: string;
  sectionLabel: string;
  isDerived: boolean;
  items: Array<{ className: string; arrayClass: string; kind: string; isMatlabVariable: boolean }>;
}

let current: DragEntry | null = null;

export function setDrag(
  sourceDocUri: string,
  sourceSection: string,
  sourceSectionLabel: string,
  sourceIsDerived: boolean,
  items: DragRegisterItem[],
): void {
  current = { sourceDocUri, sourceSection, sourceSectionLabel, sourceIsDerived, items };
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
    sectionName: current.sourceSection,
    sectionLabel: current.sourceSectionLabel,
    isDerived: current.sourceIsDerived,
    items: current.items.map((it) => ({
      className: it.className,
      arrayClass: it.arrayClass,
      kind: it.kind,
      isMatlabVariable: it.isMatlabVariable,
    })),
  };
}
