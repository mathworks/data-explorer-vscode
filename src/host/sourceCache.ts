// Copyright 2026 The MathWorks, Inc.
// One owner for the cheap tier: a file costs one read per content change, whoever asks.
//
// Four things here read the same folder — the sections tree's reference graph, the usage
// plan's candidates, the name index, and the tab the user actually opened — and each was
// re-deriving what another already had. Nothing was wrong with the TIERS; what was wrong was
// that there were four of them. This module is the tier, once, behind an injected reader.
//
// Cache entries are keyed by the `version` the reader reports (`mtime:size` — see
// scanRead.ts), which is why almost nothing here needs an invalidation protocol. Every pass
// re-versions its candidates, so a file whose bytes moved is re-read and one that did not is
// not, whether or not a watcher event arrived. Never a content hash: hashing means reading,
// and reading is the thing this cache exists to avoid.
//
// `forgetSource` is the ONE exception, and it is here because `mtime:size` can be wrong in the
// unsafe direction: a write that preserves both leaves every tier believing what it already
// holds, and no later `stat` can talk it out of that. So the one caller that knows more than a
// stat does — a disk WATCHER, which fires on the write itself — says so explicitly. See there
// for the writes that do this and for why nothing on the repaint path may call it.
//
// What a file's CHEAP artifact is depends on its kind, and the asymmetry is core's own:
//
//   model  its relationships, through `scanModelStructure` (1598 ms -> 54 ms over a
//          127-model corpus; see slxStructure.ts) — or off the model's own PARSE when this cache
//          already holds one at that version, which costs no read at all. A model is the only
//          kind whose summary costs a full `parseModel`, so it is the only kind worth deciding
//          about, and the only kind with a parse to derive a cheap answer from.
//   .sldd  its whole `FileSummaries` — references AND names. Reading a dictionary's
//          references IS summarising it: `scanSldd` answers both from one call
//          (3288 ms -> 116 ms), so there is no cheaper tier to put it in. Plus its RAW
//          reference list, which the summary cannot give back (see `Cheap` below).
//   .mat   the same, through `scanMat` (1271 ms -> 4.4 ms); its references are empty by
//          definition, since a MAT-file inherits nothing.
//   .prj   NOTHING. A project is classified (`sourceKind` answers `'prj'`, so it is never
//          mistaken for a dictionary) and then never cached: its structure is not in the
//          marker file's bytes at all but in a sibling `resources/project/` tree, so there
//          is nothing here for the `mtime:size` of the versioned file to key. A store
//          cached against the marker's version would go stale on every edit inside that
//          tree and no `stat` of the `.prj` could notice. The one consumer that wants a
//          project's structure fetches it per build instead (structuralIndex.ts).
//
// A model is also the only kind with a shared FULL tier, and for the same reason: its
// `parseModel` is what everything about it costs. That parse used to happen once per consumer
// of it — `DataModel.addModelSource` walked the bytes to build the rows a tab shows, and
// `summarizeFiles` walked the same bytes again to build the Usage summary for the same open —
// so a 120 000-block model cost 1369 ms to open where one parse is 675 ms. Here the parse
// itself is the artifact (`parsed`), and both consumers read it: the rows through
// `DataModel.addModelSourceParsed` and the summary through core's `summarizeParsedModel`, which
// is the same code `summarizeFiles` routes its own model branch through. One parse per content
// change, whoever asks — including a model parsed on a DICTIONARY's behalf, which is the case
// the user reported: opening a linked dictionary and then the model itself parsed it twice.
//
// "Whoever asks" has to mean "whenever they ask", and a map of finished artifacts only covers the
// second asker who arrives after the first one finished. What covers the one who arrives while it
// is still running is a map of the work IN FLIGHT — see `InFlight` and `coalesced`, and note that
// both tiers need it, because both read a whole folder and the two folder passes on window restore
// overlap.
//
// Retaining a parse is not the same as registering it. A `ParsedSlx` here is inert data;
// nothing about it puts a node in core's session, which is a tab's business alone (see
// design decision 5 — a registered model nobody has open is a tree `findNodeById` resolves
// selections into with no view to show them).
//
// THE PARSE TIER IS BOUNDED; THE CHEAP TIER IS NOT. Both are memoization, so dropping an entry
// from either costs a re-read and re-parse and changes no answer — but they are not the same
// size. Measured (see the phase 5 notes): a model's parse retains ~40 bytes per source byte
// (a 120 000-block model, 885 KB zipped, retains ~36 MB; every model in the benchmark folder
// retains 36.6 MB against 961 KB of source), while a file's CHEAP artifact retains 0.06 of a
// byte per source byte — a 20 MB dictionary summarises to 1.3 MB. So `parsed` is bounded by a
// byte budget (`parsedBudget`) and `cheap` is not: a bound on the cheap tier that a folder
// exceeded would put back the whole-folder re-read this cache exists to remove, to recover
// about a megabyte.
//
// A model's artifact keeps EVERYTHING `extractSlxStructure` returned, model->model references
// included, even though the usage scope must not follow them. That drop is a rule about the
// SCOPE, not about the file, and it lives with the scope (usagePlan.ts); the tree needs those
// same references to draw its model->model edges. Dropping them here would take them from
// every consumer to satisfy one of them. The same rule is why a dictionary's artifact carries
// its raw references beside the summary: a shared artifact is the UNION of what its consumers
// need, and reducing it to what one of them happens to read is how the other loses an edge.
//
// vscode-free — the reading is behind `SourceReader` — so the pass is unit-tested over real
// fixture bytes with a counting reader (sourceCache.test.ts), and the equality the usage
// design rests on stays in the fast suite (usageScopeEquality.test.ts). sourceReads.ts is the
// vscode adapter and holds the process-wide instance.
import {
  isMatFile,
  isModelFile,
  isProjectFile,
  isSlddFile,
  mergeFileSummaries,
  parseModel,
  summarizeFiles,
  summarizeParsedModel,
} from 'data-explorer-core';
import type { FileSummaries, ParsedSlx } from 'data-explorer-core';
import { mapLimited } from './mapLimited.js';
import { refsFromSlddBytes } from './slddRefs.js';
import { extractSlxStructure, structureFromParsed, type SlxStructure } from './slxStructure.js';

