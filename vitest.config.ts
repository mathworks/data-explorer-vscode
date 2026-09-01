import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // Measure only the headless, vscode-free logic vitest can actually reach.
      include: ['src/host/**/*.ts', 'src/webview/**/*.ts'],
      exclude: [
        // vscode-coupled host classes: import `vscode`, unavailable under vitest.
        // These are covered by the @vscode/test-electron suite (test-integration/).
        // Keep this list in sync with `grep -l "from 'vscode'" src/host/*.ts` —
        // a vscode-importing file left off it reports a flat 0% and drags the
        // headline number down as if it were untested, which hides a real gap
        // somewhere else. Their pure logic is split into sibling modules that ARE
        // measured here (nameIndex→nameExtract, searchSources→searchFilter,
        // webviewHtml→webviewShell).
        'src/host/BinaryEditorProvider.ts',
        'src/host/BinarySlddEditorProvider.ts',
        'src/host/HealthDecorationProvider.ts',
        'src/host/PropertiesViewProvider.ts',
        'src/host/SectionsTreeProvider.ts',
        'src/host/SlddTextEditorProvider.ts',
        'src/host/editorHub.ts',
        'src/host/nameIndex.ts',
        'src/host/searchSources.ts',
        'src/host/usageGraph.ts',
        'src/host/navigate.ts',
        'src/host/iconMap.ts',
        'src/host/projectStore.ts',
        // Thin `vscode` Uri-resolution shim; its shell/CSP core is webviewShell.ts.
        'src/host/webviewHtml.ts',
        // Browser/DOM webview entrypoints + templates: no vitest DOM harness.
        'src/webview/*-main.ts',
        'src/webview/*.html',
      ],
    },
  },
});
