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
// different routes: the COMPRESSED path (core's `scanSldd`) pulls the array out of
// parsed binary content and the textual path out of JSON, so each hands over whatever
// it found.
import { isJsonTextBytes, normalizeRefNames, refBasename } from 'data-explorer-core';
import { scanSldd } from './slddContent.js';

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

/**
 * A dictionary's references from its BYTES, in whichever of the two on-disk formats they
 * hold — the one extraction, for anyone holding the bytes.
 *
 * Its production caller is now the shared cheap tier, which records these on a dictionary's
 * artifact and hands the artifact to everything downstream (sourceCache.ts). It stays a
 * separate function rather than folding into that one caller because it is the answer any
 * bytes-in-hand caller needs, and the alternative is that caller writing its own: the tree's
 * shaper did exactly that, re-deriving from bytes what the cache had already computed, until
 * it was reduced to taking the artifact (structuralIndex.ts). Two spellings of "read the
 * reference list" is the shape the drift in this file's header took, and the formats are
 * exactly where it hid.
 *
 * RAW, and that is the point of keeping it separate from the summary the same bytes also
 * produce. Core's `DataSummary.slddRefs` is `refs.map(refBasename)` — lowercased and stripped
 * of directories — which resolves identically (RelGraph resolves through `refBasename` too,
 * and it is idempotent) but is not what a reference SAYS. The tree renders an unresolved
 * reference as a row labelled with the string itself, so a dictionary naming
 * `shared/Common.sldd` must not be reported as missing `common.sldd`: that is a file the user
 * cannot search for and a directory the message has silently dropped.
 *
 * WHICH format the bytes are is core's question, asked with core's own sniff. This host used
 * to test for the zip magic itself, which is the same rule written a second time, and the two
 * did not agree on a textual dictionary that leads with a BOM.
 *
 * Throws what `scanSldd` throws — a dictionary the read could not recover is a failure, not an
 * empty dictionary (slddContent.ts). The cheap tier catches and answers "no references" for it,
 * which is what a workspace-wide pass has always done with a file it cannot read.
 */
export function refsFromSlddBytes(bytes: ArrayBuffer): string[] {
  const u8 = new Uint8Array(bytes);
  // A textual dictionary takes the regex above and not `scanSldd`, which would `JSON.parse`
  // the whole file to read one array: 52.6 ms against 3.7 ms on a 20 MB one. Compressed, the
  // scan IS the cheap read — it streams the reference objects out of `data/chunk0.xml`
  // without building the entry tree.
  if (isJsonTextBytes(u8)) return extractReferences(new TextDecoder().decode(u8));
  return scanSldd(bytes).refs;
}

