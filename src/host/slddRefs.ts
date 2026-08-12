// Copyright 2026 The MathWorks, Inc.
// Cheap, dependency-free extraction of a .sldd's dictionary references.
//
// The tree only needs the reference graph, not the entries. Parsing the whole
// dictionary into the datamodel just to read its footer is wasteful, so we scan
// for the "Dictionary References" array with a regex (the same shape
// StreamParser.parseFooter uses) and normalise each ref to a name string.
//
// A reference is stored either as a bare string ("common.sldd") or as an object
// carrying a `file` field ({ "file": "common.sldd", ... }).
export { refBasename } from '../common/pathUtil.js';

/** Extract the referenced dictionary names from raw .sldd text. */
export function extractReferences(text: string): string[] {
  const match = text.match(/"Dictionary References"\s*:\s*(\[[^\]]*\])/);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return [];
  }
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

