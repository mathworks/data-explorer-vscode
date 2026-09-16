// Copyright 2026 The MathWorks, Inc.
// The eleven scenarios in the shared-source-cache benchmark, measured over
// bench/corpus/ (run `node bench/genCorpus.mjs` first).
//
//   npx vitest run --config bench/vitest.config.ts --disable-console-intercept
//
// BENCH_REPEATS=1 measures each scenario once instead of three times. Use it only to
// check that the scenarios still run and to read the COUNTS, which are immune to a
// busy machine; a published timing needs the default 3 on a quiet one.
//
// WHAT THIS IS NOT: a reimplementation. Every scenario composes the REAL host modules
// the extension runs, over the ONE shared source cache a window keeps:
//
//   a tab      `sourceCache.parsedModelOf` for a model's parse and then
//              `SlddModel.getModelFromParsed` for its rows — BinaryEditorProvider.post's
//              own sequence — or `SlddModel.getModelFromBytes` for a dictionary/MAT-file
//   Usage      `usagePlan.planSummaries`
//   the tree   `structuralIndex.graphSourcesOf` + `RelGraph`
//   search     `nameScan.namesOfFile`, batched by the real `mapLimited`
//
// A benchmark that re-derived any of those would measure the benchmark. Until phase 7
// three of them WERE re-derived: `openModel`, `buildNameIndex` and `buildTree` were
// hand-copies of the pre-cache host, so an after-run would have executed the old design
// and reported no improvement at all. See phase-notes.md, "Benchmark harness rewire".
//
// WHAT IS SIMULATED, and it is only ever the `vscode` seam:
//
//   * the FILE SYSTEM. `vscode.workspace.fs` is unavailable here, so reads go through a
//     node-`fs` `SourceReader` mirroring src/host/scanRead.ts (`version` = `mtime:size`,
//     `bytes` = the file's bytes, both refusing an oversized file). Deliberate, and
//     already validated for this design: the v1.19.0 numbers taken this way tracked the
//     real window (621 ms here against 654 ms there).
//   * the three vscode-side ENTRY POINTS, each of which is `findFiles` plus a reader
//     literal over a module that IS imported here. `nameIndex.build` becomes
//     `buildNameIndex` (with `dirtyBytes: () => null` — nothing is open in an editor
//     here, so the override that layers over the cache is inert);
//     `SectionsTreeProvider.buildGraph` becomes `buildTree` (with the project store the
//     cache deliberately never holds); `sourceReads.parsedModelForTab` becomes
//     `parsedForTab` (version from the `stat`, then an UNCAPPED eager read, because a tab
//     must not refuse the file the user named).
//   * the ONE cache. `sourceReads.ts` names the window's `SourceCache` and imports
//     `vscode`, so each `World` holds its own — which is also what makes a repetition
//     cold (see `World`).
//
// THREE METRICS, because milliseconds do not transfer between machines:
//   parses — `parseModel` calls, counted structurally off `cache.parsed` (see
//            `World.counting`) and, when core is inlined so it can be intercepted,
//            cross-checked against a mock
//   reads  — files read and total bytes read, counted in the reader
//   ms     — best of 3 and median of 3, `performance.now()`
// plus peak retention for scenarios 8 and 9.
import { describe, expect, it, vi } from 'vitest';

