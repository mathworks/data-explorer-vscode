// Copyright 2026 The MathWorks, Inc.
// The benchmark suite's own vitest config, separate from the root one on purpose:
// the root config's `include` is `test/**/*.test.ts`, so `npm test` never picks a
// `.bench.ts` up and a 40-second measurement run cannot creep into the fast suite.
//
// Run: npx vitest run --config bench/vitest.config.ts --disable-console-intercept
// (the console-intercept flag is what makes the table appear; without it vitest
// swallows the output of a test that passes).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/**/*.bench.ts'],
    // A scenario opens a 906 KB model 120 000 blocks deep, three times over, so the
    // 5 s default is not enough. No `bail`: a scenario that fails should not hide the
    // ones after it, since the point of a run is the whole table.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // One file, one process, no parallelism: every number here is a wall-clock
    // measurement, and a worker sharing a core with another test is measuring the
    // other test. `fileParallelism: false` is what pins the worker count to 1.
    fileParallelism: false,
    pool: 'forks',
    // Scenario 8 reports RETAINED heap, which means heapUsed after a forced
    // collection — an unforced reading is whatever the collector had not got round to
    // and can even come out negative. The flag has to reach the forked worker, so it
    // goes here rather than in a NODE_OPTIONS the runner would have to remember.
    execArgv: ['--expose-gc'],
    // Off, so a timing run never pays for the counting wrapper. It is stated rather
    // than left to chance because the wrapper's reach depends on whether core is
    // inlined, and a core installed as a LINK (`npm install --no-save ../core`) is a
    // symlink out of `node_modules`, which vitest inlines by default — so "the plain
    // config cannot mock core" stopped being true the moment core was linked.
    env: { BENCH_COUNT_MOCK: '0' },
  },
});
