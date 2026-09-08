// Copyright 2026 The MathWorks, Inc.
// Cheap, dependency-free extraction of a .sldd's dictionary references.
//
// The tree only needs the reference graph, not the entries. Parsing the whole
// dictionary into the datamodel just to read its footer is wasteful, so we scan
// for the "Dictionary References" array with a regex (the same shape
// StreamParser.parseFooter uses) and normalise each ref to a name string.
//
// WHAT a reference is, and what key two spellings of one file agree on, are both
// core's — it reads the same field to resolve a dictionary's sub-dictionaries and to
// build its usage index, so a copy here would be a second opinion about the same
// bytes. This host had one, and the object form was the drift that proved it: a
// reference is a bare string ("common.sldd") in a compressed dictionary and can be an
// object carrying a `file` field ({ "file": "common.sldd", ... }) in a textual one, and
// for a long time core's session resolver read only the first while this read both.
// Now there is one reading, published for exactly this caller (core v1.6.0).
//
// `normalizeRefNames` takes `unknown` because the two .sldd formats reach it by
// different routes: the COMPRESSED path (structuralIndex.buildGraphSource) pulls the
// array out of parsed binary content and the textual path out of JSON, so each hands
// over whatever it found.
import { normalizeRefNames, refBasename } from 'data-explorer-core';

export { normalizeRefNames, refBasename };

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

