// Copyright 2026 The MathWorks, Inc.
//
// Delivering a huge tree ONE LEVEL AT A TIME instead of all of it — the rule that
// turns "more rows than a payload can carry" from a loss into a wait.
//
// WHY. rowCap.ts caps the payload because it must: past V8's maximum string length
// `JSON.stringify` refuses the message outright and the view spins for ever. But a
// cap is lossy by construction. Measured on the 8 MB `.mat` that prompted it —
// 2,016,325 nodes over 7 levels — the first 100,000 rows in depth-first order are
// the first cell's descendants and NOTHING ELSE: ten of the eleven top-level cells
// never appear, and no gesture in the table can reach them. The file opens, which
// is the fix that mattered, and then shows the wrong 5% of itself.
//
// The level widths are what make the alternative work:
//
//   level 1:       1      level 5: 130,283
//   level 2:      11      level 6: 998,079
//   level 3:      44      level 7: 887,725
//   level 4:     182
//
// Levels 1-4 are 238 rows. So "every level that fits in the budget, and the rest on
// demand" shows this file's whole shape immediately for a quarter of a percent of
// the payload, and each expansion from there is bounded by one node's child count.
// The same plan on an ordinary file fits every level and defers nothing, which is
// what makes this change invisible below the budget.
//
// WHOLE LEVELS, NOT A PREFIX. A level is delivered completely or not at all. That
// is what makes an expansion idempotent: every delivered row's children are either
// all present or all absent, so the frontier is exactly the set of rows that have
// something to fetch, and a fetch answers for all of a row's children at once. A
// half-delivered level would leave a row whose twisty opens onto some of its
// children with no way to say so.
//
// Kept vscode-free so the rule is unit-testable; the providers own the postMessage.
import { MAX_TABLE_ROWS } from './rowCap.js';
import type { WarningBanner } from './parseWarnings.js';

/**
 * The rows one request may deliver, unless its top level alone is wider (see
 * levelsThatFit): the names always come, and the budget decides how deep under them.
 *
 * The same number as the payload cap, deliberately: both answer "how much can cross
 * the boundary at once", and the cap is the one that was measured against V8's limit
 * (34.5 MiB and 58 ms to serialize at 100,000 rows). A second, smaller budget here
 * would be a second opinion about the same constraint.
 */
export const LAZY_ROW_BUDGET = MAX_TABLE_ROWS;

/** One node to build a row for, and whether its children came with it. */
export interface PlannedRow {
  node: any;
  /**
   * True when this node HAS children and none of them is in this delivery. The row
   * gets a twisty that fetches rather than expands (see stampLazy).
   */
  deferred: boolean;
  /**
   * Which of the plan's roots this node descends from (its own index, for a root).
   *
   * Carried because the sectioned builder plans EVERY entry of every section in one
   * call — that is what makes "all the names" one level rather than one level per
   * section — and then has to put each row back under its own section header. The
   * plan is contiguous per root, so this could be re-derived by watching for the next
   * root to come past; an index cannot be subtly wrong about it.
   */
  root: number;
}

export interface RowPlan {
  /** Nodes to build rows for, in depth-first pre-order: every parent before its children. */
  planned: PlannedRow[];
  /** How many of them have children still to fetch. Zero means this is the whole tree. */
  deferred: number;
  /**
   * Roots with no row at all. Always 0: every root is planned, however many there are
   * (see planRows).
   *
   * A top level wider than the budget used to be cut at the budget, and this counted
   * the names that got no row, for the banner and for the table's own note on a fetch
   * (`childRows.truncated`). The field stays so that message keeps its shape.
   */
  truncated: number;
}

/**
 * How many levels of `roots` and their descendants fit in `budget` rows, counting
 * the roots themselves as level 1.
 *
 * Always at least 1: the top level is never truncated, even when it alone exceeds the
 * budget. Then every root is delivered and everything below them is deferred. That
 * happens on the initial build of a file with more names than the budget (the 138 MB
 * bench dictionary has 291,564 entries), and on an expansion of an uncapped cell (core
 * caps numeric and string element expansion at 10,000, cells not at all — see
 * MatlabVariableNode._buildCellChildren). The names come first, so none of them is left
 * without a row; such a payload is bounded by the file rather than by the budget, which
 * is what BinaryEditorProvider's fallback to the cap is for.
 *
 * Counts the next level's WIDTH before materializing it, so a level that does not
 * fit is never built as a list.
 */
