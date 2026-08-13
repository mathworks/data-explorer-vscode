// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Column customization: the column menu shows/hides and reorders columns, layered
// on top of the host-provided `columns` set. Class and Kind ship hidden by
// default; Name is pinned first and cannot be hidden or moved; Reset restores the
// default arrangement; persistence round-trips through localStorage; and an
// unqualified search matches across every visible column.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/dex/components/dex-tree-table.js';

const HOST_COLUMNS = ['Name', 'Value', 'Class', 'Kind', 'DataType', 'Status', 'UsedBy', 'dimensions', 'complexity', 'storageClass', 'alignment'];

function makeTable(): DexTreeTable {
  const table = new DexTreeTable();
  // The host always provides the supported column set; the component layers the
  // user's order + hidden state on top.
  table.columns = HOST_COLUMNS;
  return table;
}

function visibleCols(table: DexTreeTable): string[] {
  return (table as any)._visibleColumns;
}

function row(id: string, fields: Partial<TreeTableRow>): TreeTableRow {
  return { ID: id, parent: null, Name: { label: id }, Value: '', DataType: '', Class: '', Kind: '', Status: '', ...fields } as TreeTableRow;
}

beforeEach(() => {
  localStorage.clear();
});

describe('default column configuration', () => {
  it('hides Class and Kind by default, keeping the other columns visible', () => {
    const table = makeTable();
    const cols = visibleCols(table);
    expect(cols).not.toContain('Class');
    expect(cols).not.toContain('Kind');
    expect(cols).toContain('Name');
    expect(cols).toContain('Value');
    expect(cols).toContain('DataType');
  });

  it('orders visible columns Name, Value, Data Type, Usage, Status by default', () => {
    const table = makeTable();
    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status']);
  });

  it('Name is always first', () => {
    const table = makeTable();
    expect(visibleCols(table)[0]).toBe('Name');
  });
});

describe('toggling column visibility', () => {
  it('showing Kind adds it to the visible set', () => {
    const table = makeTable();
    (table as any)._toggleColumnVisibility('Kind');
    expect(visibleCols(table)).toContain('Kind');
  });

  it('hiding a visible column removes it', () => {
    const table = makeTable();
    (table as any)._toggleColumnVisibility('Status');
    expect(visibleCols(table)).not.toContain('Status');
  });

  it('Name cannot be hidden', () => {
    const table = makeTable();
    (table as any)._toggleColumnVisibility('Name');
    expect(visibleCols(table)).toContain('Name');
  });

  it('visibility changes persist to localStorage', () => {
    const table = makeTable();
    (table as any)._toggleColumnVisibility('Kind');
    expect(JSON.parse(localStorage.getItem('dex-hidden-columns')!)).not.toContain('Kind');
  });
});

describe('reordering columns from the menu', () => {
  // Simulate a drag of `dragged` onto `target`, dropping on the given side.
  function drop(table: DexTreeTable, dragged: string, target: string, side: 'top' | 'bottom'): void {
    (table as any)._menuDragCol = dragged;
    (table as any)._menuDragOverSide = side;
    (table as any)._onMenuDrop(target, { preventDefault() {} } as unknown as DragEvent);
  }

  it('moves a column before another when dropped on its top', () => {
    const table = makeTable();
    // Move Status to just before Value.
    drop(table, 'Status', 'Value', 'top');
    const order = (table as any)._orderedColumns as string[];
    expect(order.indexOf('Status')).toBeLessThan(order.indexOf('Value'));
    // Name stays pinned first.
    expect(order[0]).toBe('Name');
  });

  it('refuses to move Name and refuses to displace Name', () => {
    const table = makeTable();
    drop(table, 'Name', 'Value', 'top'); // dragging Name is a no-op
    drop(table, 'Value', 'Name', 'top'); // dropping onto Name is a no-op
    expect((table as any)._orderedColumns[0]).toBe('Name');
  });

  it('a reorder persists to localStorage', () => {
    const table = makeTable();
    drop(table, 'Status', 'Value', 'top');
    const saved = JSON.parse(localStorage.getItem('dex-column-order')!) as string[];
    expect(saved.indexOf('Status')).toBeLessThan(saved.indexOf('Value'));
  });
});

