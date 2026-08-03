// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/dex/components/dex-tree-table.js';

// Sorting a column must reorder rows WITHIN each hierarchy level (siblings),
// never across parent/child boundaries. A child must always stay directly
// beneath its parent, otherwise indentation no longer matches row order and
// the tree looks broken.
function makeRow(id: string, parent: string | null, name: string): TreeTableRow {
  return {
    ID: id,
    parent,
    Name: { label: name },
    Value: '',
    DataType: '',
    Description: '',
    Status: '',
  };
}

function visibleOrder(table: DexTreeTable): string[] {
  // _getVisibleRows is private; the computation touches no DOM.
  return (table as any)._getVisibleRows().map((r: TreeTableRow) => r.ID);
}

describe('dex-tree-table sorting preserves hierarchy', () => {
  it('sorts siblings without detaching children from parents', () => {
    const rows: TreeTableRow[] = [
      makeRow('S', null, 'Section'),
      makeRow('S/z', 'S', 'Zebra'),
      makeRow('S/a', 'S', 'Apple'),
      makeRow('S/m', 'S', 'Mango'),
    ];
    const table = new DexTreeTable();
    table.rows = rows;
    (table as any)._expandedIds = new Set(['S']);
    (table as any)._sortState = [{ column: 'Name', direction: 'asc' }];
    (table as any)._visibleRowsCache = null;

    // Section stays first; its children are sorted alphabetically beneath it.
    expect(visibleOrder(table)).toEqual(['S', 'S/a', 'S/m', 'S/z']);
  });

  it('keeps parents ahead of children even when a child sorts before its parent', () => {
    // Parent "Section" (S) vs child "Apple" (S/a): descending by Name would
    // globally place the child above the parent. Hierarchy must win.
    const rows: TreeTableRow[] = [
      makeRow('S', null, 'Section'),
      makeRow('S/z', 'S', 'Zebra'),
      makeRow('S/a', 'S', 'Apple'),
    ];
    const table = new DexTreeTable();
    table.rows = rows;
    (table as any)._expandedIds = new Set(['S']);
    (table as any)._sortState = [{ column: 'Name', direction: 'desc' }];
    (table as any)._visibleRowsCache = null;

    // Parent first, then children in descending order.
    expect(visibleOrder(table)).toEqual(['S', 'S/z', 'S/a']);
  });

  it('sorts nested grandchildren within their own subtree only', () => {
    const rows: TreeTableRow[] = [
      makeRow('B', null, 'Beta'),
      makeRow('A', null, 'Alpha'),
      makeRow('A/y', 'A', 'Yak'),
      makeRow('A/x', 'A', 'Xray'),
      makeRow('A/x/2', 'A/x', 'Two'),
      makeRow('A/x/1', 'A/x', 'One'),
    ];
    const table = new DexTreeTable();
    table.rows = rows;
    (table as any)._expandedIds = new Set(['A', 'A/x']);
    (table as any)._sortState = [{ column: 'Name', direction: 'asc' }];
    (table as any)._visibleRowsCache = null;

    // Top level: Alpha before Beta. Under Alpha: Xray before Yak.
    // Under Xray: One before Two. Every child stays in its parent's subtree.
    expect(visibleOrder(table)).toEqual(['A', 'A/x', 'A/x/1', 'A/x/2', 'A/y', 'B']);
  });
});
