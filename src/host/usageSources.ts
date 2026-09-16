// Copyright 2026 The MathWorks, Inc.
// The Usage entry point: the candidate files a tab's graph is built over, run through the
// shared source cache.
//
// This was the whole vscode half of the usage plan — the reader and the one cache — and both
// are now sourceReads.ts, because they were never specific to Usage: the tree, the name index
// and the opened tab read the same files the same way. What is left here is only the question
// Usage asks, which is `scopedSummaries`.
//
// The reasoning behind the answer is split the same way it always was: the tiers and the
// version key in sourceCache.ts, and which files a Usage answer needs in usagePlan.ts. Both
// are vscode-free so they can be tested over real fixture bytes.
import * as vscode from 'vscode';
import { readerFor, sourceCache, sourceFilesOf, clearSources } from './sourceReads.js';
import { planSummaries } from './usagePlan.js';
import type { FileSummaries } from 'data-explorer-core';

/**
 * Drop every artifact held for every file.
 *
 * Kept as a Usage-named call because extension.ts reaches for it where it drops the usage
 * graphs; it clears the shared cache, which is what that moment means now that one cache
 * serves every consumer. See `clearSources`.
 */
export function clearUsageSources(): void {
  clearSources();
}

/**
 * The summaries needed to answer Usage for the file at `openedUriString`, over the candidate
 * `uris` — which is the workspace files plus the open tabs, in that order.
 */
export async function scopedSummaries(openedUriString: string, uris: readonly vscode.Uri[]): Promise<FileSummaries> {
  return planSummaries(sourceCache, readerFor(uris), sourceFilesOf(uris), openedUriString);
}
