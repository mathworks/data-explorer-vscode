// Copyright 2026 The MathWorks, Inc.
// Shared path helpers used across the extension host. These are pure (no vscode
// dependency) and split on both forward- and back-slash so Windows-style paths
// are handled safely without requiring normalisation first.

/** Last segment of a path (splits on both `/` and `\`). Returns `p` if no separator. */
export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Directory portion of a forward-slash path (mirrors graphModel's original dirnameOf). */
export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

// `refBasename` — the basename lower-cased, which is the key two spellings of one file
// agree on — is core's (re-exported by slddRefs.ts). It is the key core's own usage
// index matches references through, so a copy here would be a second opinion about
// whether a model's `Params.SLDD` reaches `params.sldd` on disk.

/** Basename of a URI string, stripping any `?query` or `#hash` first. */
export function uriBasename(uriString: string): string {
  return basename(uriString.split(/[?#]/)[0]);
}
