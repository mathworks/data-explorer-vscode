// Copyright 2026 The MathWorks, Inc.
// Keeps the extension host's V8 coverage for scripts/integration-coverage.mjs. A mocha preload,
// added by .vscode-test.mjs only when vscode-test runs with --coverage.
//
// `--coverage` sets NODE_V8_COVERAGE for the extension host, and V8 writes what ran into that
// directory. vscode-test then reads it with its own c8 pass and deletes it. That pass is not
// the one this repo reports (see scripts/integration-coverage.mjs), so the profiles are copied
// out to DEX_COVERAGE_V8 first.
//
// Not under suite/: the runner's glob is `dist-test/suite/**/*.test.js`, so this never runs as
// a test of its own.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { takeCoverage } from 'node:v8';

let kept = false;

function keep(): void {
  const from = process.env.NODE_V8_COVERAGE;
  const to = process.env.DEX_COVERAGE_V8;
  if (kept || !from || !to) return;
  kept = true;
  // Writes everything that has run into `from` now, rather than at exit.
  takeCoverage();
  mkdirSync(to, { recursive: true });
  // Only this process's: the window's other Node processes write into the same directory.
  const mine = `coverage-${process.pid}-`;
  for (const name of readdirSync(from)) {
    if (name.startsWith(mine)) copyFileSync(join(from, name), join(to, name));
  }
}

// After the last test, or at exit when a test failed: the runner skips a global teardown then.
// Once: what ran after the take (the window closing) is not the suite's.
export function mochaGlobalTeardown(): void {
  keep();
}
process.once('exit', keep);
