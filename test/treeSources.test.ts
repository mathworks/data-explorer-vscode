// Copyright 2026 The MathWorks, Inc.
//
// The sections tree over the shared source cache: the reads it no longer makes, and the tree
// it must still draw exactly.
//
// The tree used to read the whole folder itself on every build, and `rebuild()` fires on every
// save — so saving one small dictionary re-read every model and every dictionary beside it, and
// then the usage plan read the same folder again for the same tab. This file pins the two halves
// of fixing that, and they pull in opposite directions:
//
//   THE READS ARE COUNTED, because a tree that quietly re-read the folder would look identical.
//   Counts, not milliseconds, so they hold on any machine, and through the injected reader
//   because that is the only place a read is visible.
//
//   THE TREE IS COMPARED, whole, against the way it was built before — every node, every edge,
//   every row, in order. Sharing an artifact is only worth anything if the artifact carries
//   everything the sharing consumer needed, and the failure mode is not an exception: it is one
//   missing edge in a view the user reads as complete. So the graph built from the cache is
//   swept against the graph built from bytes over a corpus holding every relationship kind, and
//   the sweep is only worth its runtime if it FAILS when the shared artifact loses something —
//   which is what each mutation recorded in phase-notes.md checks.
//
// Over real fixture bytes, with two dictionaries built here because the property needs a
// reference spelled a particular way (see `pathfulSldd`).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { isModelFile, isProjectFile, isSlddFile } from 'data-explorer-core';
import { toArrayBuffer } from '../src/common/bytes.js';
import { isZipBytes } from '../src/host/slddFormat.js';
import { mapLimited } from '../src/host/mapLimited.js';
import { extractReferences, refsFromSlddBytes } from '../src/host/slddRefs.js';
import { extractSlxStructure } from '../src/host/slxStructure.js';
import { RelGraph, type GraphNode, type GraphSource } from '../src/host/graphModel.js';
import {
  buildGraphSource,
  graphSourcesOf,
  type GraphReader,
  type ProjectStore,
  type RawFile,
} from '../src/host/structuralIndex.js';
import { newSourceCache, type SourceCache, type SourceFile } from '../src/host/sourceCache.js';
import { planSummaries } from '../src/host/usagePlan.js';

const dir = join(import.meta.dirname, 'fixtures');
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)));

/**
 * A real compressed dictionary naming one reference the way core's summary cannot give back:
 * with a directory and a capital letter.
 *
 * `DataSummary.slddRefs` is `refs.map(refBasename)`, so this file's reference reaches the usage
 * chain as `common.sldd` — which RESOLVES the same (RelGraph resolves through `refBasename`
 * too), and that is exactly why the loss is invisible until someone reads a row. Unresolved,
 * the tree shows the reference itself, and `common.sldd` is a file the user cannot find and a
 * directory the message has silently dropped.
 */
function pathfulSldd(ref: string): Uint8Array {
  const xml =
    `<?xml version="1.0"?><DataSource FormatVersion="1">` +
    `<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary">${ref}</P></Object>` +
    `</DataSource>`;
  return zipSync({ 'data/chunk0.xml': strToU8(xml) });
}

const jsonSldd = (refs: string[]): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ 'Dictionary References': refs, Entries: [] }));

// The folder, in the order discovery hands it over — deliberately NOT alphabetical, and with
// the two same-basename dictionaries in reverse alphabetical order, because folder order is
// what decides which of them a reference resolves to.
//
// It holds one of everything the shaper has a branch for: a model with all three relationship
// kinds (one resolved, two dangling), a COMPRESSED dictionary whose reference is inside the
// zip, a TEXTUAL one, a compressed one whose reference is pathful, a MAT-file, a legacy `.mdl`,
// a project marker, a file the reader refuses outright, a file whose bytes vanish between the
// `stat` and the read, and a basename collision across two folders. A sweep over a corpus
// missing any of those would agree about a branch neither path took.
//
// TWO project markers, in one directory, and that is the other collision this corpus is for:
// `computeGroups` resolves it by source order (see the order test), and the second marker is
// LAST here so that a pass which returned its files as its reads finished would reach it first.
const CORPUS: ReadonlyArray<readonly [string, Uint8Array | null]> = [
  ['/w/model_with_refs.slx', fixture('model_with_refs.slx')],
  ['/w/params.sldd', fixture('params.sldd')],
  ['/w/chain_top.sldd', fixture('chain_top.sldd')],
  ['/w/pathful.sldd', pathfulSldd('sub/Common.sldd')],
  ['/w/chain_leaf.sldd', fixture('chain_leaf.sldd')],
  ['/w/nd_numeric.mat', fixture('nd_numeric.mat')],
  ['/w/legacy_ctrl.mdl', fixture('legacy_ctrl.mdl')],
  ['/w/MyProj.prj', strToU8('<Project/>')],
  ['/w/too_big.sldd', jsonSldd([])],
  ['/w/gone.slx', null],
  ['/w/b/dup.sldd', jsonSldd([])],
  ['/w/a/dup.sldd', jsonSldd([])],
  ['/w/AltProj.prj', strToU8('<Project/>')],
];

