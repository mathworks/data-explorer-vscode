// Copyright 2026 The MathWorks, Inc.
//
// What the Usage column says for every fixture, pinned as a golden (see tables.test.ts for why
// these exist): one `usage.json` per file, mapping each row id to the cell the fill left on it.
//
// Separate from table.json because its answer is not the file's alone. A dictionary's Usage cell
// names the blocks that use each entry, and those blocks are in the models beside it, so the cell
// depends on the folder the file was opened in. Each file here is opened in its own fixture folder
// as the workspace, and filled the way usageGraph.ts fills it — the scoped summaries
// (usageSources.ts → usagePlan.planSummaries), the graph over them, and the provider's annotation —
// which is the vscode half copied here, around functions that are all called, not copied.
//
// A compressed dictionary has no usage.json: its editable view fills no Usage column at all
// (BinarySlddEditorProvider.ts:1507), so there is nothing past table.json to pin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataModel } from 'data-explorer-core';
import { LAZY_ROW_BUDGET } from '../../src/view/model/rows/lazyRows.js';
import { clearClipboard } from '../../src/host/clipboard.js';
import { isGraphPath } from '../../src/common/fileTypes.js';
import { newSourceCache } from '../../src/host/sourceCache.js';
import { planSummaries } from '../../src/host/usagePlan.js';
import { annotateModelViewRows, annotateVariableRows, buildUsageGraphFromSummaries } from '../../src/host/usageCells.js';
import { bytesOf, fakeFile, filesUnder, fixtureFolders, nameOf, snapshotPath, snapshotText } from './fixtures.js';
import { nodeReader } from './nodeReads.js';
import { isModelFixture, openTable, routeOf } from './views.js';

beforeAll(() => {
  clearClipboard();
  DataModel.removeAll();
});

afterAll(() => {
  DataModel.removeAll();
});

// As generous as tables.test.ts, for the same reason, and each test here also reads its folder.
describe('golden Usage cells', { timeout: 60_000 }, () => {
  for (const folder of fixtureFolders()) {
    // The files the usage graph reads (GRAPH_GLOB): no projects, which define no variables.
    const graphFiles = filesUnder(folder).filter((rel) => isGraphPath(rel));
    // The workspace's own reads, shared by every file in it, as one window shares its cache.
    const cache = newSourceCache();
    const files = graphFiles.map(fakeFile);
    for (const rel of graphFiles) {
      const route = routeOf(nameOf(rel), new Uint8Array(bytesOf(rel))).kind;
      if (route === 'zip' || route === 'none') continue;
      it(rel, async () => {
        const view = await openTable(rel, LAZY_ROW_BUDGET);
        try {
          // mirrors usageGraph.ts:138 buildGraph (findFiles first, then the tab, which is in the
          // folder already) and usageSources.ts:33 scopedSummaries.
          const graph = buildUsageGraphFromSummaries(await planSummaries(cache, nodeReader(files), files, view.uriString));
          // The provider's filler: a model view's (usageGraph.ts:214 annotateModelRows) on the
          // read-only view of a model (BinaryEditorProvider.ts:260), and the data view's
          // (usageGraph.ts:185 annotateDataRows) on every other view that fills the column.
          if (route === 'readonly' && isModelFixture(rel)) annotateModelViewRows(view.uriString, view.rows, graph);
          else annotateVariableRows(view.uriString, view.rows, graph);
          const cells: Record<string, unknown> = {};
          for (const row of view.rows) {
            // An empty cell is left out: its row is in table.json, so absence here says the fill
            // left it empty.
            if (row.UsedBy === undefined || row.UsedBy === '') continue;
            const id = String(row.ID);
            if (Object.hasOwn(cells, id)) throw new Error(`${view.uriString}: two rows answer for ${id}`);
            cells[id] = row.UsedBy;
          }
          await expect(snapshotText(cells)).toMatchFileSnapshot(snapshotPath(rel, 'usage'));
        } finally {
          view.close();
        }
        expect(DataModel.getDataSourceIds(), `${rel} left a source registered`).toEqual([]);
      });
    }
  }
});
