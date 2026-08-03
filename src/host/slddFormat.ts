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

/**
 * True if the bytes are an editable JSON .sldd: not a zip archive AND valid
 * JSON. Binary/zip .sldd and non-JSON content return false (→ read-only view).
 */
export function isEditableJsonSlddBytes(bytes: Uint8Array): boolean {
  if (isZipBytes(bytes)) return false;
  try {
    JSON.parse(new TextDecoder().decode(bytes));
    return true;
  } catch {
    return false;
  }
}
