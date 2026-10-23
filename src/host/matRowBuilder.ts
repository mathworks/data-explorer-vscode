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
import { planRows, type RowPlan } from './lazyRows.js';
import { stampRow, type ClipMark } from './rowStamp.js';

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
 * What a MAT-file's rows take on top of the Status column: the stamps a dictionary's rows
 * have had all along (rowStamp.ts), absent until the MAT-file's host offers the clipboard.
 */
export interface MatStampOptions {
  /**
   * The variables on the host clipboard, for the cut/copied affordance. Keyed ('', name): a
   * MAT-file has no sections, and its clipboard and drag items carry '' as their source
   * section, so the one key spelling serves both formats.
   */
  clipMark?: ClipMark;
  /**
   * Whether a variable travels on the clipboard (`_canCopy` on every row). Absent is false,
   * which is what the editable view sends today (`clipboard: false` on its setRows). The read-only
   * view shows no menu, so it reads nothing here.
   */
  canCopy?: boolean;
}

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
export function buildMatRowsPlanned(
  node: any,
  budget: number = Infinity,
  saved?: SavedStatus,
  opts?: MatStampOptions,
): MatRows {
  return plannedRows((node?.children ?? []) as any[], budget, saved, opts);
}

/**
 * The rows of ONE variable, its own row first, within `budget`: what the editable view repaints
 * after an edit of that variable, spliced over the run the table holds (`updateEntryRows`). The
 * same walk as the payload's, from the variable instead of from the file, so a repainted
 * variable's rows are the rows the next whole payload would hold for it — given the same `opts`.
 */
export function buildMatVariableRows(
  variable: any,
  budget: number = Infinity,
  saved?: SavedStatus,
  opts?: MatStampOptions,
): any[] {
  return plannedRows([variable], budget, saved, opts).rows;
}

function plannedRows(roots: any[], budget: number, saved: SavedStatus | undefined, opts: MatStampOptions | undefined): MatRows {
  const rows: any[] = [];
  // One cell pool per build, on the same terms as buildRows' — see the note there. A pool per
  // call, the repaint of one variable included: one that outlived the call would pin the cells
  // of every build it had shared.
  const pool = new RowCellPool();
  const plan = planRows(roots, budget);
  const canCopy = opts?.canCopy ?? false;
  for (const { node: n, deferred } of plan.planned) {
    let built: any;
    try {
      built = n.toRow();
    } catch {
      continue;
    }
    if (!built) continue;
    // A variable's own row takes the entry stamps; core marks nothing under one. Its Status:
    // core's says "edited since the file was read", and stays so through a save (it is what
    // makes the next save write the variable fresh); the editable view's column says "differs
    // from the file on disk", which is the caller's answer.
    const entry = n.isEntry
      ? { section: '', name: n.name, status: saved ? (saved.get(n) ?? '') : undefined, clipMark: opts?.clipMark }
      : undefined;
    // The same chain as the sldd/slx builder's (rowStamp.ts) — see test/rowStamp.test.ts and
    // test/matrixStamp.test.ts, which assert it against both builders so they cannot drift.
    // Its Delete and Add Child flags are core's answers, which core gives from what a save of
    // the file can write (MatNode._editRefusal), so an item the menu offers is one the save
    // keeps. On every row, a read-only file's too: a view that shows a file read-only shows no
    // menu, so there the flags cost a few bytes a row and are read by nothing.
    rows.push(stampRow(built, n, { canCopy, entry, deferred, pool }));
  }
  return { rows, plan };
}

/** The rows alone, for every caller that cannot answer a fetch and so passes no budget. */
export function buildMatRows(matNode: any, budget: number = Infinity): any[] {
  return buildMatRowsPlanned(matNode, budget).rows;
}