// Counts every `parseModel` in the process, wherever it is called from — which is the
// point of mocking the DEFINING module rather than a call site.
//
// Since phase 2 the host has exactly one call site (`sourceCache.parsedModelOf`), and the
// counts below are read off the map that call fills. This mock is what holds that claim
// true instead of assuming it: it also sees the routes no host-side wrapper could, namely
// core's own relative imports of `parseModel` — `ModelStructureScan`'s fallback for a
// NON-ZIP model (a `.mdl`; the corpus has none, so it never fires) and, before phase 2,
// `summarizeFiles` and `DataModel.addModelSource`. A structural count that disagrees with
// this one means a parse is happening somewhere the design says it cannot.
//
// Live only when `BENCH_COUNT_MOCK` is `1`, which bench/vitest.count.config.ts sets and
// bench/vitest.config.ts sets to `0`. An env switch rather than "whichever config
// inlines core", because whether core is inlined is not under this file's control:
// vitest externalizes `node_modules`, so the mock CANNOT bite on an installed
// package — but a core installed with `npm install --no-save ../data-explorer-core` is
// a symlink whose real path is outside `node_modules`, and that one gets inlined and
// mocked by default. Wrapping `parseModel` on a timing run would then be silent and
// would cost time, so the two runs say which they are instead of inferring it.
//
// The path is spelled out rather than imported: `vi.mock` is hoisted above every
// import, and this module is not on core's `exports` map, so a bare specifier cannot
// reach it. Mocking the module core's own relative imports resolve to is what makes the
// wrapper total — the package barrel re-exports this same module, so a call through
// `data-explorer-core` (which is how the host reaches it) is intercepted as well.
vi.mock('../node_modules/data-explorer-core/dist/datamodel/parser/ModelParser.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('data-explorer-core')>();
  if (process.env.BENCH_COUNT_MOCK !== '1') return { ...original };
  return {
    ...original,
    parseModel: (...args: unknown[]) => {
      const g = globalThis as { __benchParses?: number };
      g.__benchParses = (g.__benchParses ?? 0) + 1;
      return (original.parseModel as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import { readdirSync, readFileSync, realpathSync, statSync, utimesSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { toArrayBuffer } from '../src/common/bytes.js';
import { basename } from '../src/common/pathUtil.js';
import { GRAPH_EXTS, SUPPORTED_EXTS } from '../src/common/fileTypes.js';
import { RelGraph } from '../src/host/graphModel.js';
import { mapLimited } from '../src/host/mapLimited.js';
import type { NameRecord } from '../src/host/nameExtract.js';
import { namesOfFile, type NameReader } from '../src/host/nameScan.js';
import { scanSldd } from '../src/host/slddContent.js';
import { isZipBytes } from '../src/host/slddFormat.js';
import { parsedModelOf } from '../src/host/sourceCache.js';
import { graphSourcesOf, type GraphReader } from '../src/host/structuralIndex.js';
import * as SlddModel from '../src/host/SlddModel.js';
import {
  newUsageCache,
  planSummaries,
  type PlanFile,
  type PlanReader,
  type UsageCache,
} from '../src/host/usagePlan.js';

const CORPUS = fileURLToPath(new URL('corpus/', import.meta.url));
const REPEATS = Math.max(1, Number(process.env.BENCH_REPEATS ?? 3));

/**
 * The largest file a scan will read — src/host/scanRead.ts's `MAX_SCAN_BYTES`, which
 * cannot be imported here because that module imports `vscode`. Copied rather than
 * dropped so the reader below makes the same two refusals the real one does; nothing
 * in the corpus is near it, so it changes no number, but a reader without it would be
 * a different reader.
 */
const MAX_SCAN_BYTES = 0x1fffffe8;

// --- The corpus, as the extension's two globs see it --------------------------

interface CorpusFile extends PlanFile {
  /** Absolute filesystem path — what node `fs` is given. */
  fsPath: string;
}

function corpusFiles(exts: readonly string[]): CorpusFile[] {
  const ok = new Set(exts.map((e) => '.' + e.toLowerCase()));
  // Sorted, which is this harness's stand-in for "folder order". Folder order is
  // load-bearing in the plan (it decides basename-collision winners and the order
  // blocks are listed in a cell), so it has to be the SAME order on every run, and
  // `readdirSync` does not promise one.
  return readdirSync(CORPUS)
    .filter((name) => ok.has(name.slice(name.lastIndexOf('.')).toLowerCase()))
    .sort()
    .map((name) => {
      const url = pathToFileURL(CORPUS + name);
      return { uriString: url.toString(), path: url.pathname, fsPath: CORPUS + name };
    });
}

/** Files the tree's glob returns (`SUPPORTED_GLOB` — includes `.prj`). */
const TREE_FILES = corpusFiles(SUPPORTED_EXTS);
/** Files the usage and name graphs read (`GRAPH_GLOB` — no `.prj`). */
const GRAPH_FILES = corpusFiles(GRAPH_EXTS);

const fileNamed = (name: string): CorpusFile => {
  const found = GRAPH_FILES.find((f) => basename(f.path) === name);
  if (!found) throw new Error(`bench/corpus/${name} is missing — run \`node bench/genCorpus.mjs\``);
  return found;
};

// The project store, read the way src/host/projectStore.ts reads it: every *.xml
// under `resources/project`, keyed by POSIX relpath from the project root.
function projectStore(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(CORPUS + relDir, { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.xml')) out[rel] = readFileSync(CORPUS + rel, 'utf8');
    }
  };
  walk('resources/project');
  return out;
}

// --- The world one measurement runs in ----------------------------------------

/**
 * One measurement's state and counters.
 *
 * Fresh per repetition, and `dispose()` puts back what is process-wide: SlddModel's
 * per-URI cache and core's `DataModel` session both outlive a `World`, and a second
 * repetition that found a 120 000-block model already registered would measure a
 * cache hit and report it as a cold open.
 *
 * `cache` is the window's ONE shared source cache — the thing `sourceReads.ts` holds for
 * the extension, and the reason a tab, the tree, the usage plan and search can be four
 * readings of one pass. Per `World` rather than per scenario, and per repetition rather
 * than per process, for the same reason as above.
 */
class World {
  readonly cache: UsageCache = newUsageCache();
  /** `parseModel` calls, counted off `cache.parsed` — see `counting`. */
  parses = 0;
  /** The same, per file basename — scenario 3's headline is one file's count. */
  readonly parsesOf = new Map<string, number>();
  files = 0;
  bytes = 0;
  private readonly opened = new Set<string>();

  private parsed(path: string): void {
    this.parses += 1;
    const name = basename(path);
    this.parsesOf.set(name, (this.parsesOf.get(name) ?? 0) + 1);
  }

  /** A whole-file read, counted. What a TAB does, and what every scan tier does. */
  readBytes(file: CorpusFile): Uint8Array {
    const buf = readFileSync(file.fsPath);
    this.files += 1;
    this.bytes += buf.byteLength;
    return buf;
  }

  read(file: CorpusFile): ArrayBuffer {
    return toArrayBuffer(this.readBytes(file));
  }

  /**
   * The reader the plan is given: `version` from the `stat` alone, `bytes` counted.
   * Mirrors usageSources.readerFor over node `fs`.
   */
  reader(): PlanReader {
    const byUri = new Map(TREE_FILES.map((f) => [f.uriString, f]));
    return {
      version: async (file) => {
        const found = byUri.get(file.uriString);
        if (!found) return null;
        try {
          const stat = statSync(found.fsPath);
          if (stat.size > MAX_SCAN_BYTES) return null;
          return `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
        } catch {
          return null;
        }
      },
      bytes: async (file) => {
        const found = byUri.get(file.uriString);
        if (!found) return null;
        try {
          return this.read(found);
        } catch {
          return null;
        }
      },
    };
  }

  /**
   * The search index's reader: this world's, plus the one source the shared cache has no
   * concept of — nameIndex.nameReader's own literal.
   *
   * `dirtyBytes` always answers `null` because nothing is open in an editor here. That is
   * the case the override is DESIGNED to fall through (see nameScan.ts): a file with no
   * unsaved buffer is the one that reaches the cache, so this is the path a folder scan
   * takes in a real window too — not a stub that switches the behaviour off.
   */
  private nameReader(): NameReader {
    return { ...this.reader(), dirtyBytes: () => null };
  }

  /**
   * The tree's reader: this world's, plus the project store — SectionsTreeProvider.reader's
   * own literal. A `.prj` is fetched per build and never cached (sourceCache.ts says why),
   * so the walk below is outside the read counters exactly as it was before: it is not a
   * read of a versioned source file.
   */
  private graphReader(): GraphReader {
    return { ...this.reader(), projectStore: async () => projectStore() };
  }

  /**
   * Count the models `work` parsed.
   *
   * `sourceCache.parsedModelOf` is the only place this host calls `parseModel`, and it
   * stores what it parsed under the file's content version — so a `cache.parsed` entry
   * that is a NEW OBJECT is one parse and an entry that is the same object is none. This
   * is the same ledger `parseOnce.test.ts` and `nameScan.test.ts` count with, and it
   * replaces the pre-phase-2 counting off `cache.models`: a model summarised from a parse
   * someone else made now adds a `models` entry with no parse behind it, so that counter
   * would over-report from here on.
   *
   * The claim it rests on ("only place") is not assumed: under the count config the mock
   * above sees every `parseModel` in the process, and the run FAILS if the two disagree.
   * Three blind spots, all stated rather than papered over — a file the reader will not
   * version is parsed and not stored (nothing in this corpus is); a `.mdl` would make the
   * cheap tier's `scanModelStructure` fall back to a real `parseModel` the ledger cannot
   * see (the corpus has none); and once the parse tier can EVICT, a file parsed, evicted
   * and parsed again inside one scenario counts once, because the diff sees one new
   * object. Each would show up as a mock disagreement, since the mock counts calls.
   */
  private async counting<T>(work: () => Promise<T>): Promise<T> {
    const before = new Map(this.cache.parsed);
    const out = await work();
    for (const [uriString, entry] of this.cache.parsed) {
      if (before.get(uriString) !== entry) this.parsed(new URL(uriString).pathname);
    }
    return out;
  }

  /** `planSummaries` for one opened file — the real Usage pass, over the shared cache. */
  async plan(forUri: string): Promise<void> {
    await this.counting(() => planSummaries(this.cache, this.reader(), GRAPH_FILES, forUri));
  }

  /**
   * The parse a TAB gets: `sourceReads.parsedModelForTab`'s inner sequence.
   *
   * Versioned from the `stat` like every scan, then read WHOLE and uncapped on a miss —
   * the one point where a tab and a scan differ, because the user named this file and is
   * waiting for it. On a hit neither the read nor the parse happens, which is what makes
   * Case A cost a `stat`.
   */
  private async parsedForTab(file: CorpusFile): Promise<unknown> {
    const parsed = await parsedModelOf(this.cache, file, await this.reader().version(file), async () =>
      this.read(file),
    );
    if (!parsed) throw new Error(`bench/corpus/${basename(file.path)} could not be read`);
    return parsed;
  }

  /**
   * Opening a tab on a model: BinaryEditorProvider.post's own sequence for one.
   *
   * `invalidate` first, because a post always drops this module's node for the URI and
   * re-registers — the tree the webview renders has to be the file as it is now. It does
   * NOT touch the shared parse, which is version-keyed and therefore already honest, so a
   * re-open re-registers the rows from the parse it already has.
   */
  async openModel(file: CorpusFile): Promise<void> {
    await this.counting(async () => {
      SlddModel.invalidate(file.uriString);
      SlddModel.getModelFromParsed(file.uriString, basename(file.path), await this.parsedForTab(file));
    });
    this.opened.add(file.uriString);
    await this.plan(file.uriString);
  }

  /**
   * Opening a tab on a dictionary or a MAT-file: the same sequence, other branch.
   *
   * Still the bytes, and still no `parseModel` of its own — a dictionary's tab builds its
   * rows from the file's own content, which the cheap tier's `FileSummaries` is not. So
   * this read is not shared with the folder pass, and scenarios 9 and 11 are where that
   * shows.
   */
  async openData(file: CorpusFile): Promise<void> {
    await this.counting(async () => {
      SlddModel.invalidate(file.uriString);
      SlddModel.getModelFromBytes(file.uriString, basename(file.path), this.read(file));
    });
    this.opened.add(file.uriString);
    await this.plan(file.uriString);
  }

  /**
   * The sections tree: `graphSourcesOf` over the shared cheap tier, then
   * `new RelGraph(sources)` — SectionsTreeProvider.buildGraph, minus the `findFiles`.
   */
  async buildTree(): Promise<RelGraph> {
    return this.counting(async () => {
      const graph = new RelGraph(await graphSourcesOf(this.cache, this.graphReader(), TREE_FILES));
      // The provider's first `getChildren()` — so anything the graph defers to a walk is
      // inside the measurement rather than after it.
      graph.roots();
      return graph;
    });
  }

  /**
   * The name index's full build: `nameScan.namesOfFile` for every graph file, batched by
   * the same `mapLimited` at the same concurrency — `nameIndex.build`, minus the
   * `findFiles`, and including its rule that an empty bucket is not stored.
   */
  async buildNameIndex(): Promise<Map<string, NameRecord[]>> {
    return this.counting(async () => {
      const reader = this.nameReader();
      const found = await mapLimited(GRAPH_FILES, async (file) => ({
        file,
        records: await namesOfFile(this.cache, reader, file),
      }));
      const index = new Map<string, NameRecord[]>();
      for (const { file, records } of found) {
        if (records.length > 0) index.set(file.uriString, records);
      }
      return index;
    });
  }

  /** Forget the counted work, keeping every cache — the end of an untimed warmup. */
  reset(): void {
    this.parses = 0;
    this.parsesOf.clear();
    this.files = 0;
    this.bytes = 0;
  }

  dispose(): void {
    for (const uriString of this.opened) {
      SlddModel.invalidate(uriString);
      DataModel.removeDataSource(uriString);
    }
    this.opened.clear();
  }
}

// --- Scenarios ----------------------------------------------------------------

interface Scenario {
  n: number;
  name: string;
  /** Run before the clock starts — the "warm" half of a warm scenario. */
  warmup?: (w: World) => Promise<void>;
  /** Run after warmup, still untimed: what happened to the folder in between. */
  between?: () => void;
  measure: (w: World) => Promise<void>;
  /** Scenario 8 only: report retained heap instead of a second read count. */
  retention?: boolean;
  note: string;
}

const LARGE = 'large.slx';
const SHARED = 'shared.sldd';
/** The ~20 MB dictionary — `BENCH_BIG_SLDD_MB` in the generator sets its size. */
const BIG = 'big.sldd';
/**
 * The leaf of the chain, whose only path from a model runs through the
 * COMPRESSED-BINARY `chainBin.sldd`: small17..small20 -> chainA -> chainB ->
 * chainBin (zip) -> chainC. So scenario 10's count is a test as much as a
 * measurement — see `CHAIN_MODELS`.
 */
const CHAIN_LEAF = 'chainC.sldd';
/**
 * How many models chainC.sldd's usage scope reaches: small17..small20. If a change
 * makes the cheap tier read dictionary references as text, `chainBin.sldd`'s
 * reference disappears, the scope collapses, and this drops to 0 — the fast wrong
 * answer this corpus exists to catch. Update it deliberately if the corpus grows.
 */
const CHAIN_MODELS = 4;

const SCENARIOS: Scenario[] = [
  {
    n: 1,
    name: 'open a model, cold',
    measure: async (w) => {
      await w.openModel(fileNamed(LARGE));
    },
    note: 'rows + Usage from ONE parse of large.slx (asserted below)',
  },
  {
    n: 2,
    name: 'open the same model again, warm',
    warmup: async (w) => {
      await w.openModel(fileNamed(LARGE));
    },
    measure: async (w) => {
      await w.openModel(fileNamed(LARGE));
    },
    note: 'the shared parse is re-used; the tab re-registers its rows and reads nothing',
  },
  {
    n: 3,
    name: 'open shared.sldd, then large.slx (Case A)',
    measure: async (w) => {
      await w.openData(fileNamed(SHARED));
      await w.openModel(fileNamed(LARGE));
    },
    note: 'THE case: how many times large.slx is parsed in total',
  },
  {
    n: 4,
    name: 'open a model, then the first global search',
    measure: async (w) => {
      await w.openModel(fileNamed(LARGE));
      await w.buildNameIndex();
    },
    note: 'the search index shares the parse the tab made, and re-reads nothing of it',
  },
  {
    n: 5,
    name: 'first global search, cold',
    measure: async (w) => {
      await w.buildNameIndex();
    },
    note: 'upper bound: every model in the folder, no cheap block scanner',
  },
  {
    n: 6,
    name: 'build the tree, then a usage graph',
    measure: async (w) => {
      await w.buildTree();
      await w.plan(fileNamed(LARGE).uriString);
    },
    note: 'ONE folder pass: the plan re-stats what the tree read',
  },
  {
    n: 7,
    name: 'save one file with the tree visible',
    warmup: async (w) => {
      await w.buildTree();
      await w.openData(fileNamed(SHARED));
    },
    // A save, as the caches see one: the bytes are unchanged but the mtime moves, so
    // every version-keyed entry for THIS file is stale and every other one is not.
    // Writing the same bytes back would be the same test with a chance of corrupting
    // the corpus, so this touches the mtime instead.
    between: () => {
      const now = new Date();
      utimesSync(fileNamed('small01.slx').fsPath, now, now);
    },
    measure: async (w) => {
      // `SectionsTreeProvider.rebuild()` drops the graph wholesale, then
      // `invalidateUsageGraph()` drops the graphs but NOT the summaries.
      await w.buildTree();
      await w.plan(fileNamed(SHARED).uriString);
    },
    note: 'the rebuild stats the folder; only the saved file is read again',
  },
  {
    n: 8,
    name: 'peak retention after scenario 3',
    retention: true,
    measure: async (w) => {
      await w.openData(fileNamed(SHARED));
      await w.openModel(fileNamed(LARGE));
    },
    note: 'what the session + the usage cache hold once Case A has run',
  },
  {
    n: 9,
    name: 'open the big dictionary, cold',
    retention: true,
    measure: async (w) => {
      await w.openData(fileNamed(BIG));
    },
    note: 'one tab on the big dictionary: read for the rows, read again for the folder pass',
  },
  {
    n: 10,
    name: 'open the leaf of a chain through a compressed dictionary',
    measure: async (w) => {
      await w.openData(fileNamed(CHAIN_LEAF));
    },
    note: `scope must reach ${CHAIN_MODELS} models THROUGH a zip's references`,
  },
  {
    n: 11,
    name: 'save the big dictionary with the tree visible',
    warmup: async (w) => {
      await w.buildTree();
      await w.openData(fileNamed(BIG));
    },
    between: () => {
      const now = new Date();
      utimesSync(fileNamed(BIG).fsPath, now, now);
    },
    measure: async (w) => {
      await w.buildTree();
      await w.plan(fileNamed(BIG).uriString);
    },
    note: 'the reported case: the tree and the plan now share the one re-read',
  },
];

// --- Runner -------------------------------------------------------------------

interface Work {
  parses: number;
  largeParses: number;
  mockParses: number | null;
  files: number;
  bytes: number;
}

interface Result extends Work {
  n: number;
  name: string;
  best: number;
  median: number;
  retainedMb: number | null;
  gc: boolean;
  note: string;
}

const gcAvailable = typeof (globalThis as { gc?: () => void }).gc === 'function';
const collect = (): void => (globalThis as { gc?: () => void }).gc?.();

/**
 * Which `data-explorer-core` produced the table — the pinned package, or a local
 * checkout linked in with `npm install --no-save`. Printed because two tables are only
 * comparable if they came from the SAME core, and the difference is invisible: a link
 * is also inlined into vite's module graph, which is not free.
 */
function coreProvenance(): string {
  const linked = fileURLToPath(new URL('../node_modules/data-explorer-core', import.meta.url));
  try {
    const real = realpathSync(linked);
    return real === linked ? 'installed package' : `LINKED to ${real}`;
  } catch {
    return 'not resolvable';
  }
}

function mockCount(): number | null {
  const g = globalThis as { __benchParses?: number };
  return g.__benchParses ?? null;
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;

async function run(scenario: Scenario): Promise<Result> {
  const times: number[] = [];
  const runs: Work[] = [];
  let retainedMb: number | null = null;

  for (let i = 0; i < REPEATS; i++) {
    const world = new World();
    await scenario.warmup?.(world);
    // Counted work resets after the warmup: what the warmup did is setup, not the
    // measurement, and leaving its parses in would double every warm scenario.
    world.reset();
    scenario.between?.();

    // The mock counter, if it is live, is zeroed per repetition so it can be compared
    // with the structural count for the SAME repetition.
    const g = globalThis as { __benchParses?: number };
    const mockBefore = g.__benchParses;
    if (mockBefore !== undefined) g.__benchParses = 0;

    collect();
    const heapBefore = process.memoryUsage().heapUsed;

    const started = performance.now();
    await scenario.measure(world);
    times.push(performance.now() - started);

    if (scenario.retention) {
      collect();
      retainedMb = mb(process.memoryUsage().heapUsed - heapBefore);
    }
    runs.push({
      parses: world.parses,
      largeParses: world.parsesOf.get(LARGE) ?? 0,
      mockParses: mockCount(),
      files: world.files,
      bytes: world.bytes,
    });
    world.dispose();
  }

  // Every repetition must agree about the WORK done. If they do not, the world is
  // leaking state between repetitions and the counts below mean nothing — so this is
  // an assertion rather than an average.
  for (const r of runs.slice(1)) {
    expect(r).toEqual(runs[0]);
  }

  return {
    n: scenario.n,
    name: scenario.name,
    ...runs[0],
    best: Math.min(...times),
    median: median(times),
    retainedMb,
    gc: gcAvailable,
    note: scenario.note,
  };
}

function table(results: Result[]): string {
  const rows = results.map((r) => {
    const parses =
      r.mockParses === null || r.mockParses === r.parses ? `${r.parses}` : `${r.parses} (mock ${r.mockParses})`;
    const retention = r.retainedMb === null ? '—' : `${r.retainedMb} MB${r.gc ? '' : ' (no gc)'}`;
    return (
      `| ${r.n} | ${r.name} | ${parses} | ${r.largeParses} | ${r.files} | ${mb(r.bytes)} | ` +
      `${r.best.toFixed(0)} | ${r.median.toFixed(0)} | ${retention} |`
    );
  });
  return [
    '| # | Scenario | parseModel calls | of which large.slx | files read | MB read | best ms | median ms | retained |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

describe('shared source cache benchmark', () => {
  // A stale corpus is the one way this harness reports comfortable numbers for the
  // wrong folder, so the shapes that make the scenarios mean anything are checked
  // before any of them runs: the expensive model, the big dictionary, and the fact
  // that the mid-chain dictionary really is a zip.
  it('has a generated corpus', () => {
    expect(GRAPH_FILES.length).toBeGreaterThan(30);
    expect(statSync(fileNamed(LARGE).fsPath).size).toBeGreaterThan(500_000);
    expect(statSync(fileNamed(BIG).fsPath).size).toBeGreaterThan(5_000_000);
    expect(isZipBytes(readFileSync(fileNamed('chainBin.sldd').fsPath))).toBe(true);
    expect(scanSldd(toArrayBuffer(readFileSync(fileNamed('chainBin.sldd').fsPath))).refs).toEqual([
      'chainC.sldd',
    ]);
  });

  it('measures the scenarios', async () => {
    const results: Result[] = [];
    for (const scenario of SCENARIOS) {
      results.push(await run(scenario));
    }
    console.log('');
    console.log(`corpus: ${TREE_FILES.length} files (${GRAPH_FILES.length} in the graph glob), ` +
      `large.slx ${mb(statSync(fileNamed(LARGE).fsPath).size)} MB, ` +
      `big.sldd ${mb(statSync(fileNamed(BIG).fsPath).size)} MB; ` +
      `repeats: ${REPEATS}${REPEATS < 3 ? ' — COUNTS ONLY, ms is not a measurement' : ''}; ` +
      `parse counting: ${mockCount() === null ? 'structural only' : 'structural + mock'}; ` +
      `gc: ${gcAvailable ? 'exposed' : 'NOT exposed (heapUsed unforced)'}; ` +
      `core: ${coreProvenance()}`);
    console.log('');
    console.log(table(results));
    console.log('');
    for (const r of results) console.log(`  ${r.n}. ${r.note}`);
    console.log('');

    // The two numbers the whole change is about, as ASSERTIONS rather than as reported
    // values. Both were 2 on the baseline; the shared cache makes them 1, and this is the
    // only place a regression back to 2 can be seen at all — no unit test can watch a
    // parse whose result is discarded, because the bytes were already in hand and the read
    // counts do not move. Follow scenario 10's pattern, below.
    const cold = results.find((r) => r.n === 1)!;
    expect(cold.parses, 'scenario 1: model parses to open a model cold').toBe(1);
    expect(cold.largeParses, 'scenario 1: parses of large.slx').toBe(1);

    const caseA = results.find((r) => r.n === 3)!;
    console.log(`  Case A: large.slx parsed ${caseA.largeParses}x (${caseA.parses} model parses in total)`);
    console.log('');
    // Case A's TOTAL is every model shared.sldd's usage scope reaches; the headline is
    // this one file, parsed for the dictionary's scope and then re-used by its own tab.
    expect(caseA.largeParses, 'Case A: parses of large.slx').toBe(1);

    // And the chain through the compressed dictionary really is walked. Unlike the
    // line above this is NOT expected to change when the cache lands — a scope that
    // stops at a zip is wrong before and after — so a failure here means the corpus
    // grew or a reference reader regressed, not that the change worked.
    const chain = results.find((r) => r.n === 10)!;
    expect(chain.parses, 'models reached through chainBin.sldd').toBe(CHAIN_MODELS);

    // And under the counting config, the structural counts have to match what core
    // actually did. A disagreement means the reasoning behind the numbers is wrong,
    // which is worth a failure rather than a footnote in the table.
    for (const r of results) {
      if (r.mockParses !== null) expect(r.mockParses, `scenario ${r.n} parse count`).toBe(r.parses);
    }
  });
});
