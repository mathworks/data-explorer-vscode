// Copyright 2026 The MathWorks, Inc.
// Compile the @vscode/test-electron integration suite to CJS that runs INSIDE a
// downloaded VS Code instance. These tests import `vscode` at runtime (external,
// provided by the host), unlike the headless vitest unit suite under test/.
import * as esbuild from 'esbuild';
import { glob } from 'glob';
import { rmSync } from 'node:fs';

// Wipe the output tree first. The runner's glob is `dist-test/suite/**/*.test.js`, so
// a compiled test whose source has since been DELETED keeps running — silently, from
// bytes no source in the repo can account for. One throwaway probe outlived its `.ts`
// by a week that way, inflating every run's count by a test nobody could find.
rmSync('dist-test', { recursive: true, force: true });

const entryPoints = await glob('test-integration/**/*.ts');

await esbuild.build({
  entryPoints,
  bundle: true,
  outdir: 'dist-test',
  outbase: 'test-integration',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // Prefer packages' ESM entry — matches the production host build. Without
  // this, jsonc-parser (pulled in transitively via entrySplice) resolves to its
  // UMD `main`, whose runtime require('./impl/*') calls are left unresolved
  // after bundling and throw "Cannot find module './impl/format'" when the test
  // loads inside the Electron host.
  mainFields: ['module', 'main'],
  // `vscode` is injected by the Electron host; `mocha` is resolved from
  // node_modules by the test runner. Neither should be bundled.
  external: ['vscode', 'mocha'],
  sourcemap: true,
});

console.log('esbuild: integration tests compiled to dist-test/');
