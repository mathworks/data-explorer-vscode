// Copyright 2026 The MathWorks, Inc.
//
// WHERE A DICTIONARY KEEPS ITS ENTRIES — this host's mirror of the names core owns.
//
// A `.sldd` holds every entry in one part, spelled two ways: a zip member in a
// compressed-binary dictionary, and a nested JSON key path in a textual one. Core names
// both for its reader and its writer. This host has to name them too, because it owns the
// open DOCUMENT that core cannot touch — the other zip members it must preserve
// byte-for-byte while replacing exactly one, and the raw JSON text it splices byte offsets
// into rather than re-serializing.
//
// So these are a mirror, not a second opinion: the strings have to be identical or a save
// from this host produces a package core reads back as a different dictionary. That is
// pinned in test/slddParts.test.ts against the pinned core's BEHAVIOUR rather than against
// a shared string, which is the only pin available while the pin itself has not moved — core
// publishes `DATA_PART_XML` and friends as of the version after it. When it moves, this file
// becomes a re-export and those tests are what say the switch changed nothing.
//
// Pure, and in `common/` for that reason: its one hot-path caller is a scanner that imports
// nothing else, and it must not acquire the read policy's dependency on core to ask what a
// key is called.

/**
 * The zip member a compressed-binary `.sldd` keeps its entries in.
 *
 * The writable-binary editor looks the member up, EXCLUDES it from the pass-through parts,
 * and re-inserts it on save — four places, each of which used to spell the name itself: two
 * lookups, one exclusion (written once, though `passThroughParts` is called from two
 * sites), one re-insert, plus the error message that names the missing member. The
 * three roles are one rule, and drift between them does not throw: an exclusion that misses
 * ships a zip carrying the entries twice, once under the name a reader looks up and once
 * under a name nothing reads, from a file that opens perfectly at both ends.
 */
export const DATA_PART_XML = 'data/chunk0.xml';

/**
 * The same part inside a DESERIALIZED dictionary: the three keys to walk to reach the object
 * holding `entries`, which is the shape both on-disk formats read into.
 *
 * A reader holding the parsed object should call core's `slddChunkContent` instead, and
 * every one in this host now does. This exists for the single caller that cannot — the
 * byte-offset scanner walks the RAW TEXT to find where the entries array SITS, so it needs
 * the key strings and never has an object to hand over.
 */
export const CONTENT_PART_PATH = ['__MW_TEXT_PARTS__', '__MW_TEXT_PART__/data/chunk0', '__MW_TEXT_content'] as const;
