// Copyright 2026 The MathWorks, Inc.
//
// THE ONE ANSWER TO `requestMatrix`, SHARED BY ALL FOUR WEBVIEW HOSTS.
//
// A row carries a MatrixDescriptor — name, class, shape, node id — and no cells. The
// cells arrive only when a Variable Editor panel actually opens, because a 1000x1000
// entry is 4 MB of cell strings and ~240 ms to produce, paid per row stamped rather
// than per panel opened. See matrixPayload.ts.
//
// Three table providers and the Property Inspector all open that panel, which makes
// this the shape of defect this codebase keeps relearning: one rule, four paths. So
// the answer is ONE function, view's answerMatrixRequest / matrixCellsMessage, whose
// contract view proves (test/answerMatrixRequest.test.ts): the cells the ROW's own rule
// produces, the nodeId echoed, and a failure spoken rather than silent. What this file
// owns is that every host here answers through it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('every host that answers requestMatrix answers it from here', () => {
  // messageDispatch.test.ts pins that the TABLE providers answer it — by a branch of their
  // own, or by the `requestMatrix` handler of their CommonHandlers table (tableDispatch.ts).
  // This pins the other half, and reaches the host it does not cover: that the answer goes
  // through view's builder rather than an envelope of the host's own.
  //
  // The Property Inspector is why that is not automatic. It is handed a node and never
  // learns which document it came from, so it cannot call `answerMatrixRequest` — its page
  // resolves its own node and calls `matrixCellsMessage`. A second envelope written
  // there would be a panel that says something different about the same failure, in
  // the pane most likely to be open beside the table.
  //
  // Each host as [the file with its `requestMatrix` branch, what it answers through]. The
  // inspector's answer is its page's: view's InspectorPage holds the node on display and what the
  // page was sent, and answers through matrixCellsMessage (view's inspectorPage.test.ts).
  const HOSTS: [string, RegExp][] = [
    ['src/host/SlddTextEditorProvider.ts', /answerMatrixRequest|matrixCellsMessage/],
    ['src/host/BinarySlddEditorProvider.ts', /answerMatrixRequest|matrixCellsMessage/],
    ['src/host/MatEditorProvider.ts', /answerMatrixRequest|matrixCellsMessage/],
    ['src/host/BinaryEditorProvider.ts', /answerMatrixRequest|matrixCellsMessage/],
    ['src/host/PropertiesViewProvider.ts', /this\.page\.answerMatrix\(/],
  ];
  const source = (file: string) => readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');

  for (const [file, answers] of HOSTS) {
    it(`${file.replace('src/host/', '')} builds no matrixCells envelope of its own`, () => {
      expect(source(file)).toMatch(/msg\??\.type === 'requestMatrix'|\brequestMatrix: \(nodeId\) => answerMatrixRequest\(/);
      expect(source(file)).toMatch(answers);
      // The literal belongs to view's builder. A host that writes `{ type: 'matrixCells' ... }`
      // itself has started a second rule, whatever it happens to say today.
      const own = [...source(file).matchAll(/'matrixCells'/g)].length;
      expect(own, `${file} spells the matrixCells envelope itself`).toBe(0);
    });
  }
});