/** A candidate file, before anything has been read: what it is called and where. */
export interface SourceFile {
  uriString: string;
  path: string;
}

/**
 * How the cache reads. Two calls, and they are the whole point of it: the first is cheap
 * enough to make on every pass and the second is what that buys.
 */
export interface SourceReader {
  /**
   * An opaque token that changes when the file's content might have, or `null` for a file
   * that should not be read at all (too large, unreadable). Must not require reading the
   * file — a version that cost a read would defeat the cache it keys.
   */
  version(file: SourceFile): Promise<string | null>;
  /** The file's bytes, or `null` if it turned out to be unreadable after all. */
  bytes(file: SourceFile): Promise<ArrayBuffer | null>;
}

/** What kind of source a path names, as core classifies it. */
export type SourceKind = 'model' | 'sldd' | 'mat' | 'prj';

/**
 * What one file yielded at the cheap tier, by kind.
 *
 * A discriminated union rather than a bag of optionals, because the kinds do not carry the
 * same thing and a consumer asking a model for a `summary` is a question with no answer, not
 * a field that happens to be missing. There is no `prj` arm: a project is classified and then
 * never cached (see the header).
 *
 * A dictionary carries `refs` as well as `summary`, and they are not the same list. The
 * summary's is core's `refs.map(refBasename)` — lowercased, directories stripped — which is
 * what a NAME resolves through; `refs` is what the file actually says, which is what a tree row
 * naming an unresolved reference has to show. Deriving one from the other is only possible in
 * that direction, so the artifact keeps the wider one. Both come off the same bytes in the same
 * pass — see slddRefs.refsFromSlddBytes for what the second reading costs.
 *
 * They can also disagree about the SET, not only the spelling, and only one of the two formats
 * is at risk. A COMPRESSED dictionary's two lists really are one list with one reduction applied:
 * `scanSldd` reads the references and core's summary reduces the same array. A TEXTUAL one's are
 * two different extractions of the same file — `refs` from `extractReferences`' regex
 * (`/"Dictionary References"\s*:\s*(\[[^\]]*\])/`), the summary's from core's full `JSON.parse` —
 * and the regex's negated class stops at the FIRST `]`, so a reference array holding a nested
 * array truncates the capture, `JSON.parse` throws, and `refs` is `[]` while the summary still
 * names the reference. The tree then draws no edge for a dictionary whose usage scope follows
 * one. No dictionary MATLAB writes is known to nest an array in that field, and the tree read
 * through the same regex before this list was shared, so it is a pre-existing fragility of the
 * extraction and not of the sharing — logged as future work, not fixed here.
 */
export type Cheap =
  | { readonly kind: 'model'; readonly structure: SlxStructure }
  | { readonly kind: 'sldd'; readonly summary: FileSummaries; readonly refs: readonly string[] }
  | { readonly kind: 'mat'; readonly summary: FileSummaries };

/** One cheap artifact and the version it was derived from. */
export interface CheapEntry {
  version: string;
  cheap: Cheap;
}

/**
 * One derivation that has STARTED and not finished, and the version it is deriving for.
 *
 * The gap a version-keyed map alone cannot close. Every tier here checks its map, misses, awaits
 * an `await bytes()`, and only then stores — so two callers that arrive before either has stored
 * both miss, both read, and both derive. Nothing is wrong with what they store (an equal artifact
 * at the same version, last writer wins), so the cost is invisible to any answer and to any test
 * that compares the map AFTERWARDS; it is invisible and it is the expensive case, because the
 * concurrent askers are exactly the ones on the folder-open path: `ensureUsageGraph` keys its own
 * dedup by the file being VIEWED, so two restored tabs are two passes that both scope the same
 * model, and `supportsMultipleEditorsPerDocument` means one model split across two panels asks
 * twice at once.
 *
 * So the promise goes into the map BEFORE the await, and the second caller joins it rather than
 * starting again — the shape `usageGraph.graphs` already uses for whole graph builds, one tier
 * down. Version-keyed like the artifact it will become: a caller asking for a version another
 * caller is not deriving must not join it.
 */
export interface InFlight<T> {
  version: string;
  promise: Promise<T>;
}

/** Cheap artifacts by uriString. Iterates in the order the pass was given its files. */
export type CheapMap = Map<string, CheapEntry>;

/**
 * How many bytes of retained `ParsedSlx` one byte of source file buys.
 *
 * Measured with forced-GC `heapUsed` deltas over the benchmark corpus and this repo's fixtures
 * (phase 5 notes hold the table): 40x for the 120 000-block model, 38x for every model in the
 * benchmark folder together, 23-24x for a 300-block model, and 2.5-4x for a sub-kilobyte
 * fixture, whose retention is a fixed floor rather than a factor. A model's own block count
 * predicts it as well (~300 bytes per block-parameter usage), but the source SIZE is the number
 * available before anything has been parsed and it is within 20% over this range, so it is what
 * the budget is spent in.
 *
 * The high end of the measured range on purpose. An estimate that came in UNDER the truth would
 * let the map retain more memory than the budget names, which is the one direction that defeats
 * the point; coming in over means the cache holds a little less than it could, which costs a
 * re-parse and nothing else.
 */
const PARSED_BYTES_PER_SOURCE_BYTE = 40;

/**
 * The default ceiling on what `SourceCache.parsed` may retain, in estimated bytes.
 *
 * 256 MB, which is ~6.4 MB of model source at the factor above. Chosen against three measured
 * facts rather than picked round: every parse in the 37-file benchmark folder together is
 * 36.6 MB, so an ordinary folder never reaches the bound at all; ONE open 20 MB dictionary
 * already costs the window ~193 MB in core's registered tree, which is not this cache's to
 * bound, so a cache allowed to grow past that would be the largest thing in the process for no
 * one's benefit; and a folder of large models is unbounded without it — 20 models of 5 MB would
 * retain about 4 GB.
 *
 * Deliberately NOT a VS Code setting. It is a memory-vs-re-parse trade a user has no way to
 * evaluate, the failure mode of getting it wrong is invisible (slower, never incorrect), and
 * every knob is permanent public surface. `newSourceCache` takes it as an argument so that the
 * tests can drive eviction with a small one, which is the only caller that needs another value.
 */
export const DEFAULT_PARSED_BUDGET_BYTES = 256 * 1024 * 1024;

