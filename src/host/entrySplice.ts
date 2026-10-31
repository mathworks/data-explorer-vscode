// Copyright 2026 The MathWorks, Inc.
//
// Where in a JSON .sldd's text a given entry lives: core's finders (data-explorer-core's
// entrySplice), which this file was word for word. Re-exported under the names this extension's
// tests and structuralEdit.ts import until they are rehomed (step 6b's V4 and V6); the JSON
// editor's engine (view's JsonEngine) uses core's directly.
//
// `findEntryElementSpan` here is the JSON one, which core exports as `findJsonEntryElementSpan`:
// core's own `findEntryElementSpan` is the binary dictionary's (its XML finder).
export {
  detectIndent,
  findEntriesArrayInsertion,
  findEntrySpan,
  findJsonEntryElementSpan as findEntryElementSpan,
  indentBefore,
} from 'data-explorer-core';
