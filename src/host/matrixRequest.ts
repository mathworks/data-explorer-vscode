// Copyright 2026 The MathWorks, Inc.
//
// The one answer to `requestMatrix` — the cells of a Variable Editor panel that is
// opening, fetched rather than stamped.
//
// Every row that owns a grid carries a `MatrixDescriptor` (name, class, shape, node
// id) and no cells. This is where the cells come from when a panel actually opens.
// The reason is a measurement: the 1000x1000 double in a customer dictionary is
// 1,000,000 cell strings, ~4 MB of JSON and ~240 ms to produce, and stamping that
// onto the row meant paying it for a panel nobody opened — once per griddable matrix
// in the file, on every repaint, across a postMessage.
//
// Three table providers and the Property Inspector all open that panel, so this is
// one rule with four call sites: exactly the shape of defect this codebase keeps
// relearning (see test/messageDispatch.test.ts, which is what makes all four wire it
// in). Hence one function here instead of a branch in each chain.
import { findNode } from './SlddModel.js';
import { matrixPayload } from './matrixPayload.js';

/**
 * Just the one method of `vscode.Webview` this needs, structurally. Deliberately not
 * `Pick<vscode.Webview, 'postMessage'>`: importing `vscode` would put this module in
 * the set vitest cannot load (see vitest.config.ts), and the rule it holds is exactly
 * the kind this repo keeps in a vscode-free sibling so it can be tested directly.
 */
interface Poster {
  postMessage(message: unknown): unknown;
}

/**
 * The `matrixCells` envelope for a node, or for the absence of one. The whole of the
 * rule, so that the Property Inspector — which is handed a node and never learns
 * which document it came from, so it cannot use `answerMatrixRequest` below — still
 * answers in the same words. Total: never throws.
 *
 * `node` is the ROW's node, so `matrixPayload` re-runs its own `matrixForRow` here (a
 * property row's matrix lives on its `Value` child). No caller resolves the owner;
 * that rule stays in one place.
 */
export function matrixCellsMessage(nodeId: string, node: any): {
  type: 'matrixCells';
  nodeId: string;
  matrix?: ReturnType<typeof matrixPayload>;
  message?: string;
} {
  let matrix = null;
  try {
    matrix = matrixPayload(node);
  } catch {
    matrix = null;
  }
  // The id is echoed on every path, including the failures: the panel matches the
  // answer against the row it opened on, and drops one that arrives after the user
  // has closed it or opened a different row.
  if (matrix) return { type: 'matrixCells', nodeId, matrix };
  // ONE message for both failures — the node is gone, or it is there and its elements
  // would not lay out — because the panel can act on neither, and naming which would
  // say more about these internals than about the value. The distinction is not lost:
  // `matrixPayload` is the only thing that can tell them apart, and it fails closed by
  // design (see its doc comment).
  return { type: 'matrixCells', nodeId, message: 'This value could not be read as a table.' };
}

/**
 * Answer a webview's `requestMatrix` on the webview it came from. Total: never
 * throws, and always posts exactly one `matrixCells` — a panel that is already open
 * and waiting is worse off with silence than with a reason.
 */
export function answerMatrixRequest(webview: Poster, uriString: string, nodeId: string): void {
  let node = null;
  try {
    node = typeof nodeId === 'string' && nodeId !== '' ? findNode(uriString, nodeId) : null;
  } catch {
    node = null;
  }
  void webview.postMessage(matrixCellsMessage(nodeId, node));
}
