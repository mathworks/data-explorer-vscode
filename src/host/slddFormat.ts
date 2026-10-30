// Copyright 2026 The MathWorks, Inc.
//
// Pure content-format detection for .sldd routing: core's (data-explorer-core's slddFormat), which
// this file was word for word. A .sldd is either editable JSON (→ text-backed table view with
// native undo/redo) or a zip/binary archive; a JSON one too large for the extension host to sync
// as a TextDocument opens read-only. Re-exported under the names extension.ts, the binary
// providers and this extension's tests import until they are rehomed (step 6b's V6).
export {
  STRING_DECODE_LIMIT,
  TEXT_SYNC_LIMIT,
  exceedsStringDecodeLimit,
  exceedsTextSyncLimit,
  isEditableJsonSlddBytes,
  isZipBytes,
  parsesAsJson,
} from 'data-explorer-core';
