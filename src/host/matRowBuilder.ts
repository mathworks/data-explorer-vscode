// Copyright 2026 The MathWorks, Inc.
// Row builder for .mat files. Unlike sldd/model, a MatNode has variables as
// direct children (no section layer). Each variable is a top-level row; struct
// and other nested fields are flattened via the node's own flatten()/toRow().
import { stampMatrix } from './matrixPayload.js';

export function buildMatRows(matNode: any): any[] {
  const rows: any[] = [];
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
      if (row) rows.push(stampMatrix(row, n));
    }
  }
  return rows;
}
