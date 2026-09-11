// Copyright 2026 The MathWorks, Inc.

// A single module-level clipboard shared across the extension, mirroring how
// data explorer uses one ClipboardService, and mirroring the drag register
// (dragState.ts) in shape: N items, each a structural snapshot of a serialized node
// ({name, metadata, value}) captured at copy/cut time — independent of the live
// model, so later mutations don't alias it.
//
// It holds MANY items because a copy acts on every entry the selection resolves to
// (webview/operands.ts). Each item records its OWN source section: those entries may
// span sections, and a cut is LAZY — the source deletion is deferred to paste time, so
// each item has to say where it must be deleted FROM. One shared section would delete
// the wrong entry, or none.
//
// It stays a register distinct from the drag register and from the plain-text view's
// copy: three independent stores, by design.
import type { DropFacts } from './dropFacts.js';

export type ClipboardMode = 'cut' | 'copy';

/** One copied/cut entry: what to paste, where it came from, and what it looks like. */
export interface ClipboardItem extends DropFacts {
  payload: Record<string, unknown>;
  sourceSection: string;
}

interface ClipboardEntry {
  items: ClipboardItem[];
  mode: ClipboardMode;
  // The document the entries were cut/copied from. A lazy cut defers the source
  // delete until paste, so it must remember WHICH document to delete from —
  // the paste may land in a different .sldd tab (a cross-document move).
  sourceDocUri?: string;
}

let current: ClipboardEntry | null = null;

/**
 * Replace the clipboard with `items`.
 *
 * An empty list clears it rather than storing an empty register: a copy that resolved
 * no entries would otherwise leave Paste enabled with nothing behind it.
 */
export function setClipboard(
  items: ClipboardItem[],
  mode: ClipboardMode,
  sourceDocUri?: string,
): void {
  current = items.length ? { items, mode, sourceDocUri } : null;
}

export function getClipboard(): ClipboardEntry | null {
  return current;
}

export function clearClipboard(): void {
  current = null;
}

export function canPaste(): boolean {
  return current !== null;
}

/**
 * Public state posted to the webview so it can build the menu synchronously.
 *
 * `items` is the payload-FREE strip, exactly as `dragDescriptor()` strips the drag
 * register: the webview needs the drop facts to predict whether a paste may land here
 * (dropDecision), and must never be shipped the entry records.
 */
export function clipboardState(): {
  canPaste: boolean;
  mode: ClipboardMode | null;
  items: DropFacts[];
} {
  return {
    canPaste: current !== null,
    mode: current ? current.mode : null,
    items: (current?.items ?? []).map(({ className, arrayClass, kind, isMatlabVariable, isScalarNumeric }) => ({
      className,
      arrayClass,
      kind,
      isMatlabVariable,
      isScalarNumeric,
    })),
  };
}