/**
 * How many recently tab-opened models are exempt from eviction.
 *
 * The one piece of information the size of an entry cannot supply: which model the user is
 * looking at. Without it, the folder pass that runs immediately after a tab opens (to answer
 * its Usage column) is a run of inserts that make the tab's own parse the least recently used
 * entry in the map — so a budget smaller than that folder evicts exactly the parse the pass is
 * about to want, and Case A goes back to two parses of the same bytes. The hint comes IN from
 * the adapter, because this module is vscode-free and must not go looking at tabs itself: a tab
 * asks through the separate entry point `parsedModelForOpenTab`, which is what
 * `sourceReads.parsedModelForTab` calls. There is no `pin` OPTION on `parsedModelOf` — see
 * `parsedModelForOpenTab` for why the difference is an entry point rather than a flag.
 *
 * Two, and they cost nothing while their tabs are open: a model a tab has registered is
 * retained by core's session anyway, so evicting its entry frees 0.5 MB of a 24 MB parse (2%,
 * measured) and buys a 675 ms re-parse. That is also why a pin is off-budget as well as
 * un-evictable (`parsedBudgetedBytes`). Two rather than one because switching back and forth
 * between two model tabs is the ordinary case; a small fixed number rather than "every open
 * tab" because a pinned entry is not evictable, and an unbounded pin set is an unbounded map
 * again by another name.
 */
export const PINNED_PARSES = 2;

/** One model's parse, the version it came from, and what it counts as against the budget. */
export interface ParsedEntry {
  version: string;
  parsed: ParsedSlx;
  /**
   * Estimated retained bytes — `PARSED_BYTES_PER_SOURCE_BYTE` times the source size. An
   * estimate and not a measurement: measuring a live object graph means walking it, which
   * would cost more than the parse this is accounting for.
   */
  estimated: number;
}

/**
 * What is kept between passes. An explicit value rather than module state, so a test can
 * hold a fresh one and the process-wide instance is named at exactly one place
 * (sourceReads.ts).
 */
export interface SourceCache {
  /** Per file: its cheap artifact, and the version it was derived from. */
  cheap: CheapMap;
  /**
   * Per model: its `parseModel` result, and the version it was parsed from.
   *
   * The expensive artifact, and the shared one: the rows a tab shows and the Usage summary
   * for the same model are two readings of THIS object, not two parses of the same bytes.
   * Filled by whichever consumer needs the model first, which may be a tab, a dictionary's
   * usage scope, or (later) the name index.
   *
   * Bounded, and ordered least-recently-used FIRST. Insertion order is the recency order: a
   * hit re-inserts its entry at the end, so the map's own iteration order is the eviction
   * order and there is no second structure to keep in step with this one.
   */
  parsed: Map<string, ParsedEntry>;
  /**
   * Per model: its full summary. Apart from `cheap` because it is filled LATER — on the
   * first pass that finds the model worth summarising, not on the pass that first saw the
   * file. Apart from `parsed` because the two have different fill points: a tab parses a
   * model without summarising it, and both orders have to be one parse.
   *
   * NOT bounded, and not for a size reason — see the note on `parsedBudget`.
   */
  models: Map<string, { version: string; summary: FileSummaries }>;
  /**
   * The ceiling on the estimated bytes the EVICTABLE part of `parsed` may retain — every entry
   * except the pins, which are off-budget for the reason `parsedBudgetedBytes` gives. So what
   * the map can hold is this number plus up to `PINNED_PARSES` parses that core's session is
   * holding anyway.
   *
   * Per-cache rather than a module constant so a test can name a budget a two-model corpus
   * exceeds; production reads `DEFAULT_PARSED_BUDGET_BYTES` and nothing configures it.
   *
   * `parsed` is the only tier with a budget, and the other two are deliberate. `cheap` is
   * cheap: 0.06 bytes per source byte, so bounding the whole 21 MB corpus down would recover
   * 2.8 MB at the price of the folder re-read this module exists to remove. `models` is small
   * too (9.4 MB for a folder of 11), but its reason is stronger and it is a CORRECTNESS one:
   * `usagePlan.summaryOf` reads an entry back out of this map with no re-derive, so an entry
   * evicted between `fillModelSummaries` and the merge would not cost a re-parse, it would
   * silently drop that model's usages out of the answer. A bound there needs the merge to
   * re-derive on a miss first.
   */
  parsedBudget: number;
  /**
   * The uriStrings of up to `PINNED_PARSES` models a tab most recently asked for, most recent
   * LAST. Never evicted, and never charged against `parsedBudget` either — see
   * `parsedBudgetedBytes` for why sparing an entry while still counting it is a cliff.
   *
   * Written only by `parsedModelForOpenTab`, the entry point a tab's read goes through, whose
   * one caller is the vscode adapter (`sourceReads.parsedModelForTab`) — this module has no way
   * to see a tab and must not grow one.
   */
  pinnedParses: string[];
  /**
   * The parses that have started and not finished, by uriString — so two consumers that ask for
   * one model at the same time are one `parseModel` and one read, not two of each. See `InFlight`
   * for the window this closes and `coalesced` for the mechanism.
   *
   * NOT charged against `parsedBudget` and not evictable, because the number to charge does not
   * exist yet: an entry's `estimated` is its source's `byteLength` times a factor, and there is no
   * byteLength before the read this entry IS. (The version token happens to carry the `stat` size
   * today, but reading a size out of it would make the budget depend on the format of a token
   * `SourceReader` calls opaque.) What that costs is a transient: K parses running at once are
   * charged only as they resolve, so the map can be over budget by their combined size until they
   * are — bounded by how many can run at once (a folder pass runs at most `SCAN_READ_CONCURRENCY`,
   * plus a tab), and no worse than before this map existed, since those same bytes and parses
   * already coexisted uncharged. Coalescing strictly LOWERS that peak: two askers for one model
   * now hold one parse where they held two. Each resolving parse runs the ordinary eviction pass,
   * so the steady state the budget describes is unchanged.
   *
   * Self-clearing: an entry is deleted when its promise settles, EITHER WAY — a rejected parse
   * that stayed here would be a permanently sticky failure, where today a corrupt file is retried
   * on the next ask.
   */
  parsing: Map<string, InFlight<ParsedSlx | null>>;
  /**
   * The same thing one tier down: the cheap artifacts being derived right now, by uriString.
   *
   * The cheap tier has no budget, so this one is only about the read. It matters for the same
   * reason the parse map does — the two folder passes that overlap on folder open (the tree's
   * `ensureGraph` when the view becomes visible, and a restored tab's usage plan) are both
   * whole-folder passes, so without this every file in the folder is read twice rather than once.
   */
  reading: Map<string, InFlight<CheapEntry | null>>;
  /**
   * How many times a caller has told this cache that some file's bytes may have changed under a
   * version that did not (`forgetSource`).
   *
   * Never read for its value, only compared: a derivation captures it before its read and stores
   * what it derived only if it has not moved since. `nothingForgottenSince` holds the reasoning,
   * which is the half of a forget that deleting map entries cannot cover.
   */
  generation: number;
}

