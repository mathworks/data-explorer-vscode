// Copyright 2026 The MathWorks, Inc.
// The vscode half of the shared source cache: how a candidate is versioned and read, and the
// ONE cache a window keeps.
//
// The reasoning — the tiers, the version key, why a data file is summarised whether or not
// anyone asked for its names — is all in sourceCache.ts, which is vscode-free so that it can
// be tested over real fixture bytes. This module supplies `readForScan`/`scanVersion` and the
// cache instance, and nothing else: the same split nameIndex->nameExtract and
// searchSources->searchFilter already make here, and it exists so the properties the design
// rests on are pinned in the fast suite rather than only in the integration suite. The one
// thing decided here rather than there is the difference between how a SCAN reads a file and
// how a TAB does — see `parsedModelForTab`.
import * as vscode from 'vscode';
import type { ParsedSlx } from 'data-explorer-core';
import { toArrayBuffer } from '../common/bytes.js';
import { readForScan, scanVersion } from './scanRead.js';
import {
  clearSourceCache,
  forgetSource,
  newSourceCache,
  parsedModelForOpenTab,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from './sourceCache.js';

/**
 * One cache for the window, shared by every consumer that reads the folder.
 *
 * Keyed by content version inside, so it is shared across whatever each consumer happened to
 * ask for: the models `a.sldd`'s usage graph had to read are the models `b.sldd` gets for
 * free, and the tree's pass over the folder is the same pass.
 */
export const sourceCache: SourceCache = newSourceCache();

/**
 * Drop everything held for every file.
 *
 * Not needed for correctness — version keying already refuses a stale entry — but for the
 * case where an entry can no longer be reached to be checked: a workspace folder removed
 * takes its files out of `findFiles`, and their artifacts would otherwise sit here for the
 * rest of the session.
 */
export function clearSources(): void {
  clearSourceCache(sourceCache);
}

/**
 * Drop what the window holds for a file a WATCHER has just reported changing.
 *
 * The reasoning is on `sourceCache.forgetSource`; what belongs here is why the caller is a
 * watcher and nothing else. Version keying covers every write that moves `mtime:size`, so the
 * only writes left are the ones it cannot see — and a `FileSystemWatcher` event is the extension's
 * one piece of evidence that is independent of the `stat`, because it comes from the write rather
 * than from a later look at the file.
 *
 * Exported from the module that OWNS the cache instance, rather than letting the provider reach
 * into the map: `BinaryEditorProvider` is a view, this is the one place a window's cache is named,
 * and a second writer of it would be a second place to keep the pins and the byte accounting
 * right.
 */
export function forgetChangedSource(uri: vscode.Uri): void {
  forgetSource(sourceCache, uri.toString());
}

/** The uris a pass was given, as the cache names files. */
export function sourceFilesOf(uris: readonly vscode.Uri[]): SourceFile[] {
  return uris.map((u) => ({ uriString: u.toString(), path: u.path }));
}

/**
 * The parse of the model at `uri`, shared with every other consumer at this content version.
 *
 * What a TAB calls, and the reason a tab's read is written out here instead of going through
 * `readerFor`: a scan refuses a file over `MAX_SCAN_BYTES` and a tab must not — the user named
 * this file and is waiting for it (see scanRead.ts). So the bytes are read eagerly and whole,
 * and it is only the CACHING that the scan cap governs: an unversionable model is parsed and
 * not kept, because an entry no `stat` can re-check could never be refreshed.
 *
 * DISK bytes, like every other entry in this cache. That is what makes an entry filled here
 * usable by the folder passes and vice versa, and it is safe for exactly one reason: a model
 * has no editable view in this extension. Every model tab is `BinaryEditorProvider`, which is
 * read-only and reads the file, so there is no unsaved buffer for a model that could disagree
 * with what is cached. The editable views are `.sldd` only, they render from the document TEXT,
 * and they do not come through here.
 *
 * Through `parsedModelForOpenTab` rather than `parsedModelOf`, which is the same parse plus the
 * eviction pin — and the difference is this module's to make, because "a TAB asked" is the one
 * thing about a request the vscode-free cache cannot see. It matters here specifically: the
 * folder pass that answers this same tab's Usage column runs immediately after this call and
 * touches every other model in the folder, leaving this one least-recently-used and about to be
 * wanted again. `BinaryEditorProvider` calls this on every post, so the pin follows the active
 * tab without anyone subscribing to tab events. `parsedBudget.test.ts` pins the choice of entry
 * point, since no unit test can load this module to check it by behaviour.
 */
export async function parsedModelForTab(uri: vscode.Uri): Promise<ParsedSlx> {
  const [file] = sourceFilesOf([uri]);
  // The `stat` FIRST, on its own line — it used to be an argument, which got the order right only
  // because an argument is evaluated before the thunk it is passed beside can run. The two
  // directions of getting it wrong are not the same size. A version taken before the bytes can only
  // be OLDER than what was read, so a file written during the read is keyed too old and the next
  // pass that stats it re-reads: self-healing, which is what lets this cache have no invalidation
  // protocol at all. A version taken after the bytes can be NEWER than the content it keys, and
  // then every later pass sees a version that matches and hits forever, on content the file no
  // longer has. Pinned as an order in sourceCache.test.ts, since this module cannot be loaded in
  // the unit suite.
  const version = await scanVersion(uri);
  const parsed = await parsedModelForOpenTab(sourceCache, file, version, async () =>
    toArrayBuffer(await vscode.workspace.fs.readFile(uri)),
  );
  // Unreachable in practice: the thunk above either answers with bytes or throws, and the
  // throw is what the caller turns into its banner. Stated rather than asserted so that a
  // reader of `parsedModelOf`'s nullable answer does not have to trust a `!`.
  if (!parsed) throw new Error(`Could not read ${uri.path}.`);
  return parsed;
}

/**
 * A reader over `uris` — the only files it will answer for, so a cached artifact for a file
 * that has left the folder is never silently refreshed from somewhere else.
 *
 * `readForScan` and `scanVersion` make the same two refusals (oversized, unreadable), one
 * from the bytes and one from the `stat` alone — which is the contract `SourceReader` asks
 * for: a version that cost a read would defeat the cache it keys. See scanRead.ts.
 *
 * No `projectFiles`: reading a project store is a directory walk beside the marker file, and
 * offering one to a consumer that has no use for projects would walk every `.prj` in the
 * folder for nobody.
 */
export function readerFor(uris: readonly vscode.Uri[]): SourceReader {
  const byUri = new Map(uris.map((u) => [u.toString(), u]));
  const uriOf = (file: SourceFile): vscode.Uri | undefined => byUri.get(file.uriString);
  return {
    version: async (file) => {
      const uri = uriOf(file);
      return uri ? scanVersion(uri) : null;
    },
    bytes: async (file) => {
      const uri = uriOf(file);
      if (!uri) return null;
      const bytes = await readForScan(uri);
      return bytes ? toArrayBuffer(bytes) : null;
    },
  };
}
