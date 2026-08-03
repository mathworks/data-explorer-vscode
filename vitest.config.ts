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
        'src/host/BinaryEditorProvider.ts',
        'src/host/HealthDecorationProvider.ts',
        'src/host/PropertiesViewProvider.ts',
        'src/host/SectionsTreeProvider.ts',
        'src/host/SlddTextEditorProvider.ts',
        'src/host/usageGraph.ts',
        'src/host/navigate.ts',
        'src/host/iconMap.ts',
        'src/host/projectStore.ts',
        // Browser/DOM webview entrypoints + templates: no vitest DOM harness.
        'src/webview/*-main.ts',
        'src/webview/*.html',
      ],
    },
  },
});
