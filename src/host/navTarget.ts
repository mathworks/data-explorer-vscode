// Copyright 2026 The MathWorks, Inc.
// Pure (vscode-free) grammar for Usage-column link targets, and the rule that turns a
// link's source into a document, split out from navigate.ts so both can be unit-tested
// under vitest.
//
//   blocks:<name>@<source>     data row -> a block that uses the variable
//   workspace:<name>@<source>  block row -> a model-workspace param
//   <name>@<source>            block row -> a dictionary/MAT variable
//
// <name> is a param name, or — on the `blocks:` channel — core's block KEY, which
// is the block's SID (`blocks:65@...`) and only falls back to its name for a file
// written before SIDs existed. A block's DISPLAYED name is not in the target and
// need not match it, which is why the selection this resolves to is made against a
// row's `_blockKey` (see table-main.ts). <source> is a full uriString (when the
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

// The two lookups a bare name can go through. `scoped` is the tree's own group-first rule
// (SectionsTreeProvider.resolveReference, which is its FolderHierarchy's): the copy in the
// referrer's project or folder wins. `firstMatch` is a plain workspace search, for when there
// is no referrer to scope by or the tree's graph has no answer.
export type ScopedResolve = (ref: string, referrer: string) => Promise<string | undefined>;
export interface NavSourceLookups {
  scoped?: ScopedResolve;
  firstMatch: (ref: string) => Promise<string | undefined>;
}

// The uriString of the document a link's source names, or undefined when none does.
//
// `source` has already been read back through srcIdToUriString (navigate.ts), so a full uri
// — which every Usage cell the host writes carries — names its document outright. A bare
// name (a Model Reference or External Data file as Simulink recorded it, or the dictionary
// in core's own block -> parameter link when the Usage fill failed) is resolved as the tree
// resolves it, preferring the referrer's own project or folder. A scoped lookup that misses
// or fails falls back to the first workspace match, so a link that opened something before
// still opens something.
export async function resolveNavSource(
  source: string,
  referrer: string | undefined,
  lookups: NavSourceLookups,
): Promise<string | undefined> {
  if (source.includes('://')) return source;
  if (referrer && lookups.scoped) {
    try {
      const scoped = await lookups.scoped(source, referrer);
      if (scoped) return scoped;
    } catch {
      // The tree's graph could not be built; the plain search below still answers.
    }
  }
  return lookups.firstMatch(source);
}
