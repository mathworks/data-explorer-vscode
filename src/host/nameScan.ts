// Copyright 2026 The MathWorks, Inc.
// One file's entry NAMES, over the shared source cache — and the one thing this scan must
// never share, which is an unsaved buffer.
//
// Split out of nameIndex.ts (which owns the index itself, the glob and the vscode I/O) for the
// reason the nameIndex->nameExtract and sourceReads->sourceCache splits already give: what is
// decided here is where a name comes FROM, and that decision is the one at risk. It is
// vscode-free so the counts and the poisoning rule below are pinned in the fast suite
// (nameScan.test.ts) rather than only in the integration suite.
//
// WHAT IS SHARED, AND WHAT IS NOT
//
//   model  the whole `parseModel`, through the cache. Search needs BLOCK names, and a block
//          name exists nowhere cheaper: `namesFromSlx` reads `parsed.blockParamUsages`, which
//          is the parser's output and not a scannable header. A cheap block-name scanner is an
//          explicit non-goal of this design, so this phase SHARES that parse rather than
//          removing it — the first global search over a folder still parses every model in it
//          ONCE, but no longer re-parses the ones a tab or a dictionary's usage scope already
//          parsed, and every model it does parse is there for the next tab for free. Both
//          directions come from the same fact: `parsedModelOf` is the only place this host
//          parses a model.
//   .sldd  its own `scanSldd`, NOT the cheap tier's `FileSummaries`, even though that summary
//   .mat   also carries names and is often already in hand. `DataSummary.names` is a `Set`,
//          and one dictionary legitimately holds two entries with the same name — Design and
//          Other Data are separate namespaces, so pasting `Array` from one into the other
//          keeps the name (duplicateNameIdentity.test.ts). This index's contract is one record
//          per OCCURRENCE, so consuming a deduped set would silently drop search hits, and a
//          lost hit is a much worse outcome than a duplicate read. The refusal policies differ
//          too: `slddContent.scanSldd` refuses a dictionary the read could not recover, where
//          core's `summarizeFiles` answers an empty one.
//
// THE DIRTY BUFFER LAYERS OVER THE CACHE, AND NEVER INTO IT
//
// `reader.dirtyBytes` is an open document's UNSAVED text, which the index prefers over disk so
// that renaming an entry in an open `.sldd` stops search offering the old name (nameIndex.ts
// tells that story). The cache reads DISK ONLY and keys every entry on the disk file's
// `mtime:size`, so a file with an unsaved buffer bypasses it in BOTH directions:
//
//   * it takes no hit — a cached parse is the SAVED content, i.e. exactly the stale name the
//     override exists to avoid;
//   * it writes no entry — and this is the rule that matters most here. A disk version key
//     cannot tell saved content from unsaved, so buffer bytes stored under one would be served
//     to every other consumer of the cache (a tab's rows, a Usage summary) as though they were
//     the file, and no `stat` could ever notice: the entry would never self-heal, because the
//     version it claims is the version on disk.
//
// A dirty document is only ever a textual `.sldd` in this extension — models open in the
// read-only `BinaryEditorProvider` (a `CustomDocument`, never a `TextDocument`) and the
// writable binary editor keeps its edits in its own edit stack — but nothing below depends on
// that. A model force-opened in VS Code's own text editor and edited is a dirty document too,
// and the rule holds for it unchanged: parse the buffer, cache nothing.
import { isMatFile, isModelFile, isSlddFile, parseModel, scanMat } from 'data-explorer-core';
import { basename } from '../common/pathUtil.js';
import { namesFromMat, namesFromSldd, namesFromSlx, type NameRecord } from './nameExtract.js';
import { scanSldd } from './slddContent.js';
import {
  parsedModelOf,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from './sourceCache.js';

/**
 * How this scan reads: the shared cache's own reader, plus the one source the cache has no
 * concept of.
 *
 * `dirtyBytes` is SYNCHRONOUS on purpose. The override has to be decided before anything is
 * read, so that a cached parse is not taken for a file whose buffer disagrees with disk; an
 * async lookup would let the decision land after an `await` and invite exactly that ordering.
 * `null` means "nothing unsaved is open for this file", which is the common case and the one
 * that reaches the cache.
 */
export interface NameReader extends SourceReader {
  dirtyBytes(file: SourceFile): ArrayBuffer | null;
}

/**
 * One file's name records — NAMES ONLY, and nothing about how they resolve.
 *
 * Any read or parse failure contributes nothing: a corrupt or unreadable file is still a file
 * the tree lists and a tab opens, it just has no names to offer. That is why the single `catch`
 * is silent, and it is the same answer an undecodable file could give anyway.
 */
export async function namesOfFile(
  cache: SourceCache,
  reader: NameReader,
  file: SourceFile,
): Promise<NameRecord[]> {
  const { path, uriString } = file;
  try {
    const dirty = reader.dirtyBytes(file);
    if (isModelFile(path)) {
      // The label only — core's `parseModel` decides the format from the BYTES — and it lands
      // in `parsed.name`, which no name record reads.
      const parsed = dirty
        ? parseModel(dirty, basename(path))
        : await parsedModelOf(cache, file, await reader.version(file), () => reader.bytes(file));
      return parsed ? namesFromSlx(parsed, uriString) : [];
    }
    // Unreadable or too large to scan: no names. The cap is `readForScan`'s, and a file above
    // it cannot be decoded at all, so waiting longer would not help (see scanRead.ts).
    const bytes = dirty ?? (await reader.bytes(file));
    if (!bytes) return [];
    if (isMatFile(path)) {
      // Scanned, not parsed — and no wrapper is needed here, unlike `scanSldd`: core's MAT
      // scanner refuses every doubt and hands the file to `parseMat`, so a file the full parser
      // rejects still throws (into the catch below) and a file it repairs still yields the
      // repaired names. The only thing lost is `parseMat`'s warnings, which this index never
      // read.
      return namesFromMat(scanMat(bytes).names, uriString);
    }
    if (isSlddFile(path)) {
      // Scanned, not parsed: this index wants one string per entry and used to build a whole
      // DOM to get them. Same refusal policy either way — see slddContent.ts — so an unreadable
      // dictionary still throws and still contributes nothing, via the catch below.
      return namesFromSldd(scanSldd(bytes).names, uriString);
    }
  } catch {
    /* unreadable/corrupt file contributes nothing */
  }
  return [];
}