export function newSourceCache(parsedBudget: number = DEFAULT_PARSED_BUDGET_BYTES): SourceCache {
  return {
    cheap: new Map(),
    parsed: new Map(),
    models: new Map(),
    parsedBudget,
    pinnedParses: [],
    parsing: new Map(),
    reading: new Map(),
    generation: 0,
  };
}

export function clearSourceCache(cache: SourceCache): void {
  cache.cheap.clear();
  cache.parsed.clear();
  cache.models.clear();
  // The pins too: a pin is a claim about a live tab, and the one caller of this
  // (`onDidChangeWorkspaceFolders`) has just invalidated every path those tabs were named by.
  // Leaving them would make a stale uri permanently unevictable, which is the one way a
  // fixed-size pin ring could still leak.
  cache.pinnedParses.length = 0;
  // The in-flight maps are deliberately NOT cleared, and the difference from the pins is the
  // point: an in-flight entry is not retained state but a call in progress, it deletes itself when
  // that call settles, and what it is keyed by is a content version — which a workspace folder
  // coming or going does not move. So a caller that joins one across a clear gets the same bytes
  // it would have read for itself, and clearing them would only make it read them again.
  //
  // No `generation` bump either, for that same reason: this event says nothing about any file's
  // CONTENT, which is the only thing that counter is about (see `forgetSource`).
}

/**
 * Drop everything held for ONE file, because its bytes may have changed under a version that did
 * not move.
 *
 * The one caller is a disk WATCHER — `BinaryEditorProvider`'s, through
 * `sourceReads.forgetChangedSource` — and that is the whole reason this exists: the event is
 * evidence of a change that `mtime:size` cannot carry. Such a write is not exotic. `tar -xp` and
 * `unzip -o` restore a file with its recorded mtime, and restoring the same revision preserves
 * its size too; a network or virtualised mount with 1-2 s mtime granularity cannot tell two
 * equal-size writes inside one tick apart. Every tier then believes what it already holds, and
 * nothing later corrects it: the file is fresh on disk, the editor visibly repaints, and the
 * table still shows the old content for the life of the window.
 *
 * NOT to be called from anything that fires on a REPAINT. `BinaryEditorProvider.post` runs on
 * every repost and drops its own node cache (`SlddModel.invalidate`); dropping the shared parse
 * there would re-read and re-parse a file that did not change, every time — the cost sharing the
 * parse exists to remove. Only the watcher knows the bytes may actually differ.
 *
 * All three tiers, because one write exposes all three: a model's rows come off `parsed`, the
 * tree's edges off `cheap`, and the Usage column off `models`. Dropping one of them would leave
 * the table fresh and the column stale — which is precisely the narrower version of this bug that
 * existed before the tab's rows came from `parsed` at all, and half a fix is harder to reason
 * about than either whole.
 *
 * The pin goes too: a pin is a claim about an entry, so keeping one for an entry that is gone
 * spends a slot of a fixed-size ring on nothing. The byte accounting needs no adjustment at all —
 * `parsedRetainedBytes` and `parsedBudgetedBytes` are sums over the map, so deleting the entry
 * uncharges it by construction.
 *
 * What dropping a `models` entry costs, stated rather than glossed: `usagePlan.summaryOf` reads
 * that map with no re-derive on a miss (see the note on `parsedBudget` for why the tier is
 * therefore unbounded), so a forget landing between `fillModelSummaries` and the merge leaves that
 * one model out of THAT build's Usage answer instead of costing a re-parse. Accepted, because the
 * window is one build wide, the next build re-derives it, and the alternative is keeping a summary
 * of bytes the file no longer has. A re-derive-on-miss in `summaryOf` would close it and is the
 * same change bounding that tier needs — logged there, not done here.
 *
 * The in-flight entries go as well, and that is the half a delete alone would miss: a derivation
 * that started before the write read the OLD bytes, so a caller arriving after this must not JOIN
 * it and be handed exactly the content the watcher fired about. Deleting the slot does not cancel
 * that derivation — nothing can, and its own caller is still waiting for an answer — it only stops
 * anyone else joining it. What stops it STORING what it read is `nothingForgottenSince`.
 */
export function forgetSource(cache: SourceCache, uriString: string): void {
  cache.cheap.delete(uriString);
  cache.parsed.delete(uriString);
  cache.models.delete(uriString);
  const pinned = cache.pinnedParses.indexOf(uriString);
  if (pinned !== -1) cache.pinnedParses.splice(pinned, 1);
  cache.parsing.delete(uriString);
  cache.reading.delete(uriString);
  cache.generation += 1;
}

/**
 * Whether nothing has been forgotten since `at` — the check every store in this module makes
 * before writing an artifact it derived on the far side of an await.
 *
 * `forgetSource` can delete what a map holds, but it cannot reach a derivation that is already
 * RUNNING, and that derivation is the one thing able to undo it: its read may have happened before
 * the write, and storing what it read would put the stale artifact back under a version key the
 * write did not move — the same permanent hit, a few hundred milliseconds later, with the watcher
 * event already spent. So a store is conditional on the counter not having moved, and one whose
 * store is skipped still ANSWERS its own caller; it is simply not retained for the next one.
 *
 * Cache-wide rather than per file, which trades a little precision on purpose: a forget while a
 * folder pass is in flight discards that pass's stores too, so the next pass re-reads those files.
 * That is a cost, bounded by one pass and self-correcting on the next, where a per-file epoch is
 * another map to keep, clear and bound. Both sides of the trade are re-reads; only one of them
 * could ever be a wrong answer.
 */
