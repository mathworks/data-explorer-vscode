// Copyright 2026 The MathWorks, Inc.
// Row builder for .mat files. Unlike sldd/model, a MatNode has variables as
// direct children (no section layer). Each variable is a top-level row; struct
// and other nested fields are flattened via the node's own flatten()/toRow().
import { RowCellPool } from 'data-explorer-core';
import { stampMatrix } from './matrixPayload.js';

export function buildMatRows(matNode: any): any[] {
  const rows: any[] = [];
  // One cell pool per build, on the same terms as buildRows' — see the note there. This
  // builder has no partial-repaint caller, so it owns its pool outright rather than taking
  // one: every call materializes the whole table.
  const pool = new RowCellPool();
  const variables = (matNode.children ?? []) as any[];
  for (const variable of variables) {
    const flat = variable.flatten ? variable.flatten() : [variable];
    for (const n of flat) {
      let row: any;
      try {
        row = n.toRow();
      } catch {
        continue;
      }
      // Same grid-view stamp as the sldd/slx builder — see test/matrixStamp.test.ts,
      // which asserts the rule against both builders so they cannot drift.
      if (row) rows.push(pool.share(stampMatrix(row, n)));
    }
  }
  return rows;
}
