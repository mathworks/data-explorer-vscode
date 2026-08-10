// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) grammar for Usage-column link targets, split out from
// navigate.ts so it can be unit-tested under vitest.
//
//   blocks:<name>@<source>     data row -> a block that uses the variable
//   workspace:<name>@<source>  block row -> a model-workspace param
//   <name>@<source>            block row -> a dictionary/MAT variable
//
// <name> is a block or param name; <source> is a full uriString (when the
// emitter knows it) or a bare basename. lastIndexOf('@') is used so a uriString
// source (e.g. file:///a.slx) splits correctly — names never contain '@'.

// Parse a target into { name, source }, or null when malformed.
export function parseNavTarget(target: string): { name: string; source: string } | null {
  let rest = target;
  if (target.startsWith('blocks:')) rest = target.slice('blocks:'.length);
  else if (target.startsWith('workspace:')) rest = target.slice('workspace:'.length);
  const at = rest.lastIndexOf('@');
  if (at < 0) return null;
  const name = rest.slice(0, at);
  const source = rest.slice(at + 1);
  if (!name || !source) return null;
  return { name, source };
}

// Model Reference / External Data links use a different, simpler grammar than
// Usage links: their target is a bare filename (e.g. "plant.slx", "signals.mat",
// "common.sldd") that just means "open this file" — there is no row inside it to
// select. These carry NO '@source' suffix, so parseNavTarget rejects them.
// Return the basename to open, or null when the target is a Usage-link (has an
// '@') that parseNavTarget should handle instead.
export function parseFileTarget(target: string): string | null {
  if (!target || target.includes('@')) return null;
  return target;
}