function nothingForgottenSince(cache: SourceCache, at: number): boolean {
  return cache.generation === at;
}

/**
 * Every estimated byte `cache.parsed` holds, PINS INCLUDED — the true total.
 *
 * What the budget is compared against is `parsedBudgetedBytes`, and the two differ by exactly
 * the pins. Both are worth being able to ask for: a pinned byte is still a retained byte, it is
 * just not one this policy can decide about, so a diagnostic or a test wants this number and the
 * eviction loop wants the other one.
 */
export function parsedRetainedBytes(cache: SourceCache): number {
  let total = 0;
  for (const entry of cache.parsed.values()) total += entry.estimated;
  return total;
}

/**
 * What `cache.parsed` currently claims against its budget: the total above, minus the pins.
 *
 * A pin is off-budget as well as un-evictable, and the two go together. Charging an entry that
 * eviction cannot reach makes the budget a bound on a number the policy has no way to lower: the
 * moment the pins alone exceed it, every later insert finds itself over, evicts every non-pinned
 * entry it can reach, and is STILL over — so the map degenerates to {the pins, the newest} and
 * each folder pass re-parses the whole folder, which is the regression phases 2 and 3 exist to
 * remove. A cliff, not a gradient, and invisible: still correct, just slow. At the shipped
 * default that is one open model of ~6.5 MB of source, or two open tabs of ~3.3 MB each.
 *
 * It is also a double count. A pin is a model a TAB asked for, and that tab hands the same
 * `ParsedSlx` to core's session (`SlddModel.getModelFromParsed` -> `DataModel`'s
 * `addModelSourceParsed`), whose `ModelNode.fromParsed` keeps its `rawContents`, `zipEntries`,
 * `workspace`, `blockParamUsages` and `masks` BY REFERENCE for as long as that source is
 * registered — which is the whole of what a parse retains. So the bytes a pinned entry claims
 * here are bytes the process is holding whether this map keeps the entry or not: measured,
 * dropping it frees 0.5 MB of a 24 MB parse (2%) and buys a 675 ms re-parse.
 *
 * The trade stated plainly: the map may retain the budget PLUS up to `PINNED_PARSES` parses.
 * Bounded by construction, and those parses are the ones core already owns.
 */
export function parsedBudgetedBytes(cache: SourceCache): number {
  let total = 0;
  for (const [uriString, entry] of cache.parsed) {
    if (!cache.pinnedParses.includes(uriString)) total += entry.estimated;
  }
  return total;
}

/**
 * Move `uriString` to the most-recent end of the pin ring, dropping the oldest past
 * `PINNED_PARSES`.
 */
function pinParse(cache: SourceCache, uriString: string): void {
  const at = cache.pinnedParses.indexOf(uriString);
  if (at !== -1) cache.pinnedParses.splice(at, 1);
  cache.pinnedParses.push(uriString);
  if (cache.pinnedParses.length > PINNED_PARSES) cache.pinnedParses.shift();
}

/**
 * Evict least-recently-used parses until the budget is met, sparing `keep` and the pins.
 *
 * `keep` is the entry the caller just stored, and sparing it is what makes a single model
 * larger than the WHOLE budget still work: it is cached, the loop runs out of other entries,
 * and the map holds one over-budget entry rather than evicting the answer its caller is about
 * to return and re-parsing it on the very next ask. A budget is a target for a steady state,
 * not a promise the process can keep against one 8 MB model.
 *
 * The pins are spared for the anti-thrash reason `PINNED_PARSES` gives, and they are not CHARGED
 * either: the total here is `parsedBudgetedBytes` and not `parsedRetainedBytes`. Sparing an entry
 * while still counting it against the budget is what turns the bound into a cliff — see there.
 * `keep` is charged, and that is a different case: it is exempt for THIS call only and is an
 * ordinary evictable entry on the very next insert, so counting it is what makes that next insert
 * evict it.
 *
 * Both exemptions are bounded — one newest plus at most two pins — so the map cannot be pushed
 * past three entries of exemption however small the budget is.
 */
function evictParsed(cache: SourceCache, keep: string): void {
  let total = parsedBudgetedBytes(cache);
  if (total <= cache.parsedBudget) return;
  for (const uriString of [...cache.parsed.keys()]) {
    if (total <= cache.parsedBudget) return;
    if (uriString === keep || cache.pinnedParses.includes(uriString)) continue;
    total -= cache.parsed.get(uriString)?.estimated ?? 0;
    cache.parsed.delete(uriString);
  }
}

/**
 * Run `work` for `key`, or join the run another caller started for the same `version`.
 *
 * ONE implementation for both tiers, because it is one rule and a copy of it is the copy that
 * drifts: the parse tier and the cheap tier miss, read, and store in the same three steps, so they
 * have the same window between the miss and the store.
 *
 * The two things that make it correct, both easy to lose in a rewrite:
 *
 *   The `set` is BEFORE the first await. `work()` returns at its own first await, and nothing else
 *   can run between that and the `set` below, so a second caller either finds the entry or has not
 *   arrived yet. Awaiting anything first — including `work()` — reopens exactly the window this
 *   closes.
 *
 *   The entry is deleted when the promise SETTLES, either way, and only if it is still this one
 *   (an intervening caller at a newer version owns the slot). A rejection left in the map would
 *   turn a file that would not read into a file that can never be read again, where the version
 *   key otherwise retries it on the next ask; a fulfilled entry left in the map would hold its
 *   result outside every tier's own accounting, which for a parse means outside the budget.
 */
async function coalesced<T>(
  flights: Map<string, InFlight<T>>,
  key: string,
  version: string,
  work: () => Promise<T>,
): Promise<T> {
  const joined = flights.get(key);
  if (joined && joined.version === version) return joined.promise;
  const flight: InFlight<T> = { version, promise: work() };
  flights.set(key, flight);
  try {
    return await flight.promise;
  } finally {
    if (flights.get(key) === flight) flights.delete(key);
  }
}

