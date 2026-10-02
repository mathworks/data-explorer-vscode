// Copyright 2026 The MathWorks, Inc.
//
// The one answer to `requestChildren` — the rows under a row whose children the
// payload deferred.
//
// The other half of lazyRows.ts. A payload planned to a row budget stops at whole
// levels and stamps the frontier with `_lazy`; this is where the next level comes
// from when the user opens one. Written as one module for the same reason
// matrixRequest.ts is: the asking and the answering are one rule, and a webview
// whose twisty asks a host that does not answer is a tree that silently stops
// opening — a failure with no error anywhere.
//
// ALWAYS POSTS, including on every failure path. The table marks the row as fetched
// when the answer arrives, so silence is not a neutral outcome: it leaves a twisty
// that looks live and does nothing for the rest of the session.
import { findNode } from './SlddModel.js';
import { LAZY_ROW_BUDGET } from './lazyRows.js';
import type { RowPlanner } from './rowPlanner.js';
import { postOrReport, type PostTarget } from './postPayload.js';

/**
 * Fill the Usage column of these rows — `usageGraph.annotateDataRows`, passed in rather
 * than imported.
 *
 * That module imports `vscode`, which would put this one in the set vitest cannot load
 * (see vitest.config.ts) and leave the always-posts rule below checkable only through
 * the integration suite. One parameter keeps it a unit test, and the provider that has
 * the dependency anyway is the one that supplies it.
 */
export type UsageFiller = (sourceUri: string, rows: any[]) => Promise<boolean>;

/**
 * The `childRows` envelope for a node, or for the absence of one. Total: never throws.
 *
 * `rows` empty is a real answer, not an error — the node is gone from the session (a
 * repost rebuilt the tree under new ids), or it has no children after all. Either way
 * the table stops offering to fetch, which is the honest outcome: an empty answer is
 * how a row that cannot grow says so.
 *
 * `planner` is the file's, not this module's choice (rowPlanner.ts): the rows a fetch
 * returns have to be the rows the payload would have delivered for the same node, and
 * the only way to be sure of that is for one object to own both.
 *
 * `truncated` counts the children that did not fit AT ALL — no row, nothing to open.
 * One node can be the whole problem (core builds a cell's children uncapped, so a
 * 200,000-element cell is one name), and the rule this implements puts the names first,
 * which makes "some of these names are missing" the one thing the answer must not keep
 * to itself. 0 on every other path, including the failures: an empty answer means the
 * node is gone or has no children, and neither is a loss to report.
 */
export function childRowsMessage(
  nodeId: string,
  node: any,
  planner: RowPlanner,
): { type: 'childRows'; nodeId: string; rows: any[]; truncated: number } {
  let rows: any[] = [];
  let truncated = 0;
  try {
    const built = node ? planner.children(node, LAZY_ROW_BUDGET) : null;
    rows = built?.rows ?? [];
    truncated = built?.plan.truncated ?? 0;
  } catch {
    rows = [];
    truncated = 0;
  }
  // The id is echoed on every path, failures included: the table matches the answer
  // against the row it asked about and drops one whose row a repaint has replaced.
  return { type: 'childRows', nodeId, rows, truncated };
}

/**
 * Answer a webview's `requestChildren` on the webview it came from.
 *
 * The Usage column is filled for these rows exactly as it is for the payload's — by
 * the same `annotateDataRows` the provider hands in, whose graph is built once per
 * source and cached — so a row the user expanded does not show an empty cell where its
 * siblings show their users. Awaited, and then posted whatever came back: a usage graph
 * that fails is worth less than the rows, so its rejection costs the column and not the
 * fetch.
 *
 * Through `postOrReport` like the payload itself, because a fetch is subject to the
 * same undeliverable-message failure the cap exists for — one node with a hundred
 * thousand heavy children is a budget's worth of rows and can still be too large to
 * serialize. A silent rejection here is a twisty that opens onto nothing, which is
 * the hang this whole area is about, scoped to one row.
 */
export async function answerChildRequest(
  webview: PostTarget,
  uriString: string,
  nodeId: string,
  what: string,
  fillUsage: UsageFiller,
  planner: RowPlanner,
): Promise<void> {
  let node = null;
  try {
    node = typeof nodeId === 'string' && nodeId !== '' ? findNode(uriString, nodeId) : null;
  } catch {
    node = null;
  }
  const message = childRowsMessage(nodeId, node, planner);
  if (message.rows.length > 0) {
    await fillUsage(uriString, message.rows).catch(() => false);
  }
  await postOrReport(webview, message, what);
}
