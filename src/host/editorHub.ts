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
import type { EntrySelector } from 'data-explorer-core';

/** What a cross-document move asks the source document to remove. */
export type DeleteTarget = string | EntrySelector;

// Live table webviews → their repaint callback. A repaint (not just a state
// post) is needed because a lazy cut makes no document edit, yet its source row
// must gain/lose the dimmed affordance, so the owning view must repaint.
const liveWebviews = new Map<vscode.Webview, () => void>();

// Each open editable document registers how to delete named entries from ITSELF,
// in its own format. Present for every view that can be a drag source (the source
// view is always open during a drag), so a cross-document move never has to guess.
const sourceDeleters = new Map<string, (targets: DeleteTarget[]) => Promise<void> | void>();

export function registerWebview(wv: vscode.Webview, repaint: () => void): void {
  liveWebviews.set(wv, repaint);
}

export function unregisterWebview(wv: vscode.Webview): void {
  liveWebviews.delete(wv);
}

// Every open EDITABLE table view → how to open its Add gallery. Keyed by the panel
// rather than the webview because the key is also the question a keybinding asks:
// `panel.active` is VS Code's own answer to which view the user is looking at, so
// the command needs nothing cached and cannot go stale. The read-only .slx/.mat view
// registers nothing, which is what makes `Add an Entry` a no-op there instead of an
// error.
const addGalleryViews = new Map<vscode.WebviewPanel, () => void>();

export function registerAddGalleryView(panel: vscode.WebviewPanel, open: () => void): void {
  addGalleryViews.set(panel, open);
}

export function unregisterAddGalleryView(panel: vscode.WebviewPanel): void {
  addGalleryViews.delete(panel);
}

/**
 * Open the Add gallery in whichever table view has focus, and say whether one did.
 *
 * At most one panel is `active` at a time, so this opens one gallery or none. None is
 * the ordinary outcome, not a failure: the keybinding is `when`-scoped to the editable
 * views, but the Command Palette offers no such guarantee, and a command that is merely
 * unavailable should do nothing rather than complain.
 */
export function openAddGalleryInActiveView(): boolean {
  for (const [panel, open] of addGalleryViews) {
    if (!panel.active) continue;
    open();
    return true;
  }
  return false;
}

export function registerSourceDeleter(
  uriString: string,
  fn: (targets: DeleteTarget[]) => Promise<void> | void,
): void {
  sourceDeleters.set(uriString, fn);
}

export function unregisterSourceDeleter(uriString: string): void {
  sourceDeleters.delete(uriString);
}

// Broadcast the clipboard state (+ repaint) to every live webview across both
// providers, so a cut/copy in any .sldd enables Paste and shows the affordance
// in every other open .sldd — including across the JSON/binary format boundary.
//
// The repaint exists for the LAZY CUT, which makes no document edit at all and so
// has nothing else to bring the dimmed affordance onto its source row. Both
// providers register a repaint scoped to the at most two entries a clipboard mark
// can move between, so this fan-out costs a table nothing when the mark it holds
// did not change (see repaintClipMark).
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
export async function deleteFromSource(uriString: string, targets: DeleteTarget[]): Promise<void> {
  const fn = sourceDeleters.get(uriString);
  if (fn) await fn(targets);
}
