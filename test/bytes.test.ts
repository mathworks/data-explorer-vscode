// Copyright 2026 The MathWorks, Inc.
// Unit tests for the shared byte helpers in src/common/bytes.ts.
import { describe, it, expect } from 'vitest';
import { toArrayBuffer } from '../src/common/bytes.js';

describe('toArrayBuffer', () => {
  it('returns an ArrayBuffer with the same bytes for a full-buffer view', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const ab = toArrayBuffer(src);
    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(ab))).toEqual([1, 2, 3, 4]);
  });

  it('copies only the view when the Uint8Array is a window into a larger buffer', () => {
    // A subarray shares the parent buffer with a non-zero byteOffset and a
    // shorter byteLength — the exact case vscode.workspace.fs.readFile can hand
    // back. The result must be exactly the view's bytes, not the whole buffer.
    const parent = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const view = parent.subarray(2, 5); // [1, 2, 3]
    expect(view.byteOffset).toBe(2);
    const ab = toArrayBuffer(view);
    expect(ab.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(ab))).toEqual([1, 2, 3]);
  });

  it('produces a detached copy — mutating the source does not change the result', () => {
    const src = new Uint8Array([1, 2, 3]);
    const ab = toArrayBuffer(src);
    src[0] = 99;
    expect(Array.from(new Uint8Array(ab))).toEqual([1, 2, 3]);
  });

  it('handles an empty array', () => {
    const ab = toArrayBuffer(new Uint8Array([]));
    expect(ab.byteLength).toBe(0);
  });
});
