// Copyright 2026 The MathWorks, Inc.
// Row builder for .mat files. Unlike sldd/model, a MatNode has variables as
// direct children (no section layer). Each variable is a top-level row; struct
// and other nested fields are flattened via the node's own flatten()/toRow().
//
// The flatten is planned rather than taken whole (lazyRows.ts): a `.mat` is the one
// format here measured at two million nodes, and `budget` is what stops this
// building a row for every one of them. The default is Infinity — the whole tree, as
// before — so only a caller that can answer a `requestChildren` passes a budget.
import { RowCellPool } from 'data-explorer-core';
import { stampMatrix } from './matrixPayload.js';
import { planRows, stampLazy, type RowPlan } from './lazyRows.js';

/** Rows for a .mat subtree, plus what the plan held back (for the banner). */
export interface MatRows {
  rows: any[];
  plan: RowPlan;
}

/**
 * How each variable differs from the file as last saved, for the Status column of the editable
 * view (saveMarks.ts): by node, because two variables of a file can share a name. Absent, a row
 * shows core's own status, as the read-only view always has.
 */
export type SavedStatus = ReadonlyMap<unknown, string>;

/**
 * Rows for everything under `node`, within `budget`.
 *
 * The whole builder. A `.mat`'s variables ARE its root node's children and a
 * deferred row's children are its node's children, so the initial build and the
 * answer to a `requestChildren` are the same walk from a different node — written
 * once, because this repo's recurring defect is one rule with two implementations.
 * The node's own row is never emitted: at the top there is nothing to show for the
 * file itself, and on an expansion the table already holds the row that was clicked.
 */
export function buildMatRowsPlanned(node: any, budget: number = Infinity, saved?: SavedStatus): MatRows {
  return plannedRows((node?.children ?? []) as any[], budget, saved);
}

/**
 * The rows of ONE variable, its own row first, within `budget`: what the editable view repaints
 * after an edit of that variable, spliced over the run the table holds (`updateEntryRows`). The
 * same walk as the payload's, from the variable instead of from the file, so a repainted
 * variable's rows are the rows the next whole payload would hold for it.
 */
export function buildMatVariableRows(variable: any, budget: number = Infinity, saved?: SavedStatus): any[] {
  return plannedRows([variable], budget, saved).rows;
}

function plannedRows(roots: any[], budget: number, saved: SavedStatus | undefined): MatRows {
  const rows: any[] = [];
  // One cell pool per build, on the same terms as buildRows' — see the note there. A pool per
  // call, the repaint of one variable included: one that outlived the call would pin the cells
  // of every build it had shared.
  const pool = new RowCellPool();
  const plan = planRows(roots, budget);
  for (const { node: n, deferred } of plan.planned) {
    let row: any;
    try {
      row = n.toRow();
    } catch {
      continue;
    }
    if (!row) continue;
    // Core's status says "edited since the file was read", and stays so through a save (it is
    // what makes the next save write the variable fresh); the editable view's column says
    // "differs from the file on disk", which is the caller's answer. A variable's own row only:
    // core marks nothing under one.
    if (saved && n.isEntry) row = { ...row, Status: saved.get(n) ?? '' };
    // Same grid-view stamp as the sldd/slx builder — see test/matrixStamp.test.ts,
    // which asserts the rule against both builders so they cannot drift.
    rows.push(pool.share(stampLazy(stampMatrix({ ...row, ...capabilityFlags(n) }, n), deferred)));
  }
  return { rows, plan };
}

/**
 * The context-menu flags of a MAT-file's row, as rowBuilder stamps a dictionary's: what the
 * webview, which holds no model, builds its menu from. Core answers both from what a save of the
 * file can write (MatNode._editRefusal), so a Delete or an Add Child the menu offers is one the
 * save keeps. A variable is removable from its file, and anything under one from its parent if
 * the parent says so. Never copyable: a MAT-file's value has no dictionary entry to travel as,
 * and the editable view offers no clipboard (`clipboard: false` on its setRows).
 */
function capabilityFlags(n: any): { _canCopy: boolean; _canDelete: boolean; _canAddChild: boolean } {
  const parent = n.parent;
  const canDelete =
    !!n.isEntry || !!(parent && typeof parent.canRemoveChild === 'function' && parent.canRemoveChild());
  const canAddChild = typeof n.canAddChild === 'function' && !!n.canAddChild();
  return { _canCopy: false, _canDelete: canDelete, _canAddChild: canAddChild };
}

/** The rows alone, for every caller that cannot answer a fetch and so passes no budget. */
export function buildMatRows(matNode: any, budget: number = Infinity): any[] {
  return buildMatRowsPlanned(matNode, budget).rows;
}
