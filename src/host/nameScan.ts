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
//   .sldd  the cheap tier's `Cheap.names` — the SCAN's own name list, which that tier now keeps
//   .mat   beside the summary it reduces from it (sourceCache.ts). So a folder this index walks
//          costs one scan per file whoever asked for it first, and the tree's or the usage
//          plan's pass over the same folder pays for this one.
//
//          It reads `names` and NOT the summary, and the distinction is the whole reason that
//          field exists. `DataSummary.names` is a `Set` of the non-empty names, and one
//          dictionary legitimately holds two entries with the same name — Design and Other Data
//          are separate namespaces, so pasting `Array` from one into the other keeps the name
//          (duplicateNameIdentity.test.ts). This index's contract is one record per OCCURRENCE,
//          so consuming a deduped set would silently drop search hits. `Cheap.names` is the
//          array the Set was built from: one string per entry, in file order, so nothing is
//          deduped and nothing is copied — the strings here and the strings in the summary are
//          the same objects.
//
//          This used to be its own `scanSldd`/`scanMat` of its own read, on the ground that the
//          summary could not give the occurrences back. That was true of the summary and never
//          true of the scan, so what the argument actually justified was the cheap tier keeping
//          the scan's own answer — which it now does. The refusal policies converged with it: a
//          dictionary the read cannot recover throws inside that tier, which answers an empty
//          artifact for it, so this index gets an empty name list where it used to catch a throw
//          of its own. Same `[]`, one read (nameScan.test.ts pins it over a corrupt fixture).
//
// THE DIRTY BUFFER LAYERS OVER THE CACHE, AND NEVER INTO IT
//
// `reader.dirtyBytes` is an open document's UNSAVED text, which the index prefers over disk so
// that renaming an entry in an open `.sldd` stops search offering the old name (nameIndex.ts
// tells that story). The cache reads DISK ONLY and keys every entry on the disk file's
// `mtime:size`, so a file with an unsaved buffer bypasses it in BOTH directions:
//
//   * it takes no hit — a cached parse or scan is the SAVED content, i.e. exactly the stale name
//     the override exists to avoid;
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
// and the rule holds for it unchanged: scan or parse the buffer, cache nothing.
import { isMatFile, isModelFile, isSlddFile, parseModel, scanMat } from 'data-explorer-core';
import { basename } from '../common/pathUtil.js';
import { namesFromMat, namesFromSldd, namesFromSlx, type NameRecord } from './nameExtract.js';
import { scanSldd } from './slddContent.js';
import {
  cheapOne,
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
    // The unsaved buffer is scanned HERE and cached nowhere, for the reason the header gives:
    // the cache keys everything on the disk file's `mtime:size`, which cannot tell saved
    // content from unsaved. Both scanners are the same ones the cheap tier runs on the disk
    // bytes below — `scanSldd` under this host's refusal policy (slddContent.ts), `scanMat`
    // needing no wrapper because core's MAT scanner hands anything it doubts to `parseMat` — so
    // a buffer and a saved file yield the same records, and a buffer that will not scan throws
    // into the catch below and contributes nothing.
    if (dirty) {
      if (isMatFile(path)) return namesFromMat(scanMat(dirty).names, uriString);
      if (isSlddFile(path)) return namesFromSldd(scanSldd(dirty).names, uriString);
      return [];
    }
    // The SHARED scan of the disk bytes. No artifact means no names, and it covers what this
    // used to check for itself: a file the reader will not version or will not read — too large
    // to scan (the cap is `readForScan`'s, and a file above it cannot be decoded at all, so
    // waiting longer would not help — see scanRead.ts), unreachable, or an extension that tier
    // has no reader for.
    const cheap = (await cheapOne(cache, reader, file))?.cheap;
    if (cheap?.kind === 'mat') return namesFromMat(cheap.names, uriString);
    if (cheap?.kind === 'sldd') return namesFromSldd(cheap.names, uriString);
  } catch {
    /* unreadable/corrupt file contributes nothing */
  }
  return [];
}