/**
 * Which kind `path` is, or `null` for one no reader here knows.
 *
 * Every branch is core's own predicate, for the reason common/fileTypes.ts gives: the kind
 * is a property of the FORMAT, core's parsers dispatch on these same tests, and a host
 * keeping a second opinion is how `Params.SLDD` came to be discovered and then classified as
 * nothing.
 *
 * `null` rather than a default, which is the trap this replaces: a classifier that answered
 * "dictionary" for anything it did not recognise was safe only for as long as the caller's
 * glob happened to exclude projects, and a `.prj` reaching it would have been summarised as
 * a dictionary — a read of a marker file, an empty summary, and a project in the usage graph.
 *
 * `'prj'` is therefore a kind this classifier NAMES and the cache never stores an artifact for,
 * and those are two different statements. Answering `null` for a project instead would put it
 * back in the same bucket as `notes.txt` — an extension the glob offers that nothing here has
 * an opinion about — and the next kind added to the list would land in that bucket silently.
 * `cheapOf` drops it explicitly, before any read.
 *
 * fileTypes.test.ts pins the extension LIST against core's predicates, but it never imports
 * this function, so it cannot see the third copy of the rule that this dispatch is. That pin
 * is sourceCache.test.ts, which derives its cases from SUPPORTED_EXTS and requires every
 * supported extension to name a kind here: a format added to the list without a branch here
 * fails there, rather than becoming a file the glob finds, the tree lists, and this pass
 * silently answers `null` for.
 */
export function sourceKind(path: string): SourceKind | null {
  if (isModelFile(path)) return 'model';
  if (isSlddFile(path)) return 'sldd';
  if (isMatFile(path)) return 'mat';
  if (isProjectFile(path)) return 'prj';
  return null;
}

// srcId is the uriString, so every link target carries a full uri and a click resolves to an
// exact file even when two same-named files exist. The filename is the PATH, which is what
// core dispatches the kind on — and the path rather than the uri because a uri can carry a
// `?query` no extension test should have to know about.
function summarizeOne(file: SourceFile, bytes: ArrayBuffer): FileSummaries {
  return summarizeFiles([{ srcId: file.uriString, filename: file.path, bytes }]);
}

/**
 * Derive one file's cheap artifact, or `null` for a file this pass cannot produce one for.
 *
 * A model gets `extractSlxStructure` with no guard: it answers a corrupt model with empty
 * relationships rather than throwing, which is the right answer here too — the file is still
 * a source that can be opened and can say "no usages", it just reaches nothing.
 *
 * Unless this cache is already holding that model's PARSE at the same version, in which case
 * there is nothing to read: `structureFromParsed` reads the three relationship fields straight
 * off it. The read was the entire cost of a model's cheap artifact — 0.1 ms of scanning on an
 * 885 KiB model — so the case this removes is the whole of a tab open's second read of the file
 * the user just opened: the tab parses, then the folder pass that answers its Usage column scans
 * the same bytes again. The version check is the same exact string comparison every other tier
 * makes; a parse at a DIFFERENT version is not a cheaper answer, it is another file's answer.
 *
 * The fallback is not only for a model nothing has parsed. It is also what keeps the two routes
 * from being one: a package whose non-structural parts are corrupt is SCANNABLE and not
 * PARSEABLE (see the comment inside `extractSlxStructure`), so for that file there is no parse to
 * derive from, and the scan answers as it always did.
 *
 * Recency is deliberately NOT refreshed for the parse this reads. `parsedModelOf` re-inserts on a
 * hit because a consumer asking for a parse is a use of it; a cheap pass touches EVERY model in
 * the folder, so re-inserting here would reorder the whole map into FOLDER order on every pass
 * and leave `parsed` with no recency signal at all — evicting by folder position, which is the
 * eviction-by-age failure `parsedModelOf`'s re-insert exists to avoid.
 *
 * A data file gets its summary, and a consumer resolving a NAME through its chain reads the
 * references back off `DataSummary.slddRefs`. That is what core's own resolver follows, so the
 * chain a scope walks and the chain that resolves a name are one list read once, rather than
 * two readings of the same bytes that could disagree about a reference recorded in object form
 * instead of as a bare string. It is also what keeps a COMPRESSED dictionary honest: its
 * references are inside a zip, so a text-scraping tier would report none and a chain running
 * through one would be invisible.
 *
 * A project is dropped here, and dropped BEFORE the read: the answer is the same `null` an
 * unknown extension gets, but the reason is different and both matter. `sourceKind` has
 * already said it is a project, so this is a deliberate "nothing to cache" rather than a file
 * that fell through — and falling through is what it would do if this arm were missing, since
 * the last line summarises whatever is left as a data file. A marker file read as a dictionary
 * is a read for nothing and an empty summary that then answers Usage questions.
 */
async function cheapOf(
  cache: SourceCache,
  file: SourceFile,
  version: string,
  reader: SourceReader,
): Promise<Cheap | null> {
  const kind = sourceKind(file.path);
  if (kind === null || kind === 'prj') return null;
  if (kind === 'model') {
    const held = cache.parsed.get(file.uriString);
    // Synchronous, and that matters: it introduces no await of its own, so this branch stores
    // through `cheapAll`'s existing generation check without widening the window that check
    // covers. See there.
    if (held && held.version === version) return { kind, structure: structureFromParsed(held.parsed, file.path) };
  }
  const bytes = await reader.bytes(file);
  if (!bytes) return null;
  if (kind === 'model') return { kind, structure: extractSlxStructure(bytes, file.path) };
  if (kind === 'sldd') return { kind, summary: summarizeOne(file, bytes), refs: slddRefsOf(bytes) };
  return { kind, summary: summarizeOne(file, bytes) };
}

/**
 * A dictionary's raw references, or none for one that could not be read.
 *
 * The catch is the policy `summarizeFiles` applies to the summary from the same bytes, stated
 * once more here because it is a separate call: a folder holding one truncated dictionary must
 * not fail the pass for every other file in it. "No references" is also exactly what the tree's
 * own catch answered for such a file before this list was shared, so nothing changes for it.
 */
function slddRefsOf(bytes: ArrayBuffer): readonly string[] {
  try {
    return refsFromSlddBytes(bytes);
  } catch {
    return [];
  }
}

