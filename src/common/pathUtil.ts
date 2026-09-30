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

/**
 * A project-store path, split into the segments needed to join it onto a base URI.
 *
 * Both separators, because a project written on Windows spells its paths with `\`
 * and the same store opens on macOS — a single unsplit segment would join as one
 * literal filename containing backslashes and resolve to nothing.
 *
 * `..` is deliberately KEPT, not rejected: a project's references legitimately live
 * outside its own root (`../OtherProject/other.prj` is what MATLAB writes), so a
 * guard against escaping the root would break the one section that needs to.
 *
 * Empty segments are dropped, so a doubled or trailing separator resolves the same
 * as the path a user would have typed.
 */
export function projectPathSegments(relPath: string): string[] {
  return relPath.split(/[\\/]/).filter((s) => s.length > 0);
}

/** Basename of a URI string, stripping any `?query` or `#hash` first. */
export function uriBasename(uriString: string): string {
  return basename(uriString.split(/[?#]/)[0]);
}
