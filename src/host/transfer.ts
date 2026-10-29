// Copyright 2026 The MathWorks, Inc.
//
// What a paste or a drop MEANS, said once for every editable table.
//
// A paste is a drop whose source register is the clipboard rather than the drag register:
// both carry N entries, each with the section it was taken from, a document they came from,
// and whether that document is to lose them. Each provider used to spell the whole of it out
// twice, once per register, and the copies drifted the way this repo keeps finding: a
// same-section move was a no-op for a paste and not for a drop, a cut was cleared after the
// source delete failed but reported as a failed edit, a missing source deleter moved nothing
// and said nothing. So the RULES live here and nothing else does:
//
//   - which register, and when it is let go of: the clipboard only after a cut that landed (or
//     was a no-op), the drag register always, and either only while it still holds what this
//     transfer read — a newer copy or drag written meanwhile is the user's, not ours to clear;
//   - the target, resolved BEFORE anything changes, and a move back into the very section
//     every item came from answered as the no-op it is;
//   - a same-document move made as ONE edit that removes the sources first, so the pasted
//     entries keep their names (`removeFirst`), and a cross-document move made as the paste
//     here and then the delete over there (`deleteFromSource`);
//   - a move of an entry its document cannot tell apart by the selector the delete uses (a
//     dictionary entry with no uuid whose name another section holds) refused before anything
//     changes: a copy of it is fine, a move would take out the wrong original;
//   - what each way of failing says. A refusal that changed nothing (`TransferRefused`) is a
//     message; anything else thrown before the edit landed is the adapter's to repair
//     (`onFailure`); a source delete that fails AFTER the edit landed is neither — the paste
//     happened, so nothing is repaired and the message says exactly what is left to do.
//
// What an edit IS in each format — a WorkspaceEdit painted ahead of its echo, a chunk pushed on
// a custom document's own stack, a session gesture over core's tree — is the adapter's, and
// this module neither knows nor imports any of it. That is also why it is vscode-free: every
// branch above is unit-tested with a fake adapter (test/transfer.test.ts).
import { entrySelectorOf, type EntrySelector } from 'data-explorer-core';
import { uriBasename } from 'data-explorer-view/model/ids/pathUtil.js';

/** One entry a transfer carries: what to paste, and the section it was taken from. */
export interface TransferItem {
  payload: Record<string, unknown>;
  /** The section the entry was taken from. `''` for a MAT-file, whose one section has no name. */
  sourceSection: string;
  /**
   * Another entry of its document answers to the selector a move would delete it by
   * (structuralEdit's registerItemsOf), so a move of it is refused: the delete could take the
   * other one. A copy of it is a copy like any other.
   */
  sharedName?: boolean;
  /**
   * Who the entry was when it was taken, for a source whose selector cannot say: an opaque token
   * its document handed out (a MAT-file's variable has a name and no uuid, so a cut of `x`, then
   * a delete of `x` and an Add of another `x`, would otherwise have the paste take out the new
   * one). Carried to that document's deleter (SourceSelector.origin) and read by nothing else.
   */
  origin?: object;
}

/**
 * What a cross-document move asks the source document to remove: the entry's selector, and its
 * origin token where it was taken with one (TransferItem.origin).
 */
export interface SourceSelector extends EntrySelector {
  origin?: object;
}

/** What a register held when the transfer read it. */
export interface TransferContents {
  items: readonly TransferItem[];
  /** The document the items were taken from. */
  sourceDocUri: string | undefined;
  /** The source is to lose them: a cut, or a drop in move mode. */
  move: boolean;
}

/**
 * Where a transfer's items come from, and how it lets go of them.
 *
 * Read ONCE, at the start; `clear` empties it only if it still holds what that read returned,
 * so a copy or a drag the user started while this transfer was awaiting its write survives it.
 * `clear` and `broadcast` are separate because a cut is consumed the moment its paste lands —
 * a second Paste arriving while the source delete is still in flight must find the clipboard
 * empty — while the tables are told once that delete is done, so a source row is not un-dimmed
 * a moment before it disappears. See transferRegisters.ts for the two real registers.
 */
export interface TransferRegister {
  /** `'clipboard'` for a paste, `'drag'` for a drop; decides when the register is cleared. */
  readonly kind: 'clipboard' | 'drag';
  /** What the register holds, or null when it is empty. */
  read(): TransferContents | null;
  /** Empty the register, if it still holds what `read` returned. */
  clear(): void;
  /** Tell every open table what the register now holds. */
  broadcast(): void;
}