/**
 * The cheap artifact for every file in `files`, re-using what has not changed.
 *
 * One `version` per candidate, and `bytes` only on a miss — so a pass over a folder already
 * seen is a folder of `stat`s. Not even on every miss: a MODEL whose parse this cache already
 * holds at that version has its structure read off the parse, so the pass that answers a freshly
 * opened tab's Usage column does not read the file that tab has just parsed (see `cheapOf`).
 *
 * Files come back in `files` ORDER, which is load-bearing twice over and not merely tidy:
 * folder order decides which of two same-named dictionaries wins a basename collision, and
 * it is the order the blocks in a Usage cell are listed in. Unreadable and oversized files
 * are dropped, as every scan here drops them — the file is still a node, it just has nothing
 * to say.
 *
 * One read per file per content change holds ACROSS OVERLAPPING PASSES too, not only across
 * sequential ones: a miss goes through `coalesced`, so the second of two passes that reach the
 * same file at the same moment joins the first one's read instead of making its own. Which is the
 * case on folder open, where the tree's build and a restored tab's usage plan are independent
 * async flows over the same folder.
 */
export async function cheapAll(
  cache: SourceCache,
  reader: SourceReader,
  files: readonly SourceFile[],
): Promise<CheapMap> {
  const found = await mapLimited(files, async (file) => {
    const version = await reader.version(file);
    if (version === null) return null;
    const hit = cache.cheap.get(file.uriString);
    if (hit && hit.version === version) return { file, entry: hit };
    // The entry a joining pass gets is the SAME object, not an equal one, exactly as a cache hit
    // is — which is what lets a consumer hold an artifact and know it is holding the cache.
    const entry = await coalesced(cache.reading, file.uriString, version, async () => {
      // Taken before the read, so a `forgetSource` that lands while it is in flight is visible
      // below: these bytes may be the ones a watcher has just called stale. It covers the
      // no-read route the same way — a forget deletes `cache.parsed` too, so a derivation either
      // finds no parse to work from and reads, or finds one and has its store skipped here.
      const at = cache.generation;
      const cheap = await cheapOf(cache, file, version, reader);
      if (!cheap) return null;
      const fresh: CheapEntry = { version, cheap };
      if (nothingForgottenSince(cache, at)) cache.cheap.set(file.uriString, fresh);
      return fresh;
    });
    if (!entry) return null;
    return { file, entry };
  });
  const out: CheapMap = new Map();
  for (const f of found) {
    if (f) out.set(f.file.uriString, f.entry);
  }
  return out;
}

/**
 * One model's parse, from the cache when it already holds one for `version`.
 *
 * The single place a model's DISK bytes are parsed in this host, which is what makes "once per
 * content change" checkable: a `parsed` entry that is a NEW object is one `parseModel`, and one
 * that is the same object is none. Every consumer of a model's detail goes through here — the tab
 * that registers its rows, the usage tier that summarises it, the name index that scans it for
 * search — so the count is a property of this map and not of an agreement between callers.
 *
 * "Disk bytes" is the exact qualification, and the one exception is deliberate rather than missed:
 * `nameScan` parses an open document's UNSAVED buffer itself, because search has to offer the name
 * the user has just typed. Those bytes are not on disk, so no `stat` versions them and nothing here
 * could key them — design decision 6, and the reason that override layers OVER this cache instead
 * of folding into it.
 *
 * `bytes` is a thunk and not an ArrayBuffer, because on a hit the bytes must not be read
 * either: a re-opened 13.8 MB model that nothing has touched should cost a `stat`.
 *
 * "However many consumers" includes SIMULTANEOUS ones, and that half is `coalesced`: the second
 * caller to ask for a version nobody has finished parsing joins the first caller's parse, so its
 * own `bytes` thunk is never called. Without it the two most expensive asks in the extension are
 * the ones that double up — two restored tabs in two editor groups run two usage plans that both
 * scope the same model, and one model split across two panels asks twice at once — and the
 * duplication is invisible afterwards, because both callers store an equal entry at the same
 * version.
 *
 * `version` of `null` means the file cannot be keyed — the reader refuses to version it (over the
 * scan cap, or unreadable at `stat` time). Two separate things follow, and each needs its own
 * reason. It cannot be CACHED, because an entry keyed by nothing is an entry no later `stat` could
 * re-check, so it would never be refreshed and never evicted for being wrong. It is nevertheless
 * PARSED whenever a caller has bytes for it, because the cap is not a claim that the file is too
 * big to parse: `MAX_SCAN_BYTES` is V8's maximum string length, the point past which a TEXTUAL
 * file cannot be turned into a string at all (see scanRead.ts), and a zipped `.slx` that size
 * parses perfectly well — core reads the archive without decoding it whole. A tab reads eagerly
 * for that reason: the user named this file and is waiting for it, and refusing here would answer
 * them with an empty table for a file that opens.
 *
 * Throws whatever `parseModel` throws. Its callers differ about that on purpose: a tab turns
 * it into the "Failed to parse" banner the user is waiting for, and a folder pass drops the
 * file (see below).
 *
 * This is the FOLDER-PASS way in. A tab asks through `parsedModelForOpenTab`, which is the same
 * call plus the pin — see there for why that difference exists and why it is a separate function
 * rather than a flag every caller has to get right.
 *
 * Every miss is a re-read and a re-parse and NOT an error: an evicted entry costs the caller
 * exactly what a first ask costs it, which is why bounding this map is a cost decision and
 * never a correctness one. That is a claim about every caller, so it is pinned by a test that
 * compares the answers a full cache and a thrashing one give (parsedBudget.test.ts).
 */
