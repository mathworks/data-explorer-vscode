// Copyright 2026 The MathWorks, Inc.
// Where this host gets its .sldd reference vocabulary: core's, re-exported, and nothing else.
//
// WHAT a reference is, and what key two spellings of one file agree on, are both core's — it
// reads the same field to resolve a dictionary's sub-dictionaries and to build its usage index,
// so a copy here would be a second opinion about the same bytes. This host had one, and the
// object form was the drift that proved it: a reference is a bare string ("common.sldd") in a
// compressed dictionary and can be an object carrying a `file` field
// ({ "file": "common.sldd", ... }) in a textual one, and for a long time core's session resolver
// read only the first while this read both. Now there is one reading, published for exactly this
// caller (core v1.6.0).
//
// THE EXTRACTION ITSELF IS GONE FROM HERE, and that is the end of a longer version of the same
// story. This module used to own `refsFromSlddBytes` — core's format sniff in front of a regex
// for a textual dictionary (`/"Dictionary References"\s*:\s*(\[[^\]]*\])/`) and `scanSldd` for a
// compressed one — because a regex was cheaper than `JSON.parse`ing a 20 MB file to read one
// array. Two things then made it dead weight. Core's `scanSldd` came to answer the references,
// the entry names AND the usage summary from ONE read of either format, so the cheap tier scans
// each dictionary once and keeps all three (sourceCache.ts) and the regex was not saving a read,
// it was adding one. And the regex was the only reader here that could DISAGREE with the others:
// its negated class stops at the first `]`, so a reference array holding a nested array truncated
// the capture, `JSON.parse` threw, and the tree drew no edge for a dictionary whose usage scope
// still followed the reference. One rule on two paths, which is this repo's recurring bug class,
// in the form where the two paths do not even read the same bytes the same way.
//
// `normalizeRefNames` takes `unknown` because the two .sldd formats reach it by different
// routes inside core: the compressed path pulls the array out of parsed binary content and the
// textual path out of JSON, so each hands over whatever it found.
export { normalizeRefNames, refBasename } from 'data-explorer-core';
