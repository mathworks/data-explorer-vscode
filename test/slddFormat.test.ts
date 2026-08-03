// Copyright 2026 The MathWorks, Inc.
// Content-format detection that routes .sldd to the right editor: editable JSON
// → text-backed table view (native undo/redo); zip/binary → read-only view.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isZipBytes, isEditableJsonSlddBytes } from '../src/host/slddFormat.js';

function bytesOf(relPath: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(relPath, import.meta.url))));
}

describe('slddFormat routing detection', () => {
  it('detects a JSON .sldd as editable', () => {
    const json = bytesOf('../test-integration/fixtures/workspace/data.sldd');
    expect(isZipBytes(json)).toBe(false);
    expect(isEditableJsonSlddBytes(json)).toBe(true);
  });

  it('detects a zip/binary .sldd as NOT editable', () => {
    const zip = bytesOf('../test-integration/fixtures/workspace/binary.sldd');
    expect(isZipBytes(zip)).toBe(true);
    expect(isEditableJsonSlddBytes(zip)).toBe(false);
  });

  it('treats non-JSON, non-zip bytes as not editable', () => {
    const garbage = new TextEncoder().encode('not json at all {');
    expect(isEditableJsonSlddBytes(garbage)).toBe(false);
  });

  it('recognizes the ZIP local-file-header magic', () => {
    expect(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(isZipBytes(new Uint8Array([0x7b, 0x7d]))).toBe(false); // "{}"
    expect(isZipBytes(new Uint8Array([0x50, 0x4b]))).toBe(false); // too short
  });
});
