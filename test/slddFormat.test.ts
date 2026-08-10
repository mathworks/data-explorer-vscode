// Copyright 2026 The MathWorks, Inc.
// Content-format detection that routes .sldd to the right editor: editable JSON
// → text-backed table view (native undo/redo); zip/binary → read-only view.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isZipBytes,
  isEditableJsonSlddBytes,
  exceedsTextSyncLimit,
  exceedsStringDecodeLimit,
  TEXT_SYNC_LIMIT,
  STRING_DECODE_LIMIT,
} from '../src/host/slddFormat.js';

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

describe('exceedsTextSyncLimit (large-file routing guard)', () => {
  it('is false for a small file (opens in the editable table view)', () => {
    expect(exceedsTextSyncLimit(new TextEncoder().encode('{}'))).toBe(false);
  });

  it('is false exactly at the limit (boundary: <= limit stays editable)', () => {
    // A real allocation this large is wasteful; fake the length VS Code measures.
    expect(exceedsTextSyncLimit({ length: TEXT_SYNC_LIMIT } as Uint8Array)).toBe(false);
  });

  it('is true one byte past the limit (routes to the read-only view)', () => {
    expect(exceedsTextSyncLimit({ length: TEXT_SYNC_LIMIT + 1 } as Uint8Array)).toBe(true);
  });

  it('matches VS Code TextModel._MODEL_SYNC_LIMIT (50 MB)', () => {
    // If VS Code ever changes this constant, this test flags that our routing
    // threshold has drifted from it. See slddFormat.ts for why they must agree.
    expect(TEXT_SYNC_LIMIT).toBe(50 * 1024 * 1024);
  });
});

describe('exceedsStringDecodeLimit (undecodable-file routing guard)', () => {
  it('is false for a small file', () => {
    expect(exceedsStringDecodeLimit(new TextEncoder().encode('{}'))).toBe(false);
  });

  it('is false exactly at the limit (boundary: <= limit is still decodable)', () => {
    expect(exceedsStringDecodeLimit({ length: STRING_DECODE_LIMIT } as Uint8Array)).toBe(false);
  });

  it('is true one byte past the limit (routes to the plain text editor)', () => {
    expect(exceedsStringDecodeLimit({ length: STRING_DECODE_LIMIT + 1 } as Uint8Array)).toBe(true);
  });

  it('matches V8 max string length (0x1fffffe8)', () => {
    expect(STRING_DECODE_LIMIT).toBe(0x1fffffe8);
  });

  it('treats content above the decode limit as NOT editable JSON (no decode attempt)', () => {
    // Above V8's limit, a real decode would throw; isEditableJsonSlddBytes must
    // short-circuit to false instead of throwing. Fake the length cheaply.
    expect(isEditableJsonSlddBytes({ length: STRING_DECODE_LIMIT + 1 } as Uint8Array)).toBe(false);
  });
});
