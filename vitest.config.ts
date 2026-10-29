import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // vitest hands a package in node_modules to Node as it is; data-explorer-view is inlined
    // instead — run through vite, as these modules were when they lived in src/, which is what
    // lets a vi.mock reach them.
    server: { deps: { inline: [/data-explorer-view/] } },
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
        'src/host/MatEditorProvider.ts',
        // The vscode half of following a file on disk; the rules are diskConflict.ts.
        'src/host/diskFollow.ts',
        'src/host/HealthDecorationProvider.ts',
        'src/host/PropertiesViewProvider.ts',
        'src/host/SectionsTreeProvider.ts',
        'src/host/SlddTextEditorProvider.ts',
        'src/host/editorHub.ts',
        'src/host/nameIndex.ts',
        'src/host/scanRead.ts',
        'src/host/searchSources.ts',
        // The reading half of the shared source cache; the cache itself is core's.
        'src/host/sourceReads.ts',
        'src/host/usageGraph.ts',
        // The watcher half of the Usage repost; the bus and its timing are usageRepost.ts.
        'src/host/usageRepostWatch.ts',
        // The Usage question over that cache; which files it needs is core's planSummaries.
        'src/host/usageSources.ts',
        // The workspace watcher's change handler; the forget decision is core's forgetUnseenWrite.
        'src/host/workspaceChange.ts',
        'src/host/navigate.ts',
        'src/host/iconMap.ts',
        // The `workspace.fs` half of reading a project's definition; the walk is core's.
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