export function levelsThatFit(roots: any[], budget: number): number {
  let level: any[] = (roots ?? []).filter(Boolean);
  let running = level.length;
  let levels = 1;
  // Bounded by the tree's depth: each turn either returns or descends one level.
  for (;;) {
    let width = 0;
    for (const n of level) width += n?.children?.length ?? 0;
    // Nothing deeper exists, so every level fits and nothing is deferred.
    if (width === 0) return levels;
    if (running + width > budget) return levels;
    const next: any[] = [];
    for (const n of level) {
      for (const c of n?.children ?? []) next.push(c);
    }
    level = next;
    running += width;
    levels++;
  }
}

/**
 * Which nodes to build rows for, and which of them are the frontier.
 *
 * PRE-ORDER, not level order, even though the budget is decided by level. Row order
 * does not decide display order — the webview rebuilds the tree from each row's
 * `parent` — but it does decide every rule that reads the array linearly: rowCap's
 * prefix integrity, the contiguous per-entry run `spliceEntryRows` walks, and the
 * order a reader sees in a test. Pre-order is what all of those already assume, so
 * the budget changes WHICH rows are built and nothing else about them.
 *
 * `budget` of Infinity plans the whole tree with nothing deferred, which is the
 * behaviour every caller had before this existed.
 */
export function planRows(roots: any[], budget: number = LAZY_ROW_BUDGET): RowPlan {
  const top: any[] = (roots ?? []).filter(Boolean);
  const levels = levelsThatFit(top, budget);
  const planned: PlannedRow[] = [];
  let deferred = 0;
  // An explicit stack, not recursion: a deeply nested document would otherwise be a
  // stack overflow that blanks the whole table, and this file's trees are built from
  // parsed content whose depth nothing here chooses.
  const stack: Array<{ node: any; depth: number; root: number }> = [];
  for (let i = top.length - 1; i >= 0; i--) {
    stack.push({ node: top[i], depth: 1, root: i });
  }
  // Every root is emitted, past the budget if need be: the budget decides how deep the
  // plan goes (levelsThatFit), never which names it has.
  while (stack.length > 0) {
    const { node, depth, root } = stack.pop()!;
    planned.push({ node, deferred: false, root });
    const kids = (node?.children ?? []) as any[];
    if (kids.length === 0) continue;
    if (depth >= levels) {
      planned[planned.length - 1].deferred = true;
      deferred++;
      continue;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ node: kids[i], depth: depth + 1, root });
    }
  }
  return { planned, deferred, truncated: 0 };
}

/**
 * Mark a row whose children were held back.
 *
 * The flag's PRESENCE is the decision, exactly like `_matrix`: the table renders a
 * twisty for a row that has no delivered children because of it, and asks the host
 * for those children when the twisty is used. One place spells the field name, so
 * the webview's reader and the host's writer cannot drift.
 */
export function stampLazy<T extends object>(row: T, deferred: boolean): T {
  return deferred ? { ...row, _lazy: true } : row;
}

/**
 * The banner for a payload that deferred something, folding in whatever the parse
 * already had to say.
 *
 * Says the two things the user cannot work out from the rows in front of them: that
 * the file is not all here, and that the search box only sees what is. The second is
 * the real cost of this design — a filter is applied in the webview, over the rows it
 * holds — and leaving it unsaid would make a search that finds nothing read as a
 * broken table rather than a short one.
 *
 * Unlike rowCapBanner this does NOT name a total, because nothing counted one: the
 * whole point of the plan is to stop walking at the budget. It names the rows that
 * can still grow instead, which is the number the user can act on.
 *
 * Nothing deferred gives the parse's own banner back unchanged — so a file under the
 * budget shows exactly the banner it showed before this existed, or none. That is also
 * what lets `rowCapBanner` compose over this one in the read-only view's fallback
 * (BinaryEditorProvider), where a payload too large to post is cut to the cap: there
 * the cut leads, because rows that are not in the view at all are the bigger news.
 */
export function lazyRowsBanner(
  plan: Pick<RowPlan, 'deferred'> | undefined,
  parse: WarningBanner | undefined,
): WarningBanner | undefined {
  const deferred = plan?.deferred ?? 0;
  if (deferred <= 0) {
    return parse;
  }
  const below = parse ? [parse.headline, ...parse.details] : [];
  const rows = deferred.toLocaleString('en-US');
  return {
    headline:
      `This file is too large to load at once: ${rows} of these rows load their contents ` +
      'when you expand them.',
    details: ['The search box and the column sort cover the rows that are loaded.', ...below],
  };
}
