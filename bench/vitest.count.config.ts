// Copyright 2026 The MathWorks, Inc.
// The same scenarios, run only to CHECK the parse counts.
//
//   npx vitest run --config bench/vitest.count.config.ts --disable-console-intercept
//
// The counts in the table are structural: each scenario adds one per place that causes
// a `parseModel`, and the plan's are read off `cache.models` because the call happens
// two frames down inside core. That reasoning could be wrong, so this config inlines
// `data-explorer-core` into vite's module graph, which is what lets the `vi.mock` at
// the top of scenarios.bench.ts intercept core's own `parseModel` — including the ones
// inside `summarizeFiles` and `DataModel.addModelSource`. The runner then prints
// `(mock N)` beside any count the two disagree about.
//
// It is a SEPARATE config because inlining is not free: the SSR transform costs ~13%
// on a large parse (736 ms against 659 ms, measured), so the milliseconds from this
// run are not the ones to record. Take the table from bench/vitest.config.ts and the
// confidence in its parse counts from here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/**/*.bench.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    pool: 'forks',
    execArgv: ['--expose-gc'],
    server: { deps: { inline: [/data-explorer-core/] } },
    // The switch the mock in scenarios.bench.ts reads. Inlining alone only makes the
    // mock POSSIBLE; this is what turns it on.
    env: { BENCH_COUNT_MOCK: '1' },
  },
});
