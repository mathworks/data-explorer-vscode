// Copyright 2026 The MathWorks, Inc.
//
// What every table row carries on top of its node's own `toRow()` — stamped by ONE chain,
// for both row builders.
//
// rowBuilder.ts (dictionary, model, project) and matRowBuilder.ts (MAT-file) each make a
// row from a node and then stamp it: the context-menu flags, the Status column's answer from
// the last save, the clipboard mark, the grid-view payload, the deferred mark, and the cell
// pool. They did that with two copies of the chain, and the copies had drifted — one
// guarded its capability checks and one did not, one could carry a clip mark and one could
// not. That is this repo's recurring defect, one rule along two paths, in the shape most able
// to hide it: a missing stamp renders as a plausible row with a feature quietly absent in one
// format. So the chain is here, once, and each builder says only what is its own — which row
// is an entry's, what that entry's Status is, and whether its format copies.
//
// Kept vscode-free, like the builders, so it is unit-testable (test/rowStamp.test.ts).
import type { RowCellPool } from 'data-explorer-core';
import { stampMatrix } from './matrixPayload.js';
import { stampLazy } from './lazyRows.js';

// Identifies the entries currently marked on the host clipboard, so their source rows
// can render the cut (dimmed) / copied (dashed) affordance. A SET because the clipboard
// holds every entry a multi-row copy resolved to, and all of their rows carry the mark.
//
// Keyed by section AND name because entry names are only unique within a section. A
// MAT-file has no sections, so its variables are keyed with '' for the section — the same
// '' its clipboard and drag items carry as their source section. The key is a PATH shape
// rather than a bare name so that dimming an individual child row (the deferred
// node-granular seam) widens the key instead of reshaping this.
export interface ClipMark {
  keys: Set<string>;
  mode: 'cut' | 'copy';
}

/** The mark key for one entry. `\0` cannot occur in a section or entry name. */
export function clipMarkKey(section: string, name: string): string {
  return `${section}\u0000${name}`;
}

/** The section and name a mark key spells. */
export function splitClipMarkKey(key: string): { section: string; name: string } {
  const at = key.indexOf('\u0000');
  return at < 0
    ? { section: '', name: key }
    : { section: key.slice(0, at), name: key.slice(at + 1) };
}

/** The context-menu flags of one row, which the webview (holding no model) builds its menu from. */
export interface CapabilityFlags {
  _canCopy: boolean;
  _canDelete: boolean;
  _canAddChild: boolean;
}

/**
 * The context-menu flags for a node, computed host-side so the webview can build the
 * right-click menu synchronously from row data.
 *
 * An entry is removable from its section (or a variable from its file); a nested child only
 * if its parent container permits it (bus/struct/enum expose canRemoveChild). canAddChild and
 * canRemoveChild exist only on some node types, so both are guarded with typeof — and a check
 * that THROWS offers nothing rather than taking the row down with it: the MAT builder always
 * guarded this, the dictionary builder did not, and there a throw escaped the whole build and
 * blanked the table instead of one row's menu.
 *
 * `canCopy` is the caller's because it is a fact about the FORMAT, not the node: a
 * dictionary's entries always travel on the clipboard, and a MAT-file's do once its host
 * offers the clipboard (matRowBuilder's `canCopy`). Copy and Cut act on the owning entry, so
 * every row of a document carries the same answer.
 */
export function capabilityFlags(n: any, opts: { canCopy: boolean }): CapabilityFlags {
  let canDelete = false;
  let canAddChild = false;
  try {
    const parent = n.parent;
    canDelete = !!n.isEntry || !!(parent && typeof parent.canRemoveChild === 'function' && parent.canRemoveChild());
    canAddChild = typeof n.canAddChild === 'function' && !!n.canAddChild();
  } catch {
    /* offered nothing */
  }
  return { _canCopy: opts.canCopy, _canDelete: canDelete, _canAddChild: canAddChild };
}

/**
 * What an ENTRY's own row is stamped with beyond its node's cells. Nested rows have none of
 * these: they are never marked Modified by the baseline, and never take the clipboard mark.
 */
export interface EntryStamp {
  /** The entry's section, '' for a MAT-file's variable: half of its clip-mark key. */
  section: string;
  name: string;
  /**
   * The Status column's answer from the caller's baseline, authoritative where given; absent
   * leaves the node's own. Each builder owns the rule that produces it (rowBuilder: a stale
   * 'Modified' cleared; matRowBuilder: the editable view's save marks).
   */
  status?: string;
  clipMark?: ClipMark;
}

export interface StampContext {
  /** Whether this document's entries travel on the clipboard (`_canCopy`). */
  canCopy: boolean;
  /** Present on an entry's own row only. */
  entry?: EntryStamp;
  /** The plan held this node's children back (lazyRows.ts). */
  deferred: boolean;
  /** Share the finished row's cells through this pool, when the build has one. */
  pool?: RowCellPool;
}

/**
 * Stamp one built row. `built` is the builder's row — `toRow()`'s output plus whatever is
 * the builder's own (rowBuilder's block-row remap, section reparent and dictionary metadata
 * columns) — and is never written: each stamp copies.
 *
 * In this order, which both builders already applied: the entry's Status and clip mark, then
 * the capability flags, then the grid-view payload if the node's value is a griddable matrix,
 * then `_lazy` last, so a row is the same shape whichever builder made it. None rewrites the
 * row's columns.
 *
 * The pool shares the FINISHED row, rather than being passed to `toRow()`: the row is the
 * node's cells plus the host's own, so sharing here covers all of them in one walk where doing
 * both would cost two. `_matrix` is left alone: the pool declines any cell it cannot key
 * exactly, and a matrix payload holds a number[].
 */
export function stampRow(built: any, n: any, ctx: StampContext): any {
  let row = built;
  const entry = ctx.entry;
  if (entry) {
    if (entry.status !== undefined) row = { ...row, Status: entry.status };
    // The table reads Name.clipboardMode to dim (cut) or dash-outline (copied). The key
    // carries the section, so no caller has to pre-match it.
    if (entry.clipMark?.keys.has(clipMarkKey(entry.section, entry.name)) && row.Name && typeof row.Name === 'object') {
      row = { ...row, Name: { ...row.Name, clipboardMode: entry.clipMark.mode } };
    }
  }
  const stamped = stampLazy(stampMatrix({ ...row, ...capabilityFlags(n, { canCopy: ctx.canCopy }) }, n), ctx.deferred);
  return ctx.pool ? ctx.pool.share(stamped) : stamped;
}
