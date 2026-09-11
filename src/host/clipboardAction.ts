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
// Everything format-specific is injected, mirroring buildDragSnapshot: `refresh`
// (bring the model up to date with the live content) and `findNode` (resolve a row id
// against it) are the ONLY real difference between the two providers here, never what
// copying a row means.
import { setClipboard, type ClipboardMode } from './clipboard.js';
import { buildClipboardSnapshot } from './structuralEdit.js';

export interface CopyDeps {
  /**
   * Bring this format's model up to date with its live content. Called ONCE per
   * copy, however many rows it covers: the JSON provider re-parses the document here,
   * which is ~190 ms on a real customer dictionary — per row it would be per row.
   */
  refresh: () => void;
  /** Resolve a row id against the refreshed model. */
  findNode: (rowId: string) => any;
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
 * Snapshot every entry the rows resolve to onto the host clipboard in `mode`.
 *
 * Rows are deduped by owning entry (buildClipboardSnapshot), so selecting a bus and two
 * of its elements copies ONE bus. That is the spec's rule: Copy needs a destination, so
 * it stays entry-granular even when Delete on the same selection is row-granular.
 *
 * `uriString` is recorded with the payloads because a cut is LAZY — the source
 * delete is deferred to paste time, and the paste may land in a different .sldd
 * tab, so the clipboard must remember which document to delete from.
 *
 * Returns whether anything reached the clipboard. Callers do not need the result
 * (every failure has already been reported to the webview); it exists so the
 * outcome is assertable.
 */
export function copyEntriesToClipboard(
  rowIds: readonly string[],
  mode: ClipboardMode,
  uriString: string,
  deps: CopyDeps,
): boolean {
  try {
    deps.refresh();
    // Two passes over the same refreshed model (both are index lookups). Separating
    // "no row resolved" from "rows resolved but no entry behind them" is what keeps
    // the two failures distinguishable to the user: the first is a stale table, the
    // second is a row that has no entry to copy, like a section header.
    if (!rowIds.some((id) => !!deps.findNode(id))) {
      deps.post({
        type: 'error',
        message: `Could not ${mode} the selected item${rowIds.length === 1 ? '' : 's'}.`,
      });
      return false;
    }
    const items = buildClipboardSnapshot(rowIds, deps.findNode);
    if (!items.length) {
      deps.post({ type: 'error', message: 'Could not locate the owning entry in the model.' });
      return false;
    }
    setClipboard(items, mode, uriString);
    // Broadcast so every open table (not just this one) enables Paste and
    // repaints — the cut/copied source rows show their affordance.
    deps.broadcast();
    return true;
  } catch (err) {
    // Reached when the model refresh itself fails: `refresh` re-parses the live
    // content, so a half-typed edit in the JSON .sldd's plain-text view makes
    // JSON.parse throw right here.
    deps.post({ type: 'error', message: `Failed to ${mode}: ${(err as Error).message}` });
    return false;
  }
}