const file = (path: string): SourceFile => ({ uriString: `file://${path}`, path });
const FILES = CORPUS.map(([path]) => file(path));
// What the usage plan is given: the graph glob, which excludes projects.
const GRAPH_FILES = FILES.filter((f) => !isProjectFile(f.path));
const PRJ = file('/w/MyProj.prj');
// The second marker in `/w`. Never read either, and never the one that labels the group.
const ALT_PRJ = file('/w/AltProj.prj');
const PRJS = [PRJ.path, ALT_PRJ.path];
// Refused from the `stat` alone — oversized, or gone before the read. Its bytes exist in the
// corpus, so a pass that read it anyway would not fail, it would just show up in the counts.
const REFUSED = '/w/too_big.sldd';
// Versioned, then unreadable: the other way a file ends up a node with nothing to say. A failed
// read caches nothing (there is no artifact to cache), so this one file IS re-attempted on every
// build — it shows up in the counts below, deliberately, rather than being kept out of the
// corpus to make them tidier.
const VANISHED = '/w/gone.slx';
// The models both fixtures link `params.sldd` from, so both are in scope when it is opened.
const MODELS = ['/w/model_with_refs.slx', '/w/legacy_ctrl.mdl'];

const STORE = 'resources/project';
const FILES_HASH = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const info = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;

// The bytes each path is answered with, so a test can change a file. Reset per test.
let content: Map<string, Uint8Array | null>;
// Version per path; `null` is the reader refusing the file outright.
let stamp: Map<string, string | null>;
// The project's store, re-read per build by whoever wants one.
let store: ProjectStore;
let storeThrows = false;

let reads: string[] = [];
let stats: string[] = [];
let storeFetches: string[] = [];

// How long the reader takes over each file, in REVERSE corpus order: the first file is the
// slowest, so the reads do not finish in the order they were started. Without the stagger every
// file completed after the same number of microtask ticks and the order assertions below held
// whether the pass wrote by index or appended as reads finished.
//
// It has to be applied on BOTH passes, and `version` alone only staggers the first. The pass
// that builds the sources awaits nothing per file except a project's store — every other file is
// a synchronous read of the cheap map — so a `.prj` is the only file whose completion order that
// pass can get wrong, and the reader's `projectStore` therefore sleeps too. Without that sleep
// the whole stagger of that pass is the ONE extra microtask an async store fetch costs: enough
// to reorder here today, and enough for any added `await` or a different concurrency limit to
// silence. With it the two markers finish 10 ms apart and in the opposite order to the corpus.
const DELAY_MS = new Map(CORPUS.map(([path], i) => [path, (CORPUS.length - i) * 2]));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const reader = (): GraphReader => ({
  version: async (f) => {
    stats.push(f.path);
    await sleep(DELAY_MS.get(f.path) ?? 0);
    return stamp.get(f.path) ?? null;
  },
  bytes: async (f) => {
    reads.push(f.path);
    const bytes = content.get(f.path);
    return bytes ? toArrayBuffer(bytes) : null;
  },
  projectStore: async (f) => {
    storeFetches.push(f.path);
    // Slow, like the real one: `readProjectStore` is a recursive `readDirectory` plus a
    // `readFile` per XML, so the source-building pass genuinely finishes the `.prj` last.
    await sleep(DELAY_MS.get(f.path) ?? 0);
    if (storeThrows) throw new Error('no resources/project here');
    return store;
  },
});

