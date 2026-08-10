// Copyright 2026 The MathWorks, Inc.

// Pure content-format detection for .sldd routing. A .sldd is either editable
// JSON (→ text-backed table view with native undo/redo) or a zip/binary archive
// (→ read-only binary view). Kept VS-Code-free so it is unit-testable.

/** True if `bytes` begins with the ZIP local-file-header magic (PK\x03\x04). */
export function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

// V8 refuses to create a string longer than 0x1fffffe8 (~512 MB) code units, so
// `new TextDecoder().decode(bytes)` THROWS above that — we can neither validate
// nor JSON.parse the content, so no table can be built. (JSON .sldd is ~ASCII,
// so UTF-16 code-unit count ≈ byte length; gating on byte length is safe and
// only conservative for the multibyte case, which .sldd never hits.) Such files
// are routed to the plain text editor instead. Distinct from and larger than
// TEXT_SYNC_LIMIT: 50 MB–512 MB JSON .sldd still renders as a read-only table.
export const STRING_DECODE_LIMIT = 0x1fffffe8;

/** True if `bytes` is too large to decode into a single JS string (V8 limit). */
export function exceedsStringDecodeLimit(bytes: Uint8Array): boolean {
  return bytes.length > STRING_DECODE_LIMIT;
}

/**
 * True if the bytes are an editable JSON .sldd: not a zip archive AND valid
 * JSON. Binary/zip .sldd and non-JSON content return false (→ read-only view).
 * Content too large to decode also returns false (→ handled upstream), so this
 * never attempts a decode that would throw.
 */
export function isEditableJsonSlddBytes(bytes: Uint8Array): boolean {
  if (isZipBytes(bytes)) return false;
  if (exceedsStringDecodeLimit(bytes)) return false;
  try {
    JSON.parse(new TextDecoder().decode(bytes));
    return true;
  } catch {
    return false;
  }
}

// VS Code refuses to mirror a TextDocument larger than TextModel._MODEL_SYNC_LIMIT
// (50 MB) into the extension host. Our editable JSON .sldd table is a
// CustomTextEditorProvider, which depends on that mirror — so past this size,
// resolving it throws "Unable to retrieve document from URI" in the ext host
// before our provider code ever runs, and the table fails to open. Such files
// are routed to the read-only byte-backed view instead (it reads bytes directly
// via workspace.fs, so it isn't subject to the sync limit). Editing is
// impossible above the limit regardless, since VS Code won't sync the document.
//
// VS Code measures the model in UTF-16 code units; we gate on byte length, which
// is always >= the UTF-16 length for UTF-8. So any file kept on the editable path
// (byte length <= limit) is guaranteed to sync — no false downgrades.
export const TEXT_SYNC_LIMIT = 50 * 1024 * 1024;

/** True if `bytes` is too large for VS Code to sync as an editable TextDocument. */
export function exceedsTextSyncLimit(bytes: Uint8Array): boolean {
  return bytes.length > TEXT_SYNC_LIMIT;
}
