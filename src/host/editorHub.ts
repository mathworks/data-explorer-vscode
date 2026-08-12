// Copyright 2026 The MathWorks, Inc.
//
// Cross-provider hub shared by the JSON (SlddTextEditorProvider) and compressed-
// binary (BinarySlddEditorProvider) table editors. Both back the SAME table
// webview and the SAME module-level clipboard + drag register, so drag-and-drop
// and clipboard state must flow across BOTH providers uniformly:
//
//   • Every live table webview (JSON or binary) is registered here so a copy/cut
//     or an in-flight drag in one view broadcasts its state to ALL views — that
//     is what lets a drag started in a JSON .sldd predict its drop live in a
//     binary .sldd and vice versa (the descriptor must reach the target webview
//     or its drop predictor falls back to a misleading permissive "accept drop").
//
//   • A cross-document MOVE must delete the originals from the SOURCE document.
//     The source may be a JSON .sldd (delete via a TextDocument WorkspaceEdit) or
//     a binary .sldd (delete via an in-memory chunkXml edit + re-zip). Each open
//     editor registers a format-appropriate deleter here, keyed by its URI, so
//     the drop handler completes the source-delete without knowing the format.
import * as vscode from 'vscode';
import { clipboardState } from './clipboard.js';
import { dragDescriptor } from './dragState.js';

// Live table webviews → their repaint callback. A repaint (not just a state
// post) is needed because a lazy cut makes no document edit, yet its source row
// must gain/lose the dimmed affordance, so the owning view must repaint.
const liveWebviews = new Map<vscode.Webview, () => void>();

// Each open editable document registers how to delete named entries from ITSELF,
// in its own format. Present for every view that can be a drag source (the source
// view is always open during a drag), so a cross-document move never has to guess.
const sourceDeleters = new Map<string, (names: string[]) => Promise<void> | void>();

export function registerWebview(wv: vscode.Webview, repaint: () => void): void {
  liveWebviews.set(wv, repaint);
}

export function unregisterWebview(wv: vscode.Webview): void {
  liveWebviews.delete(wv);
}

export function registerSourceDeleter(uriString: string, fn: (names: string[]) => Promise<void> | void): void {
  sourceDeleters.set(uriString, fn);
}

export function unregisterSourceDeleter(uriString: string): void {
  sourceDeleters.delete(uriString);
}

// Broadcast the clipboard state (+ repaint) to every live webview across both
// providers, so a cut/copy in any .sldd enables Paste and shows the affordance
// in every other open .sldd — including across the JSON/binary format boundary.
export function broadcastClipboardState(): void {
  for (const [wv, repaint] of liveWebviews) {
    wv.postMessage({ type: 'clipboardState', ...clipboardState() });
    repaint();
  }
}

// Broadcast the current drag descriptor (or null when the drag ends) to every
// live webview. Because HTML5 dataTransfer does not survive the webview iframe
// boundary, the dragged rows live in the host drag register; each webview learns
// of the in-flight drag through this descriptor and predicts the drop locally.
export function broadcastDragState(): void {
  const descriptor = dragDescriptor();
  for (const wv of liveWebviews.keys()) {
    wv.postMessage({ type: 'dragState', descriptor });
  }
}

// Complete the source-delete half of a cross-document move. The source editor is
// open (it is where the drag started), so a format-appropriate deleter is
// registered; dispatch to it. If none is registered (defensive — should not
// happen during a live drag), the move's source is left intact rather than
// risking a wrong-format edit on the file.
export async function deleteFromSource(uriString: string, names: string[]): Promise<void> {
  const fn = sourceDeleters.get(uriString);
  if (fn) await fn(names);
}
