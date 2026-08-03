// Copyright 2026 The MathWorks, Inc.
// getNonce() feeds the webview Content-Security-Policy (script-src 'nonce-...').
// A weak or malformed nonce weakens the CSP, so these tests pin its shape: a
// 32-char lowercase-hex string (16 random bytes) that differs across calls and
// uses only the Web Crypto API (so it works in both the Node host and the
// browser web-extension worker).
import { describe, it, expect } from 'vitest';
import { getNonce } from '../src/host/nonce.js';

describe('getNonce', () => {
  it('returns 32 hex characters (16 bytes)', () => {
    expect(getNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces a fresh value on each call', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => getNonce()));
    // 100 draws from a 128-bit space must not collide.
    expect(nonces.size).toBe(100);
  });

  it('emits lowercase hex only (no uppercase, no separators)', () => {
    const n = getNonce();
    expect(n).toBe(n.toLowerCase());
    expect(n).not.toMatch(/[^0-9a-f]/);
  });
});
