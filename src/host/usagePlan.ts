// Copyright 2026 The MathWorks, Inc.
// What a Usage answer has to read, and the cache that makes each file cost once.
//
// Opening one dictionary used to summarise the whole folder: `summarizeFiles` runs a full
// `parseModel` on every model in it, reachable or not, and nothing survived the next build.
// Measured in a real window, that made a 27 KB dictionary cost 654 ms to open beside one
// 13.8 MB model, and 115 → 113 → 108 ms again for each further tab.
//
// The asymmetry that fixes it is core's own: a dictionary and a MAT-file are summarised by
// cheap scanners (`scanSldd`, `scanMat` — 3288 ms → 116 ms and 1271 ms → 4.4 ms), while a
// MODEL is summarised by a full `parseModel`. So a model is the only file worth deciding
// about, and `scanModelStructure` decides it without walking a block (1598 ms → 54 ms over
// a 127-model corpus — see slxStructure.ts):
//
//   Look at every candidate: a model's LINKS only, and a data file's full summary. Both cheap.
//   Then `usageScope` names the models whose chain reaches the opened file.
//   Only those models are parsed.
//
// A data file is summarised whether or not it is in scope, because reading its references IS
// reading its summary — the same `scanSldd` call answers both, so there is no cheaper tier to
// put it in. This is therefore no worse than before for a folder of large dictionaries, and
// much better for one holding models: the 654 ms case above was one model. What it buys
// everywhere is the cache.
//
// Cache entries are keyed by the `version` the reader reports, which is why there is no
// invalidation protocol here. Every build re-versions its candidates, so a file whose bytes
// moved is re-read and one that did not is not, whether or not a watcher event arrived. A
// second tab over the same models re-uses their summaries and pays only the edge rebuild.
//
// What is cached are SUMMARIES, never parses — the distinction core's summarisers exist to
// make (`scanSldd` retains 2 MB where the full parse retained 63). Holding them across
// builds costs what one build already held, rather than accumulating trees.
//
// vscode-free, and the reading is behind `PlanReader`, so the equality this whole design
// rests on — a scoped answer matches the whole-folder answer, for every file — is pinned in
// the fast suite over real fixture bytes (usageScopeEquality.test.ts). usageSources.ts is
// the vscode adapter and holds the process-wide cache.
import { isMatFile, isModelFile, mergeFileSummaries, summarizeFiles } from 'data-explorer-core';
import type { FileSummaries } from 'data-explorer-core';
import { mapLimited } from './mapLimited.js';
import { extractSlxStructure } from './slxStructure.js';
import { usageScope, type ChainKind, type ChainSource } from './usageScope.js';

/** A candidate file, before anything has been read: what it is called and where. */
export interface PlanFile {
  uriString: string;
  path: string;
}

/**
 * How a plan reads. Two calls, because the point of the cache is that the first is cheap
 * enough to make on every build and the second is what it avoids.
 */
export interface PlanReader {
  /**
   * An opaque token that changes when the file's content might have, or `null` for a file
   * that should not be read at all (too large, unreadable). Must not require reading the
   * file — a version that cost a read would defeat the cache it keys.
   */
  version(file: PlanFile): Promise<string | null>;
  /** The file's bytes, or `null` if it turned out to be unreadable after all. */
  bytes(file: PlanFile): Promise<ArrayBuffer | null>;
}

// What one file contributed: the chain it resolves names through, and its summary if one was
// affordable at the first stage. A model's `summary` is null until it is found to be in
// scope; a data file's is already here, because reading its references WAS summarising it.
interface Candidate {
  source: ChainSource;
  summary: FileSummaries | null;
}

/**
 * The summaries kept between builds. An explicit value rather than module state so a test
 * can hold a fresh one, and so the process-wide instance is named at one place
 * (usageSources.ts).
 */
export interface UsageCache {
  /** Per file: what was learned at the cheap stage, and the version it was learned from. */
  looked: Map<string, { version: string; candidate: Candidate }>;
  /**
   * Per model: its full summary. Apart from `looked` because it is filled LATER — on the
   * first build that finds the model in scope, not on the build that first saw the file.
   */
  models: Map<string, { version: string; summary: FileSummaries }>;
}

export function newUsageCache(): UsageCache {
  return { looked: new Map(), models: new Map() };
}

export function clearUsageCache(cache: UsageCache): void {
  cache.looked.clear();
  cache.models.clear();
}

function kindOf(path: string): ChainKind {
  if (isModelFile(path)) return 'model';
  if (isMatFile(path)) return 'mat';
  return 'sldd';
}

// srcId is the uriString, so every link target carries a full uri and a click resolves to an
// exact file even when two same-named files exist. The filename is the PATH, which is what
// core dispatches the kind on — and the path rather than the uri because a uri can carry a
// `?query` no extension test should have to know about.
function summarizeOne(file: PlanFile, bytes: ArrayBuffer): FileSummaries {
  return summarizeFiles([{ srcId: file.uriString, filename: file.path, bytes }]);
}

