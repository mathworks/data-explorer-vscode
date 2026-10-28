// Copyright 2026 The MathWorks, Inc.
//
// What the Data Explorer sidebar shows for every fixture folder, pinned as a golden (see
// tables.test.ts for why these exist): the relationship tree expanded all the way down, one
// `hierarchy.json` per folder, under the folder's own snapshot directory.
//
// The tree is built the way SectionsTreeProvider builds it — every supported file in the folder
// through the shared cache's cheap tier (`graphSourcesOf`) into a `RelGraph` — and each node is
// recorded as the provider's `getTreeItem` draws it, which is the vscode half copied here. Every
// row a user can expand is expanded, as a user clicking every twisty would; a cycle row offers no
// twisty, and that is where an expansion ends.
import { describe, expect, it } from 'vitest';
import { RelGraph, type GraphNode } from '../../src/host/graphModel.js';
import { graphSourcesOf } from '../../src/host/structuralIndex.js';
import { newSourceCache } from '../../src/host/sourceCache.js';
import { fakeFile, filesUnder, fixtureFolders, snapshotPath, snapshotText } from './fixtures.js';
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

// mirrors SectionsTreeProvider.ts:55 getTreeItem, for the parts a user reads: the label, the
// twisty, the description and the health badge. No document is dirty in a fresh window, so the
// one health state a row can have is `cycle` (SectionsTreeProvider.ts:203 healthOf).
function drawn(el: GraphNode): Omit<TreeRow, 'children'> {
  if (el.kind === 'missing') {
    return { label: el.label, kind: el.kind, collapsible: 'none', description: 'unresolved reference' };
  }
  if (el.kind === 'group') {
    return {
      label: el.label,
      kind: el.kind,
      groupKind: el.groupKind,
      ...(el.groupKind === 'project' && el.uriString ? { id: el.uriString } : {}),
      collapsible: el.hasChildren ? 'collapsed' : 'none',
    };
  }
  return {
    label: el.label,
    kind: el.kind,
    id: el.uriString,
    health: el.cycle ? 'cycle' : null,
    collapsible: el.cycle || !el.hasChildren ? 'none' : 'collapsed',
    ...(el.cycle ? { description: '↻ circular reference' } : {}),
  };
}

/** `nodes` drawn, and every one with a twisty expanded through `getChildren` (graph.children). */
function expanded(graph: RelGraph, nodes: GraphNode[]): TreeRow[] {
  return nodes.map((el) => {
    const row: TreeRow = drawn(el);
    if (row.collapsible === 'collapsed') row.children = expanded(graph, graph.children(el));
    return row;
  });
}

// Generous, as in tables.test.ts: each test reads and parses a whole folder.
describe('golden relationship trees', { timeout: 60_000 }, () => {
  for (const folder of fixtureFolders()) {
    it(folder, async () => {
      // mirrors SectionsTreeProvider.ts:171 buildGraph, over the folder as the workspace, in
      // code-point order — `findFiles` promises none, and folder order is what decides which of
      // two same-named files a reference resolves to.
      const files = filesUnder(folder).map(fakeFile);
      expect(files.length, `${folder} has files to draw`).toBeGreaterThan(0);
      const graph = new RelGraph(await graphSourcesOf(newSourceCache(), nodeReader(files), files));
      await expect(snapshotText(expanded(graph, graph.roots()))).toMatchFileSnapshot(snapshotPath(folder, 'hierarchy'));
    });
  }
});