/** Where a transfer lands. Adapters extend it with whatever their commit needs (a live section, a model). */
export interface TransferTarget {
  /** The section the entries go into, spelled as items spell `sourceSection`. */
  sectionName: string;
}

/** What a transfer asks its adapter to make, as ONE edit — one undo step. */
export interface TransferCommit<T extends TransferTarget> {
  target: T;
  /** The entries to paste, in register order. The adapter clones what it keeps. */
  payloads: Record<string, unknown>[];
  /**
   * The entries to take out of THIS document first, in the same edit, so the pasted ones keep
   * their names (a source still standing in the namespace would push its copy to `Name1`).
   * Non-empty only for a same-document move.
   */
  removeFirst: EntrySelector[];
  /** What the edit is called, for an undo stack that names its steps. */
  label: TransferLabel;
}

export type TransferLabel = 'Paste' | 'Move' | 'Copy';

/**
 * One document's half of a transfer: the format-specific parts, as a provider-local closure.
 *
 * Created per transfer, so it may keep that transfer's own state (whether it has painted yet,
 * say) for `onFailure` to read.
 */
export interface TransferAdapter<T extends TransferTarget = TransferTarget> {
  /** This document's uri: what a register's `sourceDocUri` is compared with. */
  readonly docUri: string;
  /**
   * False for a document that cannot remove-and-paste in one edit because it never has to: a
   * MAT-file is one section, so a same-file move is always the same-section no-op. Should the
   * policy ever need it anyway, the transfer is refused rather than made as something else.
   * Default true.
   */
  readonly takesRemoveFirst?: boolean;
  /**
   * A precondition checked before the register is read — the JSON view's mid-edit gate. Reports
   * its own refusal and answers false to stop the transfer.
   */
  guard?(): boolean;
  /**
   * The target the row names (`''` = the document itself), or null when it names none. Must
   * change nothing. May throw TransferRefused.
   */
  resolveTarget(rowId: string): T | null;
  /**
   * Refuse, BEFORE anything changes, what the target will not take — by throwing TransferRefused.
   * Asked after the no-op check: entries already in the target are not re-judged by it.
   */
  validate?(target: T, payloads: readonly Record<string, unknown>[]): void;
  /** Make the edit. Throws TransferRefused only when it has changed nothing. */
  commit(plan: TransferCommit<T>): Promise<void> | void;
  /** Something other than TransferRefused was thrown before the edit landed: repair, and say so. */
  onFailure(err: unknown): void;
  /** Show `message` in this document's view. */
  report(message: string): void;
}

/**
 * What a source deleter did. `removed: false` is not an exception because the caller has
 * nothing to repair: the paste already landed, and the user has to be told what is left.
 */
export interface SourceDeleteResult {
  removed: boolean;
  /** Why not, as the tail of "…could not be removed: <reason>". Absent when removed. */
  reason?: string;
  /**
   * Not removed because the original is no longer in its document — deleted since it was taken,
   * and its name since given to another entry, which the deleter left alone. Nothing is left for
   * the user to remove, so the message asks nothing of them: the entry that holds the name now
   * is not the original, and removing it by hand would lose it.
   */
  gone?: boolean;
}

export interface TransferDeps {
  /** Take the moved entries out of the document they came from (editorHub.deleteFromSource). */
  deleteFromSource(sourceDocUri: string, selectors: SourceSelector[]): Promise<SourceDeleteResult>;
  /**
   * Say something the user must not miss, somewhere that stays until they dismiss it (the
   * providers use `vscode.window.showWarningMessage`). Used for one thing: a move that landed
   * here but left its original behind. The view's banner says it too, but the next row update
   * clears a banner, and a duplicate the user never learned of is the outcome this exists for.
   */
  warn?(message: string): void;
}

export interface TransferRequest {
  /**
   * The row pasted or dropped on — a section header row for an empty section, or `''` for the
   * document itself (a whole-file document such as a MAT-file, whose empty table has no row to
   * aim at). Passed to the adapter as it is: `''` is a target to resolve, not a missing one.
   */
  rowId: string;
}

