// Copyright 2026 The MathWorks, Inc.
// Cheap, dependency-free extraction of a .sldd's dictionary references.
//
// The tree only needs the reference graph, not the entries. Parsing the whole
// dictionary into the datamodel just to read its footer is wasteful, so we scan
// for the "Dictionary References" array with a regex (the same shape
// StreamParser.parseFooter uses) and normalise each ref to a name string.
export { refBasename } from '../common/pathUtil.js';

/**
 * Normalise a "Dictionary References" array to plain name strings, dropping any
 * element that carries no usable name.
 *
 * A reference is stored either as a bare string ("common.sldd") or as an object
 * carrying a `file` field ({ "file": "common.sldd", ... }).
 *
 * Takes `unknown` because it is shared with the COMPRESSED .sldd path
 * (structuralIndex.buildGraphSource), which pulls the same array out of parsed
 * binary content rather than out of JSON text and so hands over whatever it
 * found. The two .sldd formats must agree on what a reference means; this ran as
 * two separate copies of the normalisation, where a fix to one would silently
 * leave the other format resolving references differently.
 */
export function normalizeRefNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const ref of raw) {
    const name =
      typeof ref === 'string'
        ? ref
        : ref && typeof ref === 'object'
          ? (ref as Record<string, unknown>).file
          : undefined;
    if (typeof name === 'string' && name) names.push(name);
  }
  return names;
}

/** Extract the referenced dictionary names from raw .sldd text. */
export function extractReferences(text: string): string[] {
  const match = text.match(/"Dictionary References"\s*:\s*(\[[^\]]*\])/);
  if (!match) return [];
  try {
    return normalizeRefNames(JSON.parse(match[1]));
  } catch {
    return [];
  }
}

