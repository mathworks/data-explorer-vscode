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
        // measured here (webviewHtml→webviewShell), or in view or core (the name index
        // and search, the usage graphs, the folder hierarchy, the source cache).
        'src/host/BinaryEditorProvider.ts',
        'src/host/BinarySlddEditorProvider.ts',
        // The compressed dictionary editor's document: view's engine with VS Code's end of its hooks.
        'src/host/binaryDocument.ts',
        // The JSON dictionary editor's document: view's engine with VS Code's end of its hooks.
        'src/host/jsonDocument.ts',
        'src/host/MatEditorProvider.ts',
        // The MAT-file editor's document: view's engine with VS Code's end of its hooks.
        'src/host/matDocument.ts',
        // The vscode half of following a file on disk; the rules are diskConflict.ts.
        'src/host/diskFollow.ts',
        'src/host/HealthDecorationProvider.ts',
        'src/host/PropertiesViewProvider.ts',
        // The vscode half of the sidebar tree; the hierarchy itself is view's FolderHierarchy.
        'src/host/SectionsTreeProvider.ts',
        'src/host/SlddTextEditorProvider.ts',
        'src/host/editorHub.ts',
        // The vscode half of the name index; the index itself is view's NameIndex.
        'src/host/nameIndex.ts',
        'src/host/scanRead.ts',
        // The search QuickPick; what each match says is view's searchItem.
        'src/host/searchSources.ts',
        // The reading half of the shared source cache; the cache itself is core's.
        'src/host/sourceReads.ts',
        // The vscode half of the Usage column's graphs; the graphs themselves are view's UsageGraphs.
        'src/host/usageGraph.ts',
        // The watcher half of the Usage repost; the bus, its timing and its lifecycle are view's.
        'src/host/usageRepostWatch.ts',
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