/**
 * A refusal that changed nothing: a message, and no repair.
 *
 * Thrown by an adapter (or the policy) only while the document, its model and its rows are all
 * still exactly as they were — the cut stays on the clipboard for another try, and no repaint
 * is spent putting back what was never moved.
 */
export class TransferRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferRefused';
  }
}

/** How a transfer ended. Callers need not read it; it is what the policy's branches are tested by. */
export type TransferOutcome =
  | { kind: 'guarded' }
  | { kind: 'empty' }
  | { kind: 'no-target' }
  | { kind: 'noop' }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; error: unknown }
  /** Landed. `sourceKept` is the message reported when a move's source delete did not happen. */
  | { kind: 'done'; sourceKept?: string };

/**
 * Whether moving `contents` onto `sectionName` of `docUri` would change nothing: every item
 * already lives there. The one rule both registers obey, and the one the webview's drop
 * predictor (dropDecision) answers the same way — pinned between the two in
 * multiSelectInvariants.test.ts. With mixed sources it is NOT a no-op: the items from
 * elsewhere really do move, and the ones already there are removed and re-added under the
 * names they had.
 */
export function isNoopMove(contents: TransferContents, docUri: string, sectionName: string): boolean {
  return (
    contents.move &&
    contents.sourceDocUri === docUri &&
    contents.items.every((it) => it.sourceSection === sectionName)
  );
}

/**
 * Paste the clipboard, or drop the drag register, onto `req.rowId` of the adapter's document.
 *
 * Synchronous up to the commit: nothing here awaits before the adapter makes its edit, so the
 * target it resolved and the document it resolved it in are still the ones it edits.
 */
export async function runTransfer<T extends TransferTarget>(
  req: TransferRequest,
  register: TransferRegister,
  adapter: TransferAdapter<T>,
  deps: TransferDeps,
): Promise<TransferOutcome> {
  try {
    return await transfer(req, register, adapter, deps);
  } finally {
    // A drop ends the drag whatever became of it. Cleared only on success, a refused drop left
    // every table predicting a drop that had already been tried, until the source view's
    // dragEnd came round to clear it.
    if (register.kind === 'drag') {
      register.clear();
      register.broadcast();
    }
  }
}

async function transfer<T extends TransferTarget>(
  req: TransferRequest,
  register: TransferRegister,
  adapter: TransferAdapter<T>,
  deps: TransferDeps,
): Promise<TransferOutcome> {
  const isPaste = register.kind === 'clipboard';
  if (adapter.guard && !adapter.guard()) return { kind: 'guarded' };
  const contents = register.read();
  if (!contents || contents.items.length === 0) {
    adapter.report(isPaste ? 'Nothing to paste — the clipboard is empty.' : 'Nothing to drop.');
    return { kind: 'empty' };
  }

  let target: T | null;
  try {
    target = adapter.resolveTarget(req.rowId);
    if (!target) {
      adapter.report('Could not resolve the target section.');
      return { kind: 'no-target' };
    }
    // A move back into the section every item came from. The clipboard's cut is spent on it
    // (the mark goes, as it would after any paste); the drag register goes in the finally.
    if (isNoopMove(contents, adapter.docUri, target.sectionName)) {
      if (isPaste) {
        register.clear();
        register.broadcast();
      }
      return { kind: 'noop' };
    }
  } catch (err) {
    return refusedOrFailed(err, adapter);
  }

  const sameDoc = contents.sourceDocUri === adapter.docUri;
  // Selectors, not names: an entry's name is unique only within its namespace, and a .sldd
  // holds several, so deleting by name alone could take a same-named entry out of another
  // section (core's entrySelector.ts). Nameless payloads name nothing to delete.
  const selectors: SourceSelector[] = contents.items
    .map((it) => (it.origin ? { ...entrySelectorOf(it.payload), origin: it.origin } : entrySelectorOf(it.payload)))
    .filter((s) => s.name.length > 0);
  const removeFirst = contents.move && sameDoc ? selectors : [];
  const label: TransferLabel = isPaste ? 'Paste' : contents.move ? 'Move' : 'Copy';

  try {
    const shared = contents.move ? contents.items.find((it) => it.sharedName) : undefined;
    if (shared) {
      throw new TransferRefused(sharedNameRefusal(isPaste ? 'cut' : 'move', String(shared.payload.name ?? ''), contents.sourceDocUri));
    }
    if (removeFirst.length > 0 && adapter.takesRemoveFirst === false) {
      throw new TransferRefused(`Cannot move entries within ${fileNameOf(adapter.docUri)}.`);
    }
    const payloads = contents.items.map((it) => it.payload);
    adapter.validate?.(target, payloads);
    await adapter.commit({ target, payloads, removeFirst, label });
  } catch (err) {
    return refusedOrFailed(err, adapter);
  }

  // Landed. Everything below is the source's half of a cross-document move, and none of it
  // may undo or repaint what just happened here.
  if (!contents.move) return { kind: 'done' };
  // Consumed by the paste that just landed, whatever the source delete does next: a cut left
  // live would paste the same entries a second time. Cleared BEFORE the delete is awaited, so
  // a second Paste arriving meanwhile finds nothing to paste rather than this cut again.
  if (isPaste) register.clear();
  try {
    if (sameDoc || selectors.length === 0) return { kind: 'done' };
    const result = await sourceDelete(contents.sourceDocUri, selectors, deps);
    if (result.removed) return { kind: 'done' };
    const message = sourceKeptMessage(isPaste, contents.sourceDocUri, selectors.length, result.reason, result.gone === true);
    adapter.report(message);
    deps.warn?.(message);
    return { kind: 'done', sourceKept: message };
  } finally {
    if (isPaste) register.broadcast();
  }
}

