// Copyright 2026 The MathWorks, Inc.
// The vscode half of the usage plan: how a candidate file is versioned and read, and where
// the summaries live between builds.
//
// The reasoning — the two tiers, the scope, why a data file is summarised whether or not it
// is in scope — is all in usagePlan.ts, which is vscode-free so that it can be tested over
// real fixture bytes. This module supplies `readForScan`/`scanVersion` and one cache, and
// nothing else: the split is the same one nameIndex→nameExtract and searchSources→searchFilter
// already make here, and it exists so the equality the design rests on is pinned in the fast
// suite rather than only in the integration suite.
import * as vscode from 'vscode';
import { toArrayBuffer } from '../common/bytes.js';
import { readForScan, scanVersion } from './scanRead.js';
import { clearUsageCache, newUsageCache, planSummaries, type PlanFile, type PlanReader } from './usagePlan.js';
import type { FileSummaries } from 'data-explorer-core';

// One cache for the window. Keyed by content version inside, so it is shared by every file's
// graph: the models `a.sldd` had to parse are the models `b.sldd` gets for free.
const cache = newUsageCache();

/**
 * Drop every summary held for every file.
 *
 * Not needed for correctness — version keying already refuses a stale entry — but for the
 * case where an entry can no longer be reached to be checked: a workspace folder removed
 * takes its files out of `findFiles`, and their summaries would otherwise sit here for the
 * rest of the session.
 */
export function clearUsageSources(): void {
  clearUsageCache(cache);
}

// `readForScan` and `scanVersion` make the same two refusals (oversized, unreadable), one
// from the bytes and one from the `stat` alone — which is the contract `PlanReader` asks for:
// a version that cost a read would defeat the cache it keys. See scanRead.ts.
function readerFor(uris: readonly vscode.Uri[]): PlanReader {
  const byUri = new Map(uris.map((u) => [u.toString(), u]));
  const uriOf = (file: PlanFile): vscode.Uri | undefined => byUri.get(file.uriString);
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

/**
 * The summaries needed to answer Usage for the file at `openedUriString`, over the candidate
 * `uris` — which is the workspace files plus the open tabs, in that order.
 */
export async function scopedSummaries(openedUriString: string, uris: readonly vscode.Uri[]): Promise<FileSummaries> {
  const files: PlanFile[] = uris.map((u) => ({ uriString: u.toString(), path: u.path }));
  return planSummaries(cache, readerFor(uris), files, openedUriString);
}
