# bench/ — read/parse benchmark

What it measures: how many times this extension reads and parses the same file to
answer four different questions (the table rows, the relationship tree, the Usage
column, and global search). Eleven scenarios; the numbers they produce are the
before/after table in the shared-source-cache design.

Three of them are also assertions rather than measurements, and fail the run:

- **scenario 1** — opening a model cold is **1** `parseModel`, not the 2 it was (rows and
  the Usage summary from one parse);
- **scenario 3** — `large.slx` is parsed **1** time in Case A (open its linked dictionary,
  then the model), not the 2 it was;
- **scenario 10** — the scope must reach **4** models through a compressed dictionary's
  references, which it can only do by reading them out of the zip. Unlike the first two,
  this one is not expected to move.

The first two are here because nothing else can see them. A parse whose result is
discarded costs a `parseModel` and moves no read count, so no unit test can watch it:
the bytes were already in hand. This run is the only place a regression from 1 back to 2
is visible.

## Run it

```sh
node bench/genCorpus.mjs                                                    # once
npx vitest run --config bench/vitest.config.ts --disable-console-intercept  # measure
```

`--disable-console-intercept` is required: without it vitest swallows the output of a
test that passes, and the table is the output.

The corpus goes to `bench/corpus/` (gitignored, ~21 MB, regenerated from scratch each
time — deterministic, so two runs produce byte-identical files, zip timestamps
included). The generator verifies every file it writes through core's own parsers and
exits non-zero if any of them parses to nothing; a corpus that silently parsed to
empty would report excellent timings for no work.

Two knobs:

| Variable | Default | What it does |
| --- | --- | --- |
| `BENCH_BIG_SLDD_MB` | `20` | `big.sldd`'s size. The dictionaries behind the 5.7 s report are 47.8 MB and 138 MB; `BENCH_BIG_SLDD_MB=138` reproduces the larger one (~290 000 entries, and ~1.3 GB retained once a tab is open on it). Above ~512 MB the reader refuses the file outright, as the real one does (`MAX_SCAN_BYTES`). |
| `BENCH_REPEATS` | `3` | Measurements per scenario. Set it to `1` to check that the scenarios run and to read the COUNTS, which a busy machine cannot distort. Never publish a `ms` from a run with fewer than 3. |

## The three metrics

Milliseconds do not transfer between machines, so the table carries three things per
scenario:

| Metric | Where it comes from |
| --- | --- |
| `parseModel` calls | read off `cache.parsed`: `sourceCache.parsedModelOf` is the one place this host parses a model, and it stores what it parsed under the file's content version, so an entry that is a NEW OBJECT is one parse |
| files read / MB read | counted in the node-`fs` reader every scenario shares |
| best / median ms | `performance.now()`, best of 3 and median of 3 |

Plus retained heap for scenarios 8 and 9: `heapUsed` after a forced `global.gc()`,
which the config enables via `execArgv`.

### Which core produced the table

The run header ends with `core: installed package` or `core: LINKED to …`. Two tables
are only comparable if they came from the same one — a core linked in with
`npm install --no-save ../data-explorer-core` is a symlink whose real path is outside
`node_modules`, so vitest inlines it rather than externalizing it, which is not free.
When the before-table and the after-table are taken from different checkouts, both
runs need the same core.

### Checking the parse counts

The counts are structural — they follow from what each call does, not from watching
it. To check that reasoning:

```sh
npx vitest run --config bench/vitest.count.config.ts --disable-console-intercept
```

That config inlines `data-explorer-core` into vite's module graph and sets
`BENCH_COUNT_MOCK=1`, which together let the `vi.mock` at the top of
`scenarios.bench.ts` intercept core's own `parseModel` — every call, wherever it is
made from, because the mocked module is the one that DEFINES it. That is what holds the
structural count's premise ("`parsedModelOf` is the only place") true instead of assuming
it: a parse reached by a route the ledger cannot see, such as core's relative import
inside `ModelStructureScan`'s non-zip fallback, shows up here as a disagreement. The run
fails on one, and prints `(mock N)` beside any count the two differ on.

Do NOT take timings from that config; `bench/vitest.config.ts` sets
`BENCH_COUNT_MOCK=0` for exactly that reason. Inlining plus the wrapper cost ~13% on a
large parse (736 ms against 659 ms, measured on `large.slx` against the pinned
package).

## Typechecking

`npm run typecheck` does not cover `bench/` — the root tsconfig's `rootDir` is `./src`.
Use `npx tsc --noEmit -p bench`.

## What is real and what is substituted

Every scenario composes the REAL host modules, over the ONE shared source cache a window
keeps:

| The scenario does | It really calls |
| --- | --- |
| open a tab on a model | `sourceCache.parsedModelOf`, then `SlddModel.getModelFromParsed` — `BinaryEditorProvider.post`'s own sequence, `invalidate` included |
| open a tab on a `.sldd`/`.mat` | `SlddModel.getModelFromBytes` (that read is not shared: a dictionary's rows come from its content, which the cheap tier's `FileSummaries` is not) |
| fill the Usage column | `usagePlan.planSummaries` |
| build the sections tree | `structuralIndex.graphSourcesOf` + `RelGraph` |
| build the search index | `nameScan.namesOfFile`, batched by the real `mapLimited` |

Until the phase 7 rewire three of those were HAND-COPIES of the pre-cache host, so an
after-run would have executed the old design and reported no improvement at all. Two
substitutions remain, both noted in `scenarios.bench.ts`:

- **the file system** — `vscode.workspace.fs` is unavailable here, so reads go through
  a node-`fs` reader mirroring `src/host/scanRead.ts` (`version` = `mtime:size`). This
  approach was already validated for this design: the v1.19.0 numbers taken this way
  tracked a real window (621 ms here against 654 ms there). It does understate one
  thing, and the big dictionary is where it shows: a warm `readFileSync` of 20 MB is
  2 ms, while `workspace.fs.readFile` marshals the same bytes across the extension-host
  boundary. So read the MB column, not the ms, as the cost of a duplicate read — the
  bytes are exact and machine-independent, the milliseconds are a floor.
- **the three vscode-side entry points** — `nameIndex.build`,
  `SectionsTreeProvider.buildGraph` and `sourceReads.parsedModelForTab` all import
  `vscode`. Each is a `findFiles` plus a reader literal over a module the harness imports
  directly, so the harness writes that literal out: `dirtyBytes: () => null` for search
  (nothing is open in an editor here, which is the case that reaches the cache anyway), the
  project store for the tree (the cache deliberately never holds one), and for a tab a
  version from the `stat` plus an UNCAPPED eager read. `sourceReads.ts` also names the
  window's one `SourceCache`, so each measurement holds its own instead — which is what
  makes a repetition cold.