describe('reset to default', () => {
  it('restores default order and visibility after customization', () => {
    const table = makeTable();
    (table as any)._toggleColumnVisibility('Kind'); // show Kind
    (table as any)._toggleColumnVisibility('Status'); // hide Status
    (table as any)._menuDragCol = 'DataType';
    (table as any)._menuDragOverSide = 'top';
    (table as any)._onMenuDrop('Value', { preventDefault() {} } as unknown as DragEvent);

    (table as any)._resetColumns({ stopPropagation() {} } as Event);

    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status']);
  });
});

describe('the menu closes when the webview loses focus', () => {
  it('a window blur closes an open column menu', () => {
    const table = makeTable();
    (table as any)._columnMenuOpen = true;
    (table as any)._onWindowBlur();
    expect((table as any)._columnMenuOpen).toBe(false);
  });
});

describe('persisted state is restored', () => {
  it('a saved order + hidden set is applied on load', () => {
    localStorage.setItem('dex-column-order', JSON.stringify(['Name', 'Status', 'Value', 'DataType', 'UsedBy', 'Kind', 'Class']));
    localStorage.setItem('dex-hidden-columns', JSON.stringify(['Value']));
    const table = makeTable();
    (table as any)._loadPersistedState();
    const cols = visibleCols(table);
    expect(cols).not.toContain('Value');
    expect(cols.indexOf('Status')).toBeLessThan(cols.indexOf('DataType'));
  });

  it('a newly added column absent from a saved order still appears', () => {
    // Old persisted order predates Class/Kind existing.
    localStorage.setItem('dex-column-order', JSON.stringify(['Name', 'Value', 'DataType', 'UsedBy', 'Status']));
    localStorage.setItem('dex-hidden-columns', JSON.stringify([]));
    const table = makeTable();
    (table as any)._loadPersistedState();
    // Class and Kind, though missing from the saved order, are still available.
    expect(visibleCols(table)).toContain('Class');
    expect(visibleCols(table)).toContain('Kind');
  });
});

describe('schema-driven object-property columns', () => {
  const SCHEMA_COLS = ['dimensions', 'complexity', 'storageClass', 'alignment'];

  it('the 4 schema columns ship hidden by default', () => {
    const table = makeTable();
    // Default visible set is the legacy arrangement; the schema columns are hidden.
    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status']);
    for (const col of SCHEMA_COLS) {
      expect(visibleCols(table)).not.toContain(col);
    }
  });

  it('a hidden schema column is still available/orderable (shows in the picker)', () => {
    const table = makeTable();
    expect((table as any)._orderedColumns).toContain('storageClass');
  });

  it('renders/sorts a schema column generically from row[key]', () => {
    const table = makeTable();
    const r = row('p', { storageClass: 'ExportedGlobal' } as any);
    // The generic path reads row[columnKey] with no per-column code.
    expect((table as any)._getCellText(r, 'storageClass')).toBe('ExportedGlobal');
  });
});

describe('search matches across visible columns', () => {
  function filter(table: DexTreeTable, text: string, rows: TreeTableRow[]): string[] {
    return (table as any)._filterRows(rows, text).map((r: TreeTableRow) => r.ID);
  }

  it('an unqualified term matches a visible column (Data Type)', () => {
    const table = makeTable();
    const rows = [row('a', { DataType: 'int8' }), row('b', { DataType: 'double' })];
    expect(filter(table, 'int8', rows)).toEqual(['a']);
  });

  it('an unqualified term matches a column only after it is made visible', () => {
    const table = makeTable();
    const rows = [row('a', { Kind: 'Bus Element' }), row('b', { Kind: 'Simulink Parameter' })];
    // Kind is hidden by default -> no match on its content.
    expect(filter(table, 'Bus Element', rows)).toEqual([]);
    // Reveal Kind, and the same search now hits it.
    (table as any)._toggleColumnVisibility('Kind');
    expect(filter(table, 'Bus Element', rows)).toEqual(['a']);
  });

  it('the class: prefix scopes a search to the Class column', () => {
    const table = makeTable();
    (table as any)._toggleColumnVisibility('Class');
    const rows = [row('a', { Class: 'Simulink.Bus' }), row('b', { Class: 'Simulink.Signal' })];
    expect(filter(table, 'class:Simulink.Bus', rows)).toEqual(['a']);
  });

  it('the kind: prefix scopes a search to the Kind column', () => {
    const table = makeTable();
    const rows = [row('a', { Kind: 'Bus Element' }), row('b', { Kind: 'Connection Element' })];
    expect(filter(table, 'kind:Connection', rows)).toEqual(['b']);
  });
});
