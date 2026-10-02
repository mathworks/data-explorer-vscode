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
 * Rows for everything under `node`, within `budget`.
 *
 * The whole builder. A `.mat`'s variables ARE its root node's children and a
 * deferred row's children are its node's children, so the initial build and the
 * answer to a `requestChildren` are the same walk from a different node — written
 * once, because this repo's recurring defect is one rule with two implementations.
 * The node's own row is never emitted: at the top there is nothing to show for the
 * file itself, and on an expansion the table already holds the row that was clicked.
 */
export function buildMatRowsPlanned(node: any, budget: number = Infinity): MatRows {
  const rows: any[] = [];
  // One cell pool per build, on the same terms as buildRows' — see the note there. This
  // builder has no partial-repaint caller, so it owns its pool outright rather than taking
  // one: every call materializes the whole table.
  const pool = new RowCellPool();
  const plan = planRows((node?.children ?? []) as any[], budget);
  for (const { node: n, deferred } of plan.planned) {
    let row: any;
    try {
      row = n.toRow();
    } catch {
      continue;
    }
    // Same grid-view stamp as the sldd/slx builder — see test/matrixStamp.test.ts,
    // which asserts the rule against both builders so they cannot drift.
    if (row) rows.push(pool.share(stampLazy(stampMatrix(row, n), deferred)));
  }
  return { rows, plan };
}

/** The rows alone, for every caller that cannot answer a fetch and so passes no budget. */
export function buildMatRows(matNode: any, budget: number = Infinity): any[] {
  return buildMatRowsPlanned(matNode, budget).rows;
}
