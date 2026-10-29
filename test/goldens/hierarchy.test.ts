// Copyright 2026 The MathWorks, Inc.
//
// What the Data Explorer sidebar shows for every fixture folder, pinned as a golden (see
// tables.test.ts for why these exist): the relationship tree expanded all the way down, one
// `hierarchy.json` per folder, under the folder's own snapshot directory.
//
// The tree is built the way SectionsTreeProvider builds it — view's `FolderHierarchy` over every
// supported file in the folder, through a shared source cache — and each row is recorded with the
// fields the provider's `getTreeItem` draws from (the label, the twisty, the description, the file
// it opens and its health badge). Every row a user can expand is expanded, as a user clicking
// every twisty would; a cycle row offers no twisty, and that is where an expansion ends.
import { describe, expect, it } from 'vitest';
import { newSourceCache } from 'data-explorer-core';
import { FolderHierarchy, type HierarchyItem } from 'data-explorer-view/model';
import { expectGolden, fakeFile, filesUnder, fixtureFolders } from './fixtures.js';
import { nodeReader } from './nodeReads.js';

/** One row of the tree, as drawn, with what expanding it shows. */
interface TreeRow {
  label: string;
  kind: string;
  groupKind?: string;
  /** The file the row opens (a project group opens its marker); none for a missing reference. */
  id?: string;
  /** The decoration state HealthDecorationProvider badges the row with, or null for none. */
  health?: string | null;
  collapsible: 'none' | 'collapsed';
  description?: string;
  children?: TreeRow[];
}

// The fields of a row the provider's getTreeItem turns into what a user reads, in the order the
// goldens record them. No document is dirty in a fresh window, so the one health state a row can
// have is `cycle`.
function drawn(item: HierarchyItem): TreeRow {
  const row: Partial<TreeRow> = { label: item.label, kind: item.kind };
  if (item.groupKind !== undefined) row.groupKind = item.groupKind;
  if (item.id !== undefined) row.id = item.id;
  if (item.health !== undefined) row.health = item.health;
  row.collapsible = item.collapsible;
  if (item.description !== undefined) row.description = item.description;
  return row as TreeRow;
}

/** `items` drawn, and every one with a twisty expanded through `getChildren` (`children`). */
async function expanded(hierarchy: FolderHierarchy, items: HierarchyItem[]): Promise<TreeRow[]> {
  const rows: TreeRow[] = [];
  for (const item of items) {
    const row = drawn(item);
    if (row.collapsible === 'collapsed') {
      row.children = await expanded(hierarchy, await hierarchy.children(item));
    }
    rows.push(row);
  }
  return rows;
}

// Generous, as in tables.test.ts: each test reads and parses a whole folder.
describe('golden relationship trees', { timeout: 60_000 }, () => {
  for (const folder of fixtureFolders()) {
    it(folder, async () => {
      // mirrors SectionsTreeProvider.ts's FolderHierarchy, over the folder as the workspace, in
      // code-point order — `findFiles` promises none, and folder order is what decides which of
      // two same-named files a reference resolves to.
      const files = filesUnder(folder).map(fakeFile);
      expect(files.length, `${folder} has files to draw`).toBeGreaterThan(0);
      const hierarchy = new FolderHierarchy({
        files: { list: async () => files },
        reader: (listed) => nodeReader(listed),
        cache: newSourceCache(),
      });
      await expectGolden(await expanded(hierarchy, await hierarchy.roots()), folder, 'hierarchy');
    });
  }
});
