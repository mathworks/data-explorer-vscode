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
import type { SourceDeleteResult } from './transfer.js';

export type { SourceDeleteResult };

/** What a cross-document move asks the source document to remove. */
export type DeleteTarget = string | EntrySelector;

/**
 * How one open document removes named entries from ITSELF, in its own format.
 *
 * It answers rather than reports. A deleter runs on behalf of ANOTHER document's paste or drop,
 * so the view it would post to is not the one the user is looking at — it may be a background
 * tab, or a panel already disposed, whose postMessage throws. The transfer that asked
 * (transfer.ts) reports the answer on its own view, which is the one where the gesture happened.
 */
export type SourceDeleter = (targets: DeleteTarget[]) => Promise<SourceDeleteResult> | SourceDeleteResult;

/**
 * A deleter's reason when nothing in its document answers to the names it was given any more:
 * renamed or deleted since the cut. One spelling for every format, because it is one fact.
 */
export const NOT_FOUND_REASON = 'nothing in it answers to that name any more';

// Live table webviews → their repaint callback. A repaint (not just a state
// post) is needed because a lazy cut makes no document edit, yet its source row
// must gain/lose the dimmed affordance, so the owning view must repaint.
const liveWebviews = new Map<vscode.Webview, () => void>();

// Each open editable document registers how to delete named entries from ITSELF,
// in its own format. Present for every view that can be a drag source (the source
// view is always open during a drag), so a drop never has to guess. A cut's source
// can be closed before its paste, though, which deleteFromSource answers for.
const sourceDeleters = new Map<string, SourceDeleter>();

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

export function registerSourceDeleter(uriString: string, fn: SourceDeleter): void {
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
//
// Each view is reached on its own terms: a post or a repaint that throws — a panel disposed
// under the loop, a model that will not read — costs that view its update and nobody else
// theirs. Unguarded, the first view to throw starved every one registered after it, and the
// clipboard state those tables showed was then simply wrong (Paste disabled with a cut on it).
export function broadcastClipboardState(): void {
  const state = clipboardState();
  for (const [wv, repaint] of [...liveWebviews]) {
    reach(() => wv.postMessage({ type: 'clipboardState', ...state }));
    reach(repaint);
  }
}

// Broadcast the current drag descriptor (or null when the drag ends) to every
// live webview. Because HTML5 dataTransfer does not survive the webview iframe
// boundary, the dragged rows live in the host drag register; each webview learns
// of the in-flight drag through this descriptor and predicts the drop locally.
//
// Per view, for the reason given at broadcastClipboardState.
export function broadcastDragState(): void {
  const descriptor = dragDescriptor();
  for (const wv of [...liveWebviews.keys()]) {
    reach(() => wv.postMessage({ type: 'dragState', descriptor }));
  }
}

// Run one view's half of a broadcast, keeping whatever it throws — now or, for a postMessage,
// later as a rejection — from reaching the loop that serves every other view.
function reach(run: () => unknown): void {
  try {
    const result = run() as { then?: unknown } | undefined;
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
    }
  } catch {
    /* this view misses this broadcast; the next one it gets is complete */
  }
}

/**
 * Complete the source-delete half of a cross-document move, and say whether it happened.
 *
 * During a drag the source view is open (closing it ends the drag), so its deleter is here. A
 * CUT is different: it is lazy, so its source may have been closed between the cut and the
 * paste, and then there is no deleter — and no format-appropriate way to edit the file — so the
 * original stays where it is. That used to be silent: the paste landed, the clipboard emptied,
 * and the user had two copies without being told. Now it is an answer the caller reports.
 *
 * A deleter that throws still throws: the caller (transfer.ts) turns that into the same report.
 */
export async function deleteFromSource(uriString: string, targets: DeleteTarget[]): Promise<SourceDeleteResult> {
  const fn = sourceDeleters.get(uriString);
  if (!fn) return { removed: false, reason: 'its table is no longer open' };
  const result = await fn(targets);
  // Typed as an answer, so nothing should return none — but a deleter that says nothing has
  // not said it removed anything, and the user is the one who would pay for assuming it did.
  return result && typeof result.removed === 'boolean' ? result : { removed: false, reason: 'its editor did not say' };
}
