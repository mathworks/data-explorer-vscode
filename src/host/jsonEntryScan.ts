// Copyright 2026 The MathWorks, Inc.
//
// Which entry of a JSON .sldd a text change landed in, found by scanning the text: core's
// (data-explorer-core's jsonEntryScan), which this file was word for word. Re-exported under the
// names this extension's tests import until they are rehomed (step 6b's V6); the JSON editor's
// engine (view's JsonEngine) uses core's directly.
export {
  findEntriesArrayStart,
  indexEntries,
  locateChangedEntry,
  scanEntries,
  type ChangeRegion,
  type EntriesIndex,
  type EntryElementSpan,
  type EntryScan,
} from 'data-explorer-core';