/**
 * The tree's own reads, the way it made them before the cheap tier owned them.
 *
 * Written out rather than imported because it lives in SectionsTreeProvider.ts, which imports
 * `vscode` — the same reason parseOnce.test.ts writes out a tab's sequence. It is the reference
 * the shared-cache path is swept against, so what matters is that it is faithful: `readForScan`
 * refuses the same file the reader's `version` refuses (`stamp` answers both), a JSON `.sldd`
 * is read as TEXT and a compressed one out of its bytes, a `.prj` gets its store and never a
 * read, and one unreadable file is caught per file rather than failing the build.
 *
 * The extraction is HERE, at the call site, because `buildGraphSource` takes artifacts and not
 * bytes — it never re-derives what a caller could already have. So this side reads the folder
 * and extracts per file while the cache side reads nothing it already holds, and the sweep below
 * is still two independent routes to one set of sources. What the two share is the extraction
 * FUNCTION, deliberately and from the start (see structuralIndex.ts's header): a second spelling
 * of "read the reference list" is the drift this arrangement exists to make impossible, so the
 * sweep is about the reads, the dispatch and the shaping — not about two parsers agreeing.
 *
 * The `.sldd` split below is the one place the two routes still differ in more than timing: this
 * one decides text-vs-zip itself, the way the tree used to, where the cheap tier hands the whole
 * question to `refsFromSlddBytes`' own sniff. Both formats are in the corpus, so the sweep covers
 * both arms of that difference.
 */
async function sourcesFromBytes(r: GraphReader): Promise<GraphSource[]> {
  return mapLimited(FILES, async (f) => {
    const raw: RawFile = { uriString: f.uriString, path: f.path };
    try {
      if (isProjectFile(f.path)) {
        raw.projectFiles = (await r.projectStore(f)) ?? undefined;
        return buildGraphSource(raw);
      }
      const refused = (await r.version(f)) === null;
      const bytes = refused ? null : await r.bytes(f);
      if (bytes) {
        const u8 = new Uint8Array(bytes);
        if (isSlddFile(f.path)) {
          raw.slddRefs = isZipBytes(u8)
            ? refsFromSlddBytes(bytes)
            : extractReferences(new TextDecoder().decode(u8));
        } else if (isModelFile(f.path)) {
          raw.structure = extractSlxStructure(bytes, f.path);
        }
      }
    } catch {
      /* unreadable: node with no relationships */
    }
    return buildGraphSource(raw);
  });
}

/** Every row the view would show, in order, with its kind, label, target and state. */
function walk(graph: RelGraph): string[] {
  const rows: string[] = [];
  const visit = (nodes: GraphNode[], depth: number): void => {
    for (const n of nodes) {
      const kind = n.kind === 'group' ? `group:${n.groupKind}` : n.kind;
      rows.push(
        `${'. '.repeat(depth)}${kind} "${n.label}" ${n.uriString ?? '-'}` +
          `${n.cycle ? ' cycle' : ''}${n.hasChildren ? ' +' : ''}`,
      );
      // The graph answers `[]` for a missing or repeated node, so the only thing the cap
      // guards is a bug that made a chain expand forever — which is worth failing on.
      if (depth < 12) visit(graph.children(n), depth + 1);
    }
  };
  visit(graph.roots(), 0);
  return rows;
}

const sourceFor = (sources: readonly GraphSource[], path: string): GraphSource => {
  const found = sources.find((s) => s.path === path);
  if (!found) throw new Error(`${path} is not in the graph at all`);
  return found;
};

const readable = (): string[] =>
  CORPUS.filter(([path]) => !PRJS.includes(path) && path !== REFUSED).map(([path]) => path);

const sorted = (paths: readonly string[]): string[] => [...paths].sort();

beforeEach(() => {
  reads = [];
  stats = [];
  storeFetches = [];
  storeThrows = false;
  content = new Map(CORPUS);
  stamp = new Map(CORPUS.map(([path]) => [path, path === REFUSED ? null : `v1:${path}`]));
  // A real store, in the hash-linked layout parseProject expects: a root pointer naming the
  // Files collection, whose own hash is the directory the member entries live in. Empty of
  // members to begin with, so the test can add one without touching the marker file.
  store = { [`${STORE}/root/${FILES_HASH}p.xml`]: info('<Info location="Root" type="Files"/>') };
});

