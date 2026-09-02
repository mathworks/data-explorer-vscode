// Copyright 2026 The MathWorks, Inc.
//
// The copy/cut half of the clipboard, shared by BOTH table providers
// (SlddTextEditorProvider for JSON .sldd, BinarySlddEditorProvider for
// compressed-binary). It ran as two inline copies, and they had already
// diverged: the JSON one returned a bare boolean and reported nothing, so only
// its CUT caller surfaced a message and a failed COPY was completely silent —
// the same gesture on a binary .sldd named the problem. Copy/cut makes no
// document edit, so silence is all the user gets: no repaint, no dirty marker,
// and a clipboard still holding whatever was there before, which the next paste
// then lands.
//
// Everything format-specific is injected, mirroring buildDragSnapshot: getting a
// live model is the ONLY real difference between the two providers here, never
// what copying a row means.
import { setClipboard, type ClipboardMode } from './clipboard.js';
import { findOwningEntry } from './structuralEdit.js';

export interface CopyDeps {
  /** Refresh this format's model from its live content and resolve a row id. */
  resolveNode: (rowId: string) => any;
  /** Post to the owning webview. Only ever used for failures. */
  post: (message: { type: 'error'; message: string }) => void;
  /**
   * Fan the new clipboard state out to every live table (editorHub's
   * broadcastClipboardState). Injected because editorHub imports `vscode`, and
   * this module stays vscode-free so it can be unit-tested.
   */
  broadcast: () => void;
}

/**
 * Snapshot the row's owning entry onto the host clipboard in `mode`.
 *
 * `uriString` is recorded with the payload because a cut is LAZY — the source
 * delete is deferred to paste time, and the paste may land in a different .sldd
 * tab, so the clipboard must remember which document to delete from.
 *
 * Returns whether the entry reached the clipboard. Callers do not need the
 * result (every failure has already been reported to the webview); it exists so
 * the outcome is assertable.
 */
export function copyEntryToClipboard(
  rowId: string,
  mode: ClipboardMode,
  uriString: string,
  deps: CopyDeps,
): boolean {
  try {
    const node = deps.resolveNode(rowId);
    if (!node) {
      deps.post({ type: 'error', message: `Could not ${mode} the selected item.` });
      return false;
    }
    const entry = findOwningEntry(node);
    if (!entry) {
      deps.post({ type: 'error', message: 'Could not locate the owning entry in the model.' });
      return false;
    }
    setClipboard(entry.serialize() as Record<string, unknown>, mode, entry.parent?.name ?? '', uriString);
    // Broadcast so every open table (not just this one) enables Paste and
    // repaints — the cut/copied source row shows its affordance.
    deps.broadcast();
    return true;
  } catch (err) {
    // Reached when the model refresh itself fails: resolveNode re-parses the live
    // content, so a half-typed edit in the JSON .sldd's plain-text view makes
    // JSON.parse throw right here.
    deps.post({ type: 'error', message: `Failed to ${mode}: ${(err as Error).message}` });
    return false;
  }
}
