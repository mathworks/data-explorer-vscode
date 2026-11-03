// Copyright 2026 The MathWorks, Inc.
//
// A `.slx` model's document on the MAT-file engine (matDocument.ts): its Model Workspace, which core
// edits by a MAT-file's rules (view's MODEL_FILE), the table the whole model, and a save the model's
// package with its workspace part written anew. Its Usage column is a model's: its blocks' parameters
// and its workspace variables' users.
import { MODEL_FILE } from 'data-explorer-view/host';
import { annotateModelRows, annotateModelRowsNow } from './usageGraph.js';
import type { DocumentKind } from './matDocument.js';

export const MODEL_DOCUMENT: DocumentKind = {
  file: MODEL_FILE,
  fill: (uri, rows) => annotateModelRows(uri, rows),
  fillNow: (uri, rows) => void annotateModelRowsNow(uri, rows),
};