describe('what a tree build reads', () => {
  it('reads each file once, and the usage plan that follows reads only what it must PARSE', async () => {
    const cache = newSourceCache();
    const r = reader();
    await graphSourcesOf(cache, r, FILES);
    // Every file the reader will answer for, exactly once. The project is not read at all — its
    // structure is a sibling directory tree, not the marker's bytes — and neither is the file
    // the `stat` refused.
    expect(sorted(reads)).toEqual(sorted(readable()));
    for (const prj of PRJS) expect(reads).not.toContain(prj);
    expect(reads).not.toContain(REFUSED);
    expect(sorted(stats)).toEqual(sorted(CORPUS.map(([path]) => path)));

    reads = [];
    stats = [];
    await planSummaries(cache, r, GRAPH_FILES, file('/w/params.sldd').uriString);
    // The whole point of the phase: the plan's pass over the same folder is a folder of
    // `stat`s. What it reads is the two models whose chain reaches the opened dictionary, and
    // it reads them for the `parseModel` the cheap tier deliberately did not do — the cheap
    // tier scanned their relationships without walking a block, and did not keep the bytes.
    // That is the expensive tier, not a second folder pass. Plus the one file whose read
    // fails, which has no artifact to have been cached.
    expect(sorted(reads)).toEqual(sorted([...MODELS, VANISHED]));
    expect(sorted(stats)).toEqual(sorted(GRAPH_FILES.map((f) => f.path)));
  });

  it('costs the folder TWICE when the two passes do not share a cache, which is what it used to do', async () => {
    // The improvement above as a comparison rather than a claim. Same two passes, same corpus,
    // one cache each — the host as it was, where the tree read the folder for its edges and the
    // plan read it again for its summaries.
    const r = reader();
    await graphSourcesOf(newSourceCache(), r, FILES);
    await planSummaries(newSourceCache(), r, GRAPH_FILES, file('/w/params.sldd').uriString);
    const separate = [...reads];

    reads = [];
    const cache = newSourceCache();
    await graphSourcesOf(cache, r, FILES);
    await planSummaries(cache, r, GRAPH_FILES, file('/w/params.sldd').uriString);

    // 10 readable files, read by each pass, plus the 2 models the plan parses, against 10 read
    // once, plus those 2 parses and the 1 failed read that is retried.
    //
    // The 13 is taken SEQUENTIALLY — the plan runs after the build here, as it does when a view
    // becomes visible after a tab has settled — and it is what two OVERLAPPING passes cost as
    // well: a miss goes through the cache's in-flight map, so the second pass to reach a file
    // joins the first one's read rather than making its own (sourceCache.test.ts, 'reads each file
    // once for two passes running at the same time'). Before that map existed this figure held
    // only while the flows did not overlap, and folder open is exactly where they do.
    expect({ separate: separate.length, shared: reads.length }).toEqual({ separate: 22, shared: 13 });
    // And per file, which is the shape of it: every dictionary in the folder was read twice for
    // one tab, whatever its size.
    const timesRead = (paths: readonly string[], path: string): number =>
      paths.filter((p) => p === path).length;
    expect(timesRead(separate, '/w/chain_top.sldd')).toBe(2);
    expect(timesRead(reads, '/w/chain_top.sldd')).toBe(1);
  });

  it('reads nothing on a second build whose files have not changed, bar the one it cannot read', async () => {
    const cache = newSourceCache();
    const r = reader();
    const first = await graphSourcesOf(cache, r, FILES);
    reads = [];
    stats = [];
    const second = await graphSourcesOf(cache, r, FILES);
    // A rebuild is what every save, create and delete triggers, so this is the property that
    // decides what saving a file in a folder of large dictionaries costs. The one exception is
    // the file whose read fails: nothing was cached for it, so it is attempted again.
    expect(reads).toEqual([VANISHED]);
    expect(sorted(stats)).toEqual(sorted(readable().concat(...PRJS, REFUSED)));
    expect(walk(new RelGraph(second))).toEqual(walk(new RelGraph(first)));
  });

  it('draws its edges out of the cached artifact, not out of a re-read', async () => {
    // Non-vacuity for everything above: the counts only mean the tree is reading the cache if
    // the cache is where its edges come from. So an artifact is changed in place, at an
    // unchanged version, and the next build must show the change — which it can only do by
    // having read the artifact rather than the file. The file on disk still says `plant.slx`.
    const cache = newSourceCache();
    const r = reader();
    await graphSourcesOf(cache, r, FILES);
    const entry = cache.cheap.get(file('/w/model_with_refs.slx').uriString);
    if (entry?.cheap.kind !== 'model') throw new Error(`expected a model, got ${entry?.cheap.kind}`);
    entry.cheap.structure.modelReferences.push('injected.slx');
    const dict = cache.cheap.get(file('/w/chain_top.sldd').uriString);
    if (dict?.cheap.kind !== 'sldd') throw new Error(`expected a dictionary, got ${dict?.cheap.kind}`);
    (dict.cheap.refs as string[]).push('injected.sldd');

    reads = [];
    const sources = await graphSourcesOf(cache, r, FILES);
    expect(reads).toEqual([VANISHED]);
    expect(sourceFor(sources, '/w/model_with_refs.slx').modelRefs).toContain('injected.slx');
    expect(sourceFor(sources, '/w/chain_top.sldd').slddRefs).toContain('injected.sldd');
  });

  it('hands out COPIES of a cached artifact\'s lists, so a consumer cannot rewrite the cache', async () => {
    // The price of the test above: if a build's lists are the artifact's own arrays, then the
    // mutation that test performs on purpose is one any consumer can perform by accident — a
    // `.sort()` to display a source's references in alphabetical order rewrites what every later
    // build and every OTHER consumer of that file reads. And the corruption is permanent: no
    // `mtime:size` can notice a mutated artifact, so it survives every rebuild until the file
    // itself changes. Hence `buildGraphSource` copies all three lists, and hence this test.
    //
    // The copy is now the only thing standing between a consumer and the cache, not a courtesy
    // on one of two input paths: the shaper takes the ARTIFACT and nothing else, so every list it
    // hands out came out of the map. There is no bytes-in-hand build left whose lists are
    // freshly-derived and safe to mutate.
    const cache = newSourceCache();
    const r = reader();
    await graphSourcesOf(cache, r, FILES);
    const built = await graphSourcesOf(cache, r, FILES);
    const model = sourceFor(built, '/w/model_with_refs.slx');
    const dict = sourceFor(built, '/w/chain_top.sldd');
    const before = {
      modelRefs: [...model.modelRefs],
      dataSources: [...model.dataSources],
      slddRefs: [...dict.slddRefs],
    };
    // Non-vacuity: an empty list is one no mutation can be seen through. All three of the copies
    // `buildGraphSource` makes have something in them here.
    for (const [what, list] of Object.entries(before)) {
      expect(list.length, `${what} has something to corrupt`).toBeGreaterThan(0);
    }

    // Every kind of in-place mutation a list handed out like this invites: the realistic one
    // (sort for display) and the two loud ones. Ending empty is what makes a leak unmistakable.
    const wreck = (list: string[]): void => {
      list.sort();
      list.push('poisoned');
      list.length = 0;
    };
    wreck(model.modelRefs);
    wreck(model.dataSources);
    wreck(dict.slddRefs);

    reads = [];
    const after = await graphSourcesOf(cache, r, FILES);
    // From the cache, not from the file: a build that re-read would rebuild the artifact and
    // agree with the assertions below whether the lists were copied or not.
    expect(reads).toEqual([VANISHED]);
    expect(sourceFor(after, '/w/model_with_refs.slx').modelRefs).toEqual(before.modelRefs);
    expect(sourceFor(after, '/w/model_with_refs.slx').dataSources).toEqual(before.dataSources);
    expect(sourceFor(after, '/w/chain_top.sldd').slddRefs).toEqual(before.slddRefs);
  });

  it('re-reads exactly the file that was saved, and moves its edge', async () => {
    const cache = newSourceCache();
    const r = reader();
    const before = await graphSourcesOf(cache, r, FILES);
    expect(sourceFor(before, '/w/pathful.sldd').slddRefs).toEqual(['sub/Common.sldd']);

    // One file saved: new bytes, new version, everything else untouched.
    content.set('/w/pathful.sldd', pathfulSldd('chain_leaf.sldd'));
    stamp.set('/w/pathful.sldd', 'v2:/w/pathful.sldd');
    reads = [];
    const after = await graphSourcesOf(cache, r, FILES);
    // Sorted: which of the two finishes first is a matter of the reader's timing, and the claim
    // is about WHICH files were read, not in what order.
    expect(sorted(reads)).toEqual(sorted(['/w/pathful.sldd', VANISHED]));
    expect(sourceFor(after, '/w/pathful.sldd').slddRefs).toEqual(['chain_leaf.sldd']);
    // And the rest of the graph is the one it already had, not a re-derived copy of it.
    expect(sourceFor(after, '/w/chain_top.sldd')).toEqual(sourceFor(before, '/w/chain_top.sldd'));
  });

  it('keeps the folder in the order it was given, however the reads finish', async () => {
    const cache = newSourceCache();
    const sources = await graphSourcesOf(cache, reader(), FILES);
    // The reader answers slowest-first (see DELAY_MS) on BOTH of the pass's awaits — the
    // version and the project store — so this is input order asserted against a pass whose
    // files finished in a different one, in each of the two places the order is decided.
    expect(sources.map((s) => s.path)).toEqual(CORPUS.map(([path]) => path));
    // And the order is load-bearing, not tidy, in two places in RelGraph:
    //
    //   `byBasename` is built by pushing each source in this order, so a reference to a name two
    //   files share resolves to them in it — which is the assertion below, and which file a click
    //   opens.
    //   `computeGroups` says "at most one .prj per directory. If two exist in the same dir, the
    //   first (by source order) defines the project group" (graphModel.ts:82-83), and it picks
    //   through a stable length sort, so which of two markers labels the group is this order too.
    //
    // Both would start depending on which of the pass's reads finished first, which is a
    // different tree between two builds of an unchanged folder.
    expect(new RelGraph(sources).resolve('dup.sldd')).toEqual([
      file('/w/b/dup.sldd').uriString,
      file('/w/a/dup.sldd').uriString,
    ]);
    // The .prj half of that, over the same sources: the group is labelled from the marker file
    // this order reached first, and there is exactly one group per project directory.
    const groups = walk(new RelGraph(sources)).filter((r) => r.includes('group:project'));
    expect(groups).toEqual([`group:project "MyProj" ${PRJ.uriString} +`]);
  });
});

