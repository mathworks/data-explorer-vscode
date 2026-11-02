// Copyright 2026 The MathWorks, Inc.
// @vscode/test-cli config: downloads a VS Code build, loads this extension, opens
// the fixture workspace, and runs the compiled Mocha suite from dist-test/.
import { defineConfig } from '@vscode/test-cli';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `npm run test:integration:coverage`: vscode-test runs with --coverage, which has the extension
// host write V8 coverage. A mocha preload keeps those profiles in coverage-integration/v8/, and
// scripts/integration-coverage.mjs turns them into the report. A plain run is as it was.
const coverage = process.argv.includes('--coverage');
const profiles = fileURLToPath(new URL('./coverage-integration/v8/', import.meta.url));
// A profile left from an earlier run would be added to this one's counts.
if (coverage) rmSync(profiles, { recursive: true, force: true });

export default defineConfig({
  tests: [
    {
      files: 'dist-test/suite/**/*.test.js',
      workspaceFolder: 'test-integration/fixtures/workspace',
      version: 'stable',
      mocha: {
        ui: 'tdd',
        timeout: 60000,
        ...(coverage ? { preload: './dist-test/captureCoverage.js' } : {}),
      },
      ...(coverage ? { env: { DEX_COVERAGE_V8: profiles } } : {}),
      // Launch a clean profile so user settings/extensions don't perturb the run.
      launchArgs: ['--disable-extensions'],
    },
  ],
  // vscode-test's own report, which this repo does not use (scripts/integration-coverage.mjs
  // says why): it matches no file and writes nothing, so it costs a read of the profiles and
  // no more.
  coverage: {
    exclude: ['**'],
    reporter: ['none'],
  },
});
