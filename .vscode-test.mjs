// Copyright 2026 The MathWorks, Inc.
// @vscode/test-cli config: downloads a VS Code build, loads this extension, opens
// the fixture workspace, and runs the compiled Mocha suite from dist-test/.
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  // NOT FOR MERGE: only the save-point reproduction runs on this branch.
  files: 'dist-test/suite/customEditorSavePoint.test.js',
  workspaceFolder: 'test-integration/fixtures/workspace',
  version: 'stable',
  mocha: {
    ui: 'tdd',
    timeout: 60000,
  },
  // Launch a clean profile so user settings/extensions don't perturb the run.
  launchArgs: ['--disable-extensions'],
});