describe('the tree the cache builds is the tree the bytes build', () => {
  let cache: SourceCache;
  let cached: GraphSource[];
  let fromBytes: GraphSource[];

  beforeEach(async () => {
    cache = newSourceCache();
    cached = await graphSourcesOf(cache, reader(), FILES);
    fromBytes = await sourcesFromBytes(reader());
  });

  it('produces the same sources — every node, every edge, in order', () => {
    expect(cached).toEqual(fromBytes);
  });

  it('renders the same rows, to the same depth', () => {
    expect(walk(new RelGraph(cached))).toEqual(walk(new RelGraph(fromBytes)));
  });

  it('sweeps a graph that actually has all of those relationships in it', () => {
    // Non-vacuity for the two sweeps above: they compare row lists, and two empty row lists are
    // equal. So the corpus is checked to produce every edge kind the shaper can draw, in the
    // rendered rows rather than in the sources — a resolved model->dictionary link, a resolved
    // dictionary->dictionary one, a dangling model reference, a dangling data source, and a
    // dangling reference out of a COMPRESSED dictionary, whose refs live inside the zip.
    const rows = walk(new RelGraph(cached));
    expect(rows.length).toBeGreaterThan(12);
    const has = (needle: string): boolean => rows.some((r) => r.includes(needle));
    expect(has('group:project "MyProj"'), 'the project group').toBe(true);
    expect(has(`sldd "params.sldd" ${file('/w/params.sldd').uriString}`), 'a resolved dictionary link').toBe(true);
    expect(has(`sldd "chain_leaf.sldd" ${file('/w/chain_leaf.sldd').uriString}`), 'a resolved sub-dictionary').toBe(
      true,
    );
    expect(has('missing "plant.slx"'), 'a dangling model reference').toBe(true);
    expect(has('missing "signals.mat"'), 'a dangling data source').toBe(true);
    expect(has('missing "sub/Common.sldd"'), 'a dangling reference out of a zip').toBe(true);
    expect(has(`mat "nd_numeric.mat" ${file('/w/nd_numeric.mat').uriString}`), 'a MAT-file leaf').toBe(true);
  });

  it('lists every file as a node, including the ones nothing could be read for', () => {
    // The failure this guards is the worst one available here: a file that is in the folder and
    // not in the view. It is also the easy mistake, because the cache holds nothing for these
    // three and walking what the cache HAS would drop all of them.
    expect(cached.length).toBe(FILES.length);
    expect(cached.map((s) => s.uriString)).toEqual(FILES.map((f) => f.uriString));
    for (const path of [REFUSED, VANISHED]) {
      const s = sourceFor(cached, path);
      expect(s.slddRefs, `${path} has no references`).toEqual([]);
      expect(s.modelRefs, `${path} has no model references`).toEqual([]);
      expect(s.dataDictionary, `${path} has no dictionary link`).toBeNull();
    }
    // And they are rows, not just sources: a refused dictionary still appears under its group.
    expect(walk(new RelGraph(cached)).some((r) => r.includes('too_big.sldd'))).toBe(true);
  });

  it('labels an unresolved reference with what the file SAYS, not with what a name resolves through', async () => {
    // Why the dictionary artifact carries raw refs beside the summary core built from the same
    // bytes. Both lists are here, from one pass, and they differ.
    const entry = cache.cheap.get(file('/w/pathful.sldd').uriString);
    if (entry?.cheap.kind !== 'sldd') throw new Error(`expected a dictionary, got ${entry?.cheap.kind}`);
    expect(entry.cheap.refs).toEqual(['sub/Common.sldd']);
    const summarised = [...entry.cheap.summary.slddByName.values()];
    expect(summarised[0].slddRefs).toEqual(['common.sldd']);
    // The row the user reads. Taking the summary's list instead would resolve identically —
    // RelGraph resolves through the same reduction — so this label is the whole difference, and
    // "common.sldd" is a file they cannot search for in a directory the message dropped.
    const rows = walk(new RelGraph(cached));
    expect(rows.filter((r) => r.includes('missing "sub/Common.sldd" -'))).toHaveLength(1);
    expect(rows.filter((r) => r.toLowerCase().includes('common.sldd'))).toHaveLength(1);
  });
});

