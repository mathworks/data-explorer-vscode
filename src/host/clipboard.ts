// Copyright 2026 The MathWorks, Inc.

// A single module-level clipboard shared across the extension, mirroring how
// data explorer uses one ClipboardService. The payload is a structural
// snapshot of a serialized node ({name, metadata, value}) captured at copy/cut
// time — independent of the live model, so later mutations don't alias it.

export type ClipboardMode = 'cut' | 'copy';

interface ClipboardEntry {
  payload: Record<string, unknown>;
  mode: ClipboardMode;
  sourceSection: string;
}

let current: ClipboardEntry | null = null;

export function setClipboard(payload: Record<string, unknown>, mode: ClipboardMode, sourceSection: string): void {
  current = { payload, mode, sourceSection };
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

/** Public state posted to the webview so it can build the menu synchronously. */
export function clipboardState(): { canPaste: boolean; mode: ClipboardMode | null } {
  return { canPaste: current !== null, mode: current ? current.mode : null };
}
