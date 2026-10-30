// Copyright 2026 The MathWorks, Inc.
//
// diskConflict.ts's EditStackMirror, the copy of VS Code's dirty flag the disk watcher and the save
// read, is view's EditStackIndex under the name it had here, until the suites that know it by that
// name are rebalanced onto view's (step 6b, V6).
import { describe, expect, it } from 'vitest';
import { EditStackIndex } from 'data-explorer-view/host';
import { EditStackMirror } from '../src/host/diskConflict.js';

describe("diskConflict's EditStackMirror", () => {
  it("is view's EditStackIndex, the class the editors on view's engines are given", () => {
    expect(EditStackMirror).toBe(EditStackIndex);
  });
});