export async function parsedModelOf(
  cache: SourceCache,
  file: SourceFile,
  version: string | null,
  bytes: () => Promise<ArrayBuffer | null>,
): Promise<ParsedSlx | null> {
  if (version !== null) {
    const hit = cache.parsed.get(file.uriString);
    if (hit && hit.version === version) {
      // Re-insert to move the entry to the most-recent end. A plain `set` on an existing key
      // leaves a Map's insertion order alone, so without the delete a hit would not refresh
      // recency and the map would evict by AGE — dropping the model every pass re-uses first.
      cache.parsed.delete(file.uriString);
      cache.parsed.set(file.uriString, hit);
      return hit.parsed;
    }
  }
  const work = async (): Promise<ParsedSlx | null> => {
    // Before the read, for the reason `nothingForgottenSince` gives: what comes back may predate a
    // write a watcher has already reported, and this is the only place that can still notice.
    const at = cache.generation;
    const buffer = await bytes();
    if (!buffer) return null;
    // The path, not the srcId, for the reason summarizeOne gives. It lands in `parsed.name`, which
    // nothing reads — neither `ModelNode.fromParsed` nor `modelSummary`: both take the name they
    // label with as their own argument — and, for a `.mdl` alone, in core's own warning TEXT
    // (MdlParser quotes it in `source-unreadable` and in its "Not a Simulink model" throw). So the
    // two registration routes word a corrupt `.mdl`'s warning differently: this one quotes the
    // path, and core's `addModelSource` quotes the srcId it is called with. Warning CODES agree,
    // which is what parsedRegistration.test.ts sweeps and what anything here decides on; making the
    // MESSAGES agree is not a change available in this file, since the other spelling is chosen
    // inside core.
    const parsed = parseModel(buffer, file.path);
    if (version !== null && nothingForgottenSince(cache, at)) {
      cache.parsed.delete(file.uriString);
      cache.parsed.set(file.uriString, {
        version,
        parsed,
        estimated: buffer.byteLength * PARSED_BYTES_PER_SOURCE_BYTE,
      });
      evictParsed(cache, file.uriString);
    }
    return parsed;
  };
  // A versionless file is parsed for its caller and shared with nobody — not held in `parsed`, and
  // not joinable here either, which is the same rule applied to the same absence. There is no key
  // to coalesce on: two callers with no version cannot be shown to want the same BYTES, only the
  // same path, and handing the second one a parse of what the first happened to read would be a
  // guess where every other entry in this module is a version check. Reachable only above
  // MAX_SCAN_BYTES or after a failed `stat`, and one parse per caller is what it cost before.
  return version === null ? work() : coalesced(cache.parsing, file.uriString, version, work);
}

/**
 * The same parse, asked for by a TAB: `parsedModelOf` plus the pin that keeps it evictable last.
 *
 * A separate function and not a `pin` flag on `parsedModelOf`, because a flag is a rule every
 * caller has to remember and there is exactly one caller that should
 * (`sourceReads.parsedModelForTab`, the vscode adapter this is the vscode-free half of). Naming
 * the tab path here also means the three unit suites that hand-copy that adapter's inner sequence
 * copy a CALL rather than a decision — the pin cannot fall out of one of the copies and leave
 * them agreeing with each other about a host that thrashes.
 *
 * What the pin is for is on `PINNED_PARSES`: a tab's model is the one thing the size of an entry
 * cannot identify, and the folder pass that answers that same tab's Usage column runs straight
 * after it, leaving it least-recently-used and about to be wanted again.
 */
export function parsedModelForOpenTab(
  cache: SourceCache,
  file: SourceFile,
  version: string | null,
  bytes: () => Promise<ArrayBuffer | null>,
): Promise<ParsedSlx | null> {
  // Only a parse that can be CACHED is worth pinning. A versionless file is parsed and
  // deliberately not kept (see `parsedModelOf`), so a slot spent on it would pin a uri the map
  // holds no entry for and leave the next real tab a ring of one. Reachable only above
  // MAX_SCAN_BYTES or on a `stat` that failed.
  //
  // Before the parse when there is one, so that the tab this one displaces out of the ring is
  // already evictable when the parse below runs its eviction pass — the room the new parse needs
  // is the room the tab the user just left was holding. That holds when the parse is one this tab
  // JOINS rather than starts (`coalesced`): the pin is a claim on a uriString, so it is in place
  // before the folder pass's parse resolves and runs the eviction that would otherwise take it.
  if (version !== null) pinParse(cache, file.uriString);
  return parsedModelOf(cache, file, version, bytes);
}

/**
 * Summarise the models in `wanted` that are not already summarised at their current version.
 *
 * This is the expensive tier, and the whole reason the cheap one exists: a model outside
 * `wanted` is never parsed, and one inside it is parsed once per change rather than once per
 * consumer. `wanted` may name files of any kind; only models are summarised.
 *
 * Through `summarizeParsedModel` over the SHARED parse rather than `summarizeFiles` over the
 * bytes, which is the same code — core routes its own model branch through that export — with
 * the parse lifted out where it can be shared with the tab. So a model already parsed for its
 * rows is summarised here for free, and one summarised here is registered by the tab for free.
 *
 * The per-file `try` is not defensive: it is the guard that used to live INSIDE
 * `summarizeFiles`, and it has to be here now that the parse is. A folder holding one corrupt
 * model must not empty the Usage answers for every other file in it — which is what a throw
 * escaping this pass would do, since the graph build above it has one failure mode and it is
 * "no graph". The empty summary is cached like any other, so the corrupt file is not
 * re-parsed on every build; a changed version re-tries it, as for any file.
 */
export async function fillModelSummaries(
  cache: SourceCache,
  reader: SourceReader,
  files: readonly SourceFile[],
  wanted: ReadonlySet<string>,
  cheap: CheapMap,
): Promise<void> {
  // The version is CARRIED rather than looked up again below: one `cheap.get` per file, and the
  // version each file is summarised at is the one its own filter decision was made on by
  // construction — where a second lookup was a second chance to read a different entry.
  const pending: { file: SourceFile; version: string }[] = [];
  for (const file of files) {
    const entry = cheap.get(file.uriString);
    if (!entry || entry.cheap.kind !== 'model') continue;
    if (!wanted.has(file.uriString)) continue;
    const hit = cache.models.get(file.uriString);
    if (hit && hit.version === entry.version) continue;
    pending.push({ file, version: entry.version });
  }
  await mapLimited(pending, async ({ file, version }) => {
    // The same capture the other two tiers make, and this tier needs it as much as they do: a
    // summary is a reading of a parse, so a parse of bytes a watcher has since called stale
    // summarises to a stale Usage column — under a version key that same write did not move.
    const at = cache.generation;
    try {
      const parsed = await parsedModelOf(cache, file, version, () => reader.bytes(file));
      if (!parsed || !nothingForgottenSince(cache, at)) return null;
      cache.models.set(file.uriString, {
        version,
        summary: summarizeParsedModel(parsed, file.uriString, file.path),
      });
    } catch {
      // Nothing to say about a file that would not parse. `mergeFileSummaries([])` rather than
      // a hand-built empty, so the shape is core's own here as everywhere else.
      if (nothingForgottenSince(cache, at)) {
        cache.models.set(file.uriString, { version, summary: mergeFileSummaries([]) });
      }
    }
    return null;
  });
}
