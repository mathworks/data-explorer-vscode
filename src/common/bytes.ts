// Copyright 2026 The MathWorks, Inc.
// Shared byte helpers used across the extension host.

/**
 * Copy a `Uint8Array` view into a standalone `ArrayBuffer` holding exactly the
 * view's bytes. `vscode.workspace.fs.readFile` returns a `Uint8Array` that may
 * be a window into a larger pooled buffer (non-zero `byteOffset`, shorter
 * `byteLength`), so `.buffer` alone can carry extra bytes. Slicing on the view's
 * offset+length yields precisely the file's bytes as a fresh, detached buffer —
 * the shape the vendored binary parsers expect.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