describe('a project is fetched, never cached', () => {
  it('re-reads the store on every build, and never the marker file', async () => {
    // Decision 8. A `.prj` is the one source the version key cannot cover: its structure is the
    // sibling `resources/project/` tree, and the marker file's `mtime:size` does not move when
    // something inside that tree does. A cached store would therefore be stale with no `stat`
    // able to notice it — so the store is fetched per build, and the test for that is that a
    // store which CHANGES between builds is seen to change.
    const cache = newSourceCache();
    const r = reader();
    const first = await graphSourcesOf(cache, r, FILES);
    // Both markers, since a store is fetched per project and neither is cached. Sorted: which of
    // the two the pass starts first is its own business, and the claim is one fetch each.
    expect(sorted(storeFetches)).toEqual(sorted(PRJS));
    expect(sourceFor(first, PRJ.path).projectFiles).toEqual([]);

    // The project gains a member file, without the marker being touched at all.
    store = {
      ...store,
      [`${STORE}/${FILES_HASH}/DDDDDDDDDDDDDDDDDDDDDDDDDDDDp.xml`]: info(
        '<Info location="helper.m" type="File"/>',
      ),
      [`${STORE}/${FILES_HASH}/DDDDDDDDDDDDDDDDDDDDDDDDDDDDd.xml`]: info('<Info/>'),
    };
    const second = await graphSourcesOf(cache, r, FILES);
    expect(sorted(storeFetches)).toEqual(sorted([...PRJS, ...PRJS]));
    // Members are read back off the re-fetched store. They are not rendered today — grouping is
    // path-based, so RelGraph reads neither `projectFiles` nor `projectRefs` — but they are what
    // a cached store would have gone stale about, and they are the only place the staleness is
    // observable.
    expect(sourceFor(second, PRJ.path).projectFiles).toEqual(['helper.m']);
    for (const prj of PRJS) expect(reads).not.toContain(prj);
    // Nothing about either project is kept, so there is nothing to serve at a stale version.
    for (const prj of [PRJ, ALT_PRJ]) expect(cache.cheap.has(prj.uriString)).toBe(false);
  });

  it('keeps the project as a node when its store cannot be reached', async () => {
    storeThrows = true;
    const sources = await graphSourcesOf(newSourceCache(), reader(), FILES);
    const s = sourceFor(sources, PRJ.path);
    expect(s.type).toBe('project');
    expect(s.projectFiles).toBeUndefined();
    // And the rest of the folder is unaffected: one unreachable store is not a failed build.
    expect(sources.length).toBe(FILES.length);
    expect(sourceFor(sources, '/w/chain_top.sldd').slddRefs).toEqual(['chain_leaf.sldd']);
  });
});
