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
// against it) are the ONLY real difference between the providers here, never what
// copying a row means. The MAT-file editor copies through it too, and every provider starts
// a drag through `dragEntries` below, the drag register's half of the same thing.
import { setClipboard, type ClipboardMode } from './clipboard.js';
import { clearDrag, setDrag } from './dragState.js';
import { buildClipboardSnapshot, buildDragSnapshot } from './structuralEdit.js';
import { sharedNameRefusal } from './transfer.js';

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
   * Fan the register's new state out to every live table (editorHub's
   * broadcastClipboardState for a copy, broadcastDragState for a drag). Injected because
   * editorHub imports `vscode`, and this module stays vscode-free so it can be unit-tested.
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
    // A cut is a move whose delete comes later, by name: refused now, before it marks anything,
    // for an entry that name does not tell apart in its document (transfer.ts refuses a
    // move-mode drop of one the same way). A copy of it is a copy.
    const shared = mode === 'cut' ? items.find((it) => it.sharedName) : undefined;
    if (shared) {
      deps.post({ type: 'error', message: sharedNameRefusal('cut', String(shared.payload.name ?? ''), uriString) });
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

/**
 * Snapshot every entry the dragged rows resolve to into the drag register, and tell every open
 * table (`deps.broadcast` is editorHub's broadcastDragState here), so each can predict the drop
 * on dragover.
 *
 * The same walk and dedupe as a copy (buildDragSnapshot shares them with
 * buildClipboardSnapshot): "if you can cut/copy you can drag". Every provider starts a drag
 * through here; only getting a live model and resolving a row differ between them, and those
 * are `deps`. A refused or failed start leaves no drag behind and says why — silent, the drag
 * looked like it had started, and the drop that ended it reported only "Nothing to drop.".
 *
 * Returns whether anything is being dragged, for the tests.
 */
export function dragEntries(rowIds: readonly string[], uriString: string, deps: CopyDeps): boolean {
  try {
    deps.refresh();
    const snap = buildDragSnapshot(rowIds, deps.findNode);
    if (snap.items.length === 0) clearDrag();
    else setDrag(uriString, snap.items);
    deps.broadcast();
    return snap.items.length > 0;
  } catch (err) {
    clearDrag();
    deps.broadcast();
    deps.post({ type: 'error', message: `Failed to drag: ${(err as Error).message}` });
    return false;
  }
}