/**
 * Look at one candidate as cheaply as its kind allows.
 *
 * A model: its links, through core's `scanModelStructure`. The model REFERENCES it also
 * reports are deliberately dropped — `usageScope` must not follow them, because a referenced
 * model's blocks resolve through its own chain and are summarised under its own srcId, so it
 * is tested on its own like every other model.
 *
 * A data file: its whole summary, and its chain read back off it. `DataSummary.slddRefs` is
 * what core's own resolver follows, so the chain this scope walks and the chain that resolves
 * a name are one list read once — not two readings of the same bytes that could disagree
 * about a reference recorded in the object form rather than as a bare string. Which is also
 * what keeps a COMPRESSED dictionary honest: its references are inside a zip, so a
 * text-scraping tier would report none and a chain running through one would be invisible.
 */
function look(file: PlanFile, bytes: ArrayBuffer): Candidate {
  const kind = kindOf(file.path);
  const source: ChainSource = { uriString: file.uriString, path: file.path, kind, chain: [] };
  if (kind === 'model') {
    // No guard: `extractSlxStructure` answers a corrupt model with empty relationships
    // rather than throwing, which is the right answer here too — the file is still a source
    // that can be opened and can say "no usages", it just reaches nothing.
    const s = extractSlxStructure(bytes, file.path);
    return {
      source: { ...source, chain: [...(s.dataDictionary ? [s.dataDictionary] : []), ...s.externalDataSources] },
      summary: null,
    };
  }
  const summary = summarizeOne(file, bytes);
  // Exactly one entry, this file's — `summarizeFiles` was given one file. A dictionary it
  // could not parse contributes none, and an empty chain is the right answer for it.
  const data = [...summary.slddByName.values(), ...summary.matByName.values()][0];
  return { source: { ...source, chain: kind === 'sldd' ? (data?.slddRefs ?? []) : [] }, summary };
}

/**
 * Look at every candidate, re-using what has not changed.
 *
 * Files are returned in `files` order — folder order, which decides basename-collision
 * winners and the order blocks are listed in a cell — with unreadable and oversized ones
 * dropped, as every scan here drops them.
 */
async function lookAll(
  cache: UsageCache,
  reader: PlanReader,
  files: readonly PlanFile[],
): Promise<Map<string, { version: string; candidate: Candidate }>> {
  const looked = new Map<string, { version: string; candidate: Candidate }>();
  const found = await mapLimited(files, async (file) => {
    const version = await reader.version(file);
    if (version === null) return null;
    const hit = cache.looked.get(file.uriString);
    if (hit && hit.version === version) return { file, entry: hit };
    const bytes = await reader.bytes(file);
    if (!bytes) return null;
    const entry = { version, candidate: look(file, bytes) };
    cache.looked.set(file.uriString, entry);
    return { file, entry };
  });
  for (const f of found) {
    if (f) looked.set(f.file.uriString, f.entry);
  }
  return looked;
}

/**
 * Summarise the models in `scope` not already summarised at their current version.
 *
 * This is the expensive tier, and the whole point of the scope: a model outside it is never
 * parsed, and a model inside it is parsed once per change rather than once per tab.
 */
async function fillModels(
  cache: UsageCache,
  reader: PlanReader,
  files: readonly PlanFile[],
  scope: ReadonlySet<string>,
  looked: Map<string, { version: string; candidate: Candidate }>,
): Promise<void> {
  const pending = files.filter((file) => {
    const entry = looked.get(file.uriString);
    if (!entry || entry.candidate.source.kind !== 'model') return false;
    if (!scope.has(file.uriString)) return false;
    const hit = cache.models.get(file.uriString);
    return !(hit && hit.version === entry.version);
  });
  await mapLimited(pending, async (file) => {
    const version = looked.get(file.uriString)?.version;
    const bytes = await reader.bytes(file);
    if (!bytes || version === undefined) return null;
    cache.models.set(file.uriString, { version, summary: summarizeOne(file, bytes) });
    return null;
  });
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
  cache: UsageCache,
  files: readonly PlanFile[],
  scope: ReadonlySet<string>,
  looked: Map<string, { version: string; candidate: Candidate }>,
): FileSummaries {
  const parts: FileSummaries[] = [];
  for (const file of files) {
    if (!scope.has(file.uriString)) continue;
    const candidate = looked.get(file.uriString)?.candidate;
    if (!candidate) continue;
    const summary =
      candidate.source.kind === 'model'
        ? cache.models.get(file.uriString)?.summary
        : candidate.summary;
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
  const looked = await lookAll(cache, reader, files);
  const scope =
    forUri === null
      ? new Set(looked.keys())
      : new Set(
          usageScope(
            forUri,
            files.map((f) => looked.get(f.uriString)?.candidate.source).filter((s): s is ChainSource => s !== undefined),
          ),
        );
  await fillModels(cache, reader, files, scope, looked);
  return merge(cache, files, scope, looked);
}