// The source delete, with every way it can fail turned into a result: the caller's answer to all
// of them is the same message.
async function sourceDelete(
  sourceDocUri: string | undefined,
  selectors: SourceSelector[],
  deps: TransferDeps,
): Promise<SourceDeleteResult> {
  if (!sourceDocUri) return { removed: false, reason: 'nothing says which file it came from' };
  try {
    return await deps.deleteFromSource(sourceDocUri, selectors);
  } catch (err) {
    return { removed: false, reason: (err as Error)?.message || String(err) };
  }
}

function refusedOrFailed(err: unknown, adapter: TransferAdapter<any>): TransferOutcome {
  if (err instanceof TransferRefused) {
    adapter.report(err.message);
    return { kind: 'refused', message: err.message };
  }
  adapter.onFailure(err);
  return { kind: 'failed', error: err };
}

/**
 * Why an entry that shares its name in its document cannot be cut or moved, naming it and the
 * document: the move would take its original out by that name, and could take the other one.
 * Said where a cut is refused (clipboardAction) and where a move-mode drop is (above), in the
 * same words, because it is the same rule.
 */
export function sharedNameRefusal(verb: 'cut' | 'move', name: string, sourceDocUri: string | undefined): string {
  const where = sourceDocUri ? fileNameOf(sourceDocUri) : 'its file';
  return `Cannot ${verb} "${name}": ${where} holds more than one "${name}", and a move takes its original out by name. Copy it instead.`;
}

/**
 * "Pasted here, but the original in a.sldd could not be removed: <reason>. Remove it there by
 * hand." — accurate about both halves: the paste DID land, and nothing was rolled back. Or, where
 * the original is `gone` (SourceDeleteResult.gone), "Pasted here; the original in a.mat is no
 * longer there to remove: <reason>." — asking nothing, since what holds its name now is not it.
 */
export function sourceKeptMessage(
  isPaste: boolean,
  sourceDocUri: string | undefined,
  count: number,
  reason: string | undefined,
  gone = false,
): string {
  const what = count === 1 ? 'the original' : 'the originals';
  const where = sourceDocUri ? ` in ${fileNameOf(sourceDocUri)}` : '';
  const why = (reason ?? 'the source did not say why').replace(/[.\s]+$/, '');
  const verb = isPaste ? 'Pasted' : 'Moved';
  // Nothing to remove by hand: what holds the original's name there now is something else.
  if (gone) return `${verb} here; ${what}${where} ${count === 1 ? 'is' : 'are'} no longer there to remove: ${why}.`;
  return `${verb} here, but ${what}${where} could not be removed: ${why}. Remove ${count === 1 ? 'it' : 'them'} there by hand.`;
}

/** The file name a uri string ends in, decoded, for a message. */
export function fileNameOf(uriString: string): string {
  const raw = uriBasename(uriString);
  try {
    return decodeURIComponent(raw) || raw;
  } catch {
    return raw;
  }
}
