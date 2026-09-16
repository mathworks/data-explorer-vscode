// Copyright 2026 The MathWorks, Inc.
// Which files a Usage answer has to read, out of the ones the cheap tier saw.
//
// Opening one dictionary used to summarise the whole folder: `summarizeFiles` runs a full
// `parseModel` on every model in it, reachable or not, and nothing survived the next build.
// Measured in a real window, that made a 27 KB dictionary cost 654 ms to open beside one
// 13.8 MB model, and 115 -> 113 -> 108 ms again for each further tab.
//
// The asymmetry that fixes it is core's own, and it is now stated once for every consumer in
// sourceCache.ts: a dictionary and a MAT-file are summarised by cheap scanners, while a MODEL
// is summarised by a full `parseModel`. So a model is the only file worth deciding about, and
// `scanModelStructure` decides it without walking a block:
//
//   Look at every candidate as cheaply as its kind allows. Both tiers are the cache's.
//   Then `usageScope` names the models whose chain reaches the opened file.
//   Only those models are parsed.
//
// A data file is summarised whether or not it is in scope, because reading its references IS
// reading its summary — the same `scanSldd` call answers both. This is therefore no worse
// than before for a folder of large dictionaries, and much better for one holding models: the
// 654 ms case above was one model.
//
// What is left in THIS module is only the usage-specific half: turning cheap artifacts into
// the chains `usageScope` walks, and merging the scoped summaries. Two rules in that half are
// easy to lose:
//
//   - a model's model->model REFERENCES are dropped when its chain is built, because
//     `usageScope` must not follow them: a referenced model's blocks resolve through its own
//     chain and are summarised under its own srcId, so it is tested on its own like every
//     other model. The cache keeps them, for the consumers that draw them.
//   - a non-graph kind cannot become a `ChainSource` at all, so it can never enter a scope or
//     a merge. A project defines no variables and no parameter usages; before the cache
//     classified one it would have been read as a dictionary. It cannot reach the switch
//     below either — the cheap tier produces no artifact for a `.prj`, so `planSummaries`
//     skips it for the same reason it skips an unreadable file.
//
// vscode-free, and the reading is behind `SourceReader`, so the equality this whole design
// rests on — a scoped answer matches the whole-folder answer, for every file — is pinned in
// the fast suite over real fixture bytes (usageScopeEquality.test.ts). usageSources.ts is the
// usage entry point and sourceReads.ts holds the process-wide cache.
import { mergeFileSummaries } from 'data-explorer-core';
import type { FileSummaries } from 'data-explorer-core';
import {
  cheapAll,
  fillModelSummaries,
  type Cheap,
  type CheapMap,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from './sourceCache.js';
import { usageScope, type ChainSource } from './usageScope.js';

// The cache is the shared one, under the names this module's callers and tests already use.
// Aliases rather than a rename: the plan is the hottest path in the extension, and churning
// the two test suites and the benchmark that inject a reader into it would buy nothing.
export type PlanFile = SourceFile;
export type PlanReader = SourceReader;
export type UsageCache = SourceCache;
export { newSourceCache as newUsageCache, clearSourceCache as clearUsageCache } from './sourceCache.js';

/**
 * What one file resolves names through, or `null` for a file that resolves nothing.
 *
 * A model's chain is its linked dictionary first, then its external data sources — resolution
 * order, matching core's `ModelSummary.slddRefs`. Its model references are deliberately NOT
 * in it (see the header). A dictionary's chain is its own references, read back off the
 * summary the cheap tier already built. A MAT-file's is empty and must stay empty: core's
 * `DataSummary.slddRefs` is empty for one, so a chase out of it here would reach files core's
 * resolver never would.
 */
function chainSourceOf(file: SourceFile, cheap: Cheap): ChainSource | null {
  const at = { uriString: file.uriString, path: file.path };
  switch (cheap.kind) {
    case 'model': {
      const s = cheap.structure;
      const chain = [...(s.dataDictionary ? [s.dataDictionary] : []), ...s.externalDataSources];
      return { ...at, kind: 'model', chain };
    }
    case 'sldd': {
      // Exactly one entry, this file's — the cheap tier summarised one file. A dictionary it
      // could not parse contributes none, and an empty chain is the right answer for it.
      const data = [...cheap.summary.slddByName.values(), ...cheap.summary.matByName.values()][0];
      return { ...at, kind: 'sldd', chain: data?.slddRefs ?? [] };
    }
    case 'mat':
      return { ...at, kind: 'mat', chain: [] };
  }
}

/** Which summary answers for one file, once its models have been filled. */
function summaryOf(cache: SourceCache, uriString: string, cheap: Cheap): FileSummaries | undefined {
  switch (cheap.kind) {
    case 'model':
      return cache.models.get(uriString)?.summary;
    case 'sldd':
    case 'mat':
      return cheap.summary;
  }
}

/**
 * Merge the scoped files' summaries in `files` order.
 *
 * Through core's `mergeFileSummaries` rather than assembled here, because the merge carries a
 * rule: the name maps are keyed by refBasename and the last assignment wins, so the fold
 * order decides which of two same-named dictionaries a name resolves to. That is core's rule
 * about core's maps, and a loop here would be a second opinion on it.
 */
function merge(
  cache: SourceCache,
  files: readonly SourceFile[],
  scope: ReadonlySet<string>,
  cheap: CheapMap,
): FileSummaries {
  const parts: FileSummaries[] = [];
  for (const file of files) {
    if (!scope.has(file.uriString)) continue;
    const entry = cheap.get(file.uriString);
    if (!entry) continue;
    const summary = summaryOf(cache, file.uriString, entry.cheap);
    if (summary) parts.push(summary);
  }
  return mergeFileSummaries(parts);
}

/**
 * The summaries needed to answer Usage for the file at `forUri`, over `files`.
 *
 * `forUri` of `null` scopes nothing and summarises every candidate — the graph as it was
 * built before scoping. That is not a fallback path the extension takes; it is the reference
 * the scoped answer is compared against in usageScopeEquality.test.ts.
 */
export async function planSummaries(
  cache: UsageCache,
  reader: PlanReader,
  files: readonly PlanFile[],
  forUri: string | null,
): Promise<FileSummaries> {
  const cheap = await cheapAll(cache, reader, files);
  // In `files` order, and only the kinds a usage answer can resolve through — so the scope
  // below cannot name a file the merge has no summary for.
  const sources = new Map<string, ChainSource>();
  for (const file of files) {
    const entry = cheap.get(file.uriString);
    if (!entry) continue;
    const source = chainSourceOf(file, entry.cheap);
    if (source) sources.set(file.uriString, source);
  }
  const scope =
    forUri === null ? new Set(sources.keys()) : new Set(usageScope(forUri, [...sources.values()]));
  await fillModelSummaries(cache, reader, files, scope, cheap);
  return merge(cache, files, scope, cheap);
}
