// Copyright 2026 The MathWorks, Inc.

// Browser-safe nonce generation. Uses the Web Crypto API (`crypto.getRandomValues`),
// which is available both in the Node.js extension host (Node 20+ exposes a global
// `crypto`) and in the browser web-extension host (a Web Worker), avoiding a
// dependency on the Node-only `crypto` module.
export function getNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
