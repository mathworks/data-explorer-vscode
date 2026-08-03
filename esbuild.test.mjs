// Copyright 2026 The MathWorks, Inc.
// Compile the @vscode/test-electron integration suite to CJS that runs INSIDE a
// downloaded VS Code instance. These tests import `vscode` at runtime (external,
// provided by the host), unlike the headless vitest unit suite under test/.
import * as esbuild from 'esbuild';
import { glob } from 'glob';

const entryPoints = await glob('test-integration/**/*.ts');

await esbuild.build({
  entryPoints,
  bundle: true,
  outdir: 'dist-test',
  outbase: 'test-integration',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // `vscode` is injected by the Electron host; `mocha` is resolved from
  // node_modules by the test runner. Neither should be bundled.
  external: ['vscode', 'mocha'],
  sourcemap: true,
});

console.log('esbuild: integration tests compiled to dist-test/');
