// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Column customization: the column menu shows/hides and reorders columns, layered
// on top of the host-provided `columns` set. Class and Kind ship hidden by
// default; Name is pinned first and cannot be hidden or moved; Reset restores the
// default arrangement; persistence round-trips through localStorage; and an
// unqualified search matches across every visible column.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';
import { COLUMNS, COLUMN_GROUPS } from '../src/host/rowBuilder.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class', 'Description', 'dimensions', 'dimensionsMode', 'complexity', 'Min', 'Max', 'Unit', 'storageClass', 'headerFile', 'alignment', 'definitionFile', 'preStatement', 'postStatement', 'qualifier', 'bankName', 'variantConditions', 'allChoicesCoderInfo', 'activeChoiceCoderInfo', 'lastModified', 'lastModifiedBy'];

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

  it('orders visible columns Name, Value, Data Type, Usage, Status, Description by default', () => {
    const table = makeTable();
    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Description']);
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

    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Description']);
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

// Ruling V-077 (2026-10-16), option (b), forward-only. A saved hidden set records which
// built-in columns existed when it was saved ('dex-known-columns'). A default-hidden
// column that ships after that save starts hidden instead of leaking into view. Columns
// the saved set already knew keep the user's choice, and a set saved before the key
// existed is left as it is (the test above is that case, and stays as it was).
describe('a column added after the hidden set was saved gets its default (V-077)', () => {
  // The built-in universe and defaults, read off a fresh table rather than retyped.
  const universe = (): string[] => [...((new DexTreeTable() as any)._columnOrder as string[])];
  const defaultHidden = (): string[] => [...((new DexTreeTable() as any)._hiddenColumns as Set<string>)];
  const savedHidden = (): string[] => JSON.parse(localStorage.getItem('dex-hidden-columns')!) as string[];
  const savedKnown = (): string | null => localStorage.getItem('dex-known-columns');

  function loaded(): DexTreeTable {
    const table = makeTable();
    (table as any)._loadPersistedState();
    return table;
  }

  // Storage as a user left it before lastModifiedBy shipped, with every column shown.
  function savedBeforeLastModifiedBy(): void {
    localStorage.setItem('dex-hidden-columns', JSON.stringify([]));
    localStorage.setItem('dex-known-columns', JSON.stringify(universe().filter((c) => c !== 'lastModifiedBy')));
  }

  it('guard: every default-hidden column is in the built-in universe the key records', () => {
    const all = new Set(universe());
    expect(defaultHidden().length).toBeGreaterThan(0);
    for (const c of defaultHidden()) expect(all.has(c), c).toBe(true);
  });

  it('a default-hidden column the saved set never knew starts hidden, and known columns keep the choice', () => {
    savedBeforeLastModifiedBy();
    const cols = visibleCols(loaded());
    expect(cols).not.toContain('lastModifiedBy');
    // Default-hidden too, but known when the user chose to show them.
    expect(cols).toContain('Kind');
    expect(cols).toContain('Class');
    expect(cols).toContain('lastModified');
  });

  it('the load writes the merged set and the current universe back, so the next load agrees', () => {
    savedBeforeLastModifiedBy();
    const first = visibleCols(loaded());
    expect(savedHidden()).toContain('lastModifiedBy');
    expect(savedKnown()).toBe(JSON.stringify(universe()));
    expect(visibleCols(loaded())).toEqual(first);
  });

  it('a column the load just hid stays visible once the user shows it', () => {
    savedBeforeLastModifiedBy();
    const table = loaded();
    expect(visibleCols(table)).not.toContain('lastModifiedBy');
    (table as any)._toggleColumnVisibility('lastModifiedBy');
    expect(visibleCols(table)).toContain('lastModifiedBy');
    expect(visibleCols(loaded())).toContain('lastModifiedBy');
  });

  it('a set saved before the key existed is left as it is, and is stamped with the universe', () => {
    localStorage.setItem('dex-column-order', JSON.stringify(['Name', 'Value', 'DataType', 'UsedBy', 'Status']));
    localStorage.setItem('dex-hidden-columns', JSON.stringify([]));
    const cols = visibleCols(loaded());
    expect([...cols].sort()).toEqual([...HOST_COLUMNS].sort());
    expect(savedHidden()).toEqual([]);
    expect(savedKnown()).toBe(JSON.stringify(universe()));
  });

  it('an unreadable known key is treated as absent, and the saved hidden set still applies', () => {
    for (const bad of ['{not json', '{"a":1}', '"Kind"']) {
      localStorage.clear();
      localStorage.setItem('dex-hidden-columns', JSON.stringify(['Value']));
      localStorage.setItem('dex-known-columns', bad);
      const cols = visibleCols(loaded());
      expect(cols, bad).not.toContain('Value');
      // Absent means legacy: nothing else is hidden on its account.
      expect(cols, bad).toContain('lastModifiedBy');
      expect(savedKnown(), bad).toBe(JSON.stringify(universe()));
    }
  });

  it('with no saved hidden set, nothing is written on load', () => {
    localStorage.setItem('dex-column-order', JSON.stringify(['Name', 'Status', 'Value']));
    loaded();
    expect(localStorage.getItem('dex-hidden-columns')).toBeNull();
    expect(savedKnown()).toBeNull();
  });

  it('a toggle writes the known key', () => {
    (makeTable() as any)._toggleColumnVisibility('Kind');
    expect(savedKnown()).toBe(JSON.stringify(universe()));
  });

  it('a reorder writes the known key', () => {
    const table = makeTable() as any;
    table._menuDragCol = 'Status';
    table._menuDragOverSide = 'top';
    table._onMenuDrop('Value', { preventDefault() {} } as unknown as DragEvent);
    expect(savedKnown()).toBe(JSON.stringify(universe()));
  });

  it('a reset writes the known key', () => {
    (makeTable() as any)._resetColumns({ stopPropagation() {} } as Event);
    expect(savedKnown()).toBe(JSON.stringify(universe()));
  });

  it('a table attached to the page renders no header for the column the saved set never knew', async () => {
    savedBeforeLastModifiedBy();
    const table = makeTable();
    // The header renders only over rows.
    table.rows = [row('a', {})];
    document.body.appendChild(table);
    await table.updateComplete;
    const labels = Array.from(table.shadowRoot!.querySelectorAll('th .th-label')).map((el) => el.textContent!.trim());
    table.remove();
    expect(labels).toContain('Kind');
    expect(labels).toContain('lastModified');
    expect(labels).not.toContain('lastModifiedBy');
  });
});

describe('schema-driven object-property columns', () => {
  const SCHEMA_COLS = ['dimensions', 'complexity', 'dimensionsMode', 'storageClass', 'headerFile', 'alignment'];

  it('the schema columns ship hidden by default', () => {
    const table = makeTable();
    // Default visible set is the legacy arrangement; the schema columns are hidden.
    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Description']);
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

  it('_getCellText unwraps an editable object cell to its .text', () => {
    const table = makeTable();
    const r = row('p', { storageClass: { text: 'Auto', editable: true, editor: 'select', options: ['Auto', 'ExportedGlobal'] } } as any);
    expect((table as any)._getCellText(r, 'storageClass')).toBe('Auto');
  });
});

describe('editable Code Generation cells', () => {
  it('double-clicking an editable select cell enters edit mode with editor + options', () => {
    const table = makeTable();
    const r = row('p', {
      storageClass: { text: 'Auto', editable: true, editor: 'select', options: ['Auto', 'ExportedGlobal', 'Custom'] },
    } as any);
    (table as any)._onCellDblClickIfEditable(r, 'storageClass');
    const editing = (table as any)._editingCell;
    expect(editing).toMatchObject({ rowId: 'p', columnId: 'storageClass', value: 'Auto', editor: 'select' });
    expect(editing.options).toContain('ExportedGlobal');
  });

  it('double-clicking an editable text cell (alignment) enters edit mode as text', () => {
    const table = makeTable();
    const r = row('p', { alignment: { text: '-1', editable: true, editor: 'text' } } as any);
    (table as any)._onCellDblClickIfEditable(r, 'alignment');
    expect((table as any)._editingCell).toMatchObject({ rowId: 'p', columnId: 'alignment', value: '-1', editor: 'text' });
  });

  it('double-clicking a read-only (plain string) schema cell does NOT enter edit mode', () => {
    const table = makeTable();
    const r = row('p', { dimensions: '[1 1]' } as any);
    (table as any)._onCellDblClickIfEditable(r, 'dimensions');
    expect((table as any)._editingCell).toBeNull();
  });

  it('an editable-object cell without editable:true is not edited', () => {
    const table = makeTable();
    const r = row('p', { storageClass: { text: 'Auto' } } as any);
    (table as any)._onCellDblClickIfEditable(r, 'storageClass');
    expect((table as any)._editingCell).toBeNull();
  });
});

// Ruling 2026-10-18, group F (C-168B, C-169B): a Simulink.VariantBank's own fields and a
// Simulink.VariantBankCoderInfo's are columns, which ship hidden like the other grouped columns.
describe('the Variant Bank and coder info columns', () => {
  const BANK_COLS = ['bankName', 'variantConditions', 'allChoicesCoderInfo', 'activeChoiceCoderInfo'];
  const CODER_INFO_COLS = ['definitionFile', 'preStatement', 'postStatement', 'qualifier'];
  const NEW_COLS = [...CODER_INFO_COLS, ...BANK_COLS];

  it("this file's host columns are the host's own", () => {
    expect(HOST_COLUMNS).toEqual(COLUMNS);
  });

  it('ship hidden by default, and are in the picker to be shown', () => {
    const table = makeTable();
    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Description']);
    for (const col of NEW_COLS) {
      expect((table as any)._orderedColumns, col).toContain(col);
      expect(visibleCols(table), col).not.toContain(col);
    }
  });

  it('a column shown from the picker is drawn', () => {
    const table = makeTable();
    (table as any)._toggleColumnVisibility('qualifier');
    expect(visibleCols(table)).toContain('qualifier');
  });

  it('a hidden set saved before they shipped loads them hidden, and keeps every other choice (V-077)', () => {
    const universe = [...((new DexTreeTable() as any)._columnOrder as string[])];
    localStorage.setItem('dex-hidden-columns', JSON.stringify([]));
    localStorage.setItem('dex-known-columns', JSON.stringify(universe.filter((c) => !NEW_COLS.includes(c))));
    const table = makeTable();
    (table as any)._loadPersistedState();
    for (const col of NEW_COLS) expect(visibleCols(table), col).not.toContain(col);
    expect(visibleCols(table)).toEqual(HOST_COLUMNS.filter((c) => !NEW_COLS.includes(c)));
  });

  it("with the host's groups, the picker draws each group's header once, in the default order", async () => {
    const table = makeTable();
    (table as any).columnGroups = COLUMN_GROUPS;
    (table as any)._hiddenColumns = new Set();
    (table as any)._columnMenuOpen = true;
    document.body.appendChild(table as any);
    await (table as any).updateComplete;
    const headers = Array.from(
      (table as any).shadowRoot.querySelectorAll('.column-menu-group-header'),
    ).map((el: any) => el.textContent.trim());
    const items = (table as any).shadowRoot.querySelectorAll('.column-menu-item').length;
    (table as any).remove();
    expect(headers).toEqual(['Data Object', 'Code Generation', 'Variant Bank', 'Data Dictionary']);
    expect(items).toBe(HOST_COLUMNS.length);
  });

  it('each has a default width of its own, not the fallback for a column the table does not know', () => {
    const WEIGHTS: Record<string, number> = {
      definitionFile: 16,
      preStatement: 16,
      postStatement: 16,
      qualifier: 10,
      bankName: 14,
      variantConditions: 20,
      allChoicesCoderInfo: 16,
      activeChoiceCoderInfo: 16,
    };
    for (const col of NEW_COLS) {
      const table = new DexTreeTable();
      table.columns = ['Name', col];
      (table as any)._hiddenColumns = new Set();
      // Name weighs 30, so a column's share beside it says its weight.
      expect((table as any)._getColWidth(col), col).toBe(`${(WEIGHTS[col] / (30 + WEIGHTS[col])) * 100}%`);
    }
  });
});

describe('dictionary metadata columns', () => {
  const META_COLS = ['lastModified', 'lastModifiedBy'];

  it('the metadata columns ship hidden by default', () => {
    const table = makeTable();
    expect(visibleCols(table)).toEqual(['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Description']);
    for (const col of META_COLS) {
      expect(visibleCols(table)).not.toContain(col);
    }
  });

  it('a hidden metadata column is still available/orderable (shows in the picker)', () => {
    const table = makeTable();
    expect((table as any)._orderedColumns).toContain('lastModified');
    expect((table as any)._orderedColumns).toContain('lastModifiedBy');
  });

  it('renders/sorts a metadata column generically from row[key]', () => {
    const table = makeTable();
    const r = row('p', { lastModified: '2026-07-04T01:52:02Z', lastModifiedBy: 'weiwang' } as any);
    expect((table as any)._getCellText(r, 'lastModified')).toBe('2026-07-04T01:52:02Z');
    expect((table as any)._getCellText(r, 'lastModifiedBy')).toBe('weiwang');
  });
});

describe('header labels come from the host-provided map', () => {
  it('renders host columnLabels for a column and falls back to the raw key', async () => {
    const table = makeTable();
    // The host is the single source of truth for labels; the component no longer
    // keeps a static fallback map, so an unmapped key renders as its raw key.
    (table as any).columnLabels = { DataType: 'Data Type', UsedBy: 'Usage' };
    (table as any).rows = [row('a', { DataType: 'int8' })];
    document.body.appendChild(table as any);
    await (table as any).updateComplete;
    const labels = Array.from((table as any).shadowRoot.querySelectorAll('.th-label')).map((el: any) => el.textContent.trim());
    // DataType is mapped; Value has no entry in the provided map -> raw key.
    expect(labels).toContain('Data Type');
    expect(labels).toContain('Value');
    (table as any).remove();
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

describe('grouped column picker', () => {
  it('renders a group header before the schema columns and none for ungrouped ones', async () => {
    const table = makeTable();
    // Mirror the host grouping: every column in each group is mapped, so the
    // groups stay contiguous in the default order (a header renders once per
    // group). Data Dictionary covers the trailing metadata columns.
    (table as any).columnGroups = {
      dimensions: 'Data Object',
      dimensionsMode: 'Data Object',
      complexity: 'Data Object',
      Min: 'Data Object',
      Max: 'Data Object',
      Unit: 'Data Object',
      storageClass: 'Code Generation',
      headerFile: 'Code Generation',
      alignment: 'Code Generation',
      lastModified: 'Data Dictionary',
      lastModifiedBy: 'Data Dictionary',
    };
    (table as any)._hiddenColumns = new Set();
    (table as any)._columnMenuOpen = true;
    document.body.appendChild(table as any);
    await (table as any).updateComplete;
    const headers = Array.from(
      (table as any).shadowRoot.querySelectorAll('.column-menu-group-header'),
    ).map((el: any) => el.textContent.trim());
    expect(headers).toEqual(['Data Object', 'Code Generation', 'Data Dictionary']);
    const items = (table as any).shadowRoot.querySelectorAll('.column-menu-item');
    expect(items.length).toBe(HOST_COLUMNS.length);
    (table as any).remove();
  });

  it('renders no group headers when columnGroups is null', async () => {
    const table = makeTable();
    (table as any)._columnMenuOpen = true;
    document.body.appendChild(table as any);
    await (table as any).updateComplete;
    expect((table as any).shadowRoot.querySelectorAll('.column-menu-group-header').length).toBe(0);
    (table as any).remove();
  });
});

// The tests above drive the handlers directly, which proves the reordering
// arithmetic but not that the menu is wired to it: a template binding on the
// wrong event, or a checkbox whose click is not contained, is invisible to them
// and breaks the picker for the user. These go through real DOM events instead.
//
// happy-dom has no layout engine, so getBoundingClientRect() is all zeros and the
// top/bottom midpoint test always resolves to 'bottom'. Dropping above a column
// therefore can't be exercised this way; the 'top' side is covered by the direct
// handler tests above.
describe('the column menu responds to real DOM events', () => {
  async function openMenu(): Promise<DexTreeTable> {
    const table = makeTable();
    (table as any)._hiddenColumns = new Set<string>();
    (table as any)._columnMenuOpen = true;
    document.body.appendChild(table);
    await table.updateComplete;
    return table;
  }

  // The visible label, not the item's textContent — that also picks up the drag
  // grip glyph and the checkbox.
  function menuItem(table: DexTreeTable, col: string): HTMLElement {
    const items = Array.from(table.shadowRoot!.querySelectorAll('.column-menu-item')) as HTMLElement[];
    const found = items.find((el) => (el.querySelector('.col-label') as HTMLElement).textContent!.trim() === col);
    if (!found) throw new Error(`no column-menu item for ${col}`);
    return found;
  }

  function drag(item: HTMLElement, type: string, dataTransfer: DataTransfer): void {
    item.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  }

  it('a drag-and-drop through the DOM reorders the columns', async () => {
    const table = await openMenu();
    const dt = new DataTransfer();
    drag(menuItem(table, 'Status'), 'dragstart', dt);
    expect((table as any)._menuDragCol).toBe('Status');

    drag(menuItem(table, 'Value'), 'dragover', dt);
    expect((table as any)._menuDragOverCol).toBe('Value');

    drag(menuItem(table, 'Value'), 'drop', dt);
    const order = (table as any)._orderedColumns as string[];
    expect(order.indexOf('Status')).toBe(order.indexOf('Value') + 1); // dropped below
    expect(order[0]).toBe('Name');
    // The drop clears the drag state, so a stale highlight cannot linger.
    expect((table as any)._menuDragCol).toBeNull();
    expect((table as any)._menuDragOverCol).toBeNull();
    table.remove();
  });

  it('a drag over the upper half of an item drops the column BEFORE it', async () => {
    // Which side of an item the cursor is on is decided by comparing the pointer
    // against the item's midpoint, and it is the only thing that distinguishes
    // "insert above" from "insert below". Get it the wrong way round and every
    // reorder lands one slot away from where the user aimed. The test above covers
    // the lower half, which is what happy-dom's all-zero rects produce by default,
    // so the item's box is stubbed here to put the pointer genuinely above the mid.
    //
    // The dragover is dispatched as a MouseEvent: happy-dom's DragEvent is a bare
    // Event that drops clientX/clientY, so a DragEvent here would arrive with no
    // pointer position at all and could only ever produce 'bottom'. The handler
    // reads nothing a MouseEvent lacks.
    const table = await openMenu();
    const target = menuItem(table, 'Value');
    const box = { x: 0, y: 100, top: 100, left: 0, right: 200, bottom: 120, width: 200, height: 20 };
    target.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;

    const dt = new DataTransfer();
    drag(menuItem(table, 'Status'), 'dragstart', dt);
    target.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 104 }));
    expect((table as any)._menuDragOverSide).toBe('top');
    drag(target, 'drop', dt);
    const order = (table as any)._orderedColumns as string[];
    expect(order.indexOf('Status')).toBe(order.indexOf('Value') - 1);
    table.remove();
  });

  it('the drop is accepted by preventing the default, or the browser would discard it', async () => {
    const table = await openMenu();
    const dt = new DataTransfer();
    drag(menuItem(table, 'Status'), 'dragstart', dt);
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    menuItem(table, 'Value').dispatchEvent(over);
    // An un-prevented dragover means "not a drop target": no drop event ever
    // fires and the reorder silently never happens.
    expect(over.defaultPrevented).toBe(true);
    table.remove();
  });

  it('dragging Name is refused at dragstart', async () => {
    const table = await openMenu();
    const start = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    menuItem(table, 'Name').dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    expect((table as any)._menuDragCol).toBeNull();
    table.remove();
  });

  it('dragging away from an item clears its drop highlight', async () => {
    const table = await openMenu();
    const dt = new DataTransfer();
    drag(menuItem(table, 'Status'), 'dragstart', dt);
    drag(menuItem(table, 'Value'), 'dragover', dt);
    expect((table as any)._menuDragOverCol).toBe('Value');
    menuItem(table, 'Value').dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
    expect((table as any)._menuDragOverCol).toBeNull();
    table.remove();
  });

  it('a drag abandoned outside the menu leaves no drag state behind', async () => {
    // Without this the next plain click on a menu item would be treated as the
    // drop of a drag the user already gave up on.
    const table = await openMenu();
    const dt = new DataTransfer();
    drag(menuItem(table, 'Status'), 'dragstart', dt);
    menuItem(table, 'Status').dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    expect((table as any)._menuDragCol).toBeNull();
    expect((table as any)._menuDragOverSide).toBeNull();
    table.remove();
  });

  // A menu row is a <label> wrapping a checkbox, so the browser forwards a click
  // on ANY part of the row to that checkbox. A row that also toggled on its own
  // click would therefore toggle twice per click — and two toggles cancel out.
  // REGRESSION: that is what happened, and it left clicking a column's name or
  // its drag grip doing nothing; only a direct hit on the small checkbox worked.
  function toggles(table: DexTreeTable): string[] {
    const seen: string[] = [];
    const original = (table as any)._toggleColumnVisibility.bind(table);
    (table as any)._toggleColumnVisibility = (col: string): void => {
      seen.push(col);
      original(col);
    };
    return seen;
  }

  it('clicking the checkbox toggles the column exactly once', async () => {
    const table = await openMenu();
    const seen = toggles(table);
    const box = menuItem(table, 'Status').querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    box.click();
    await table.updateComplete;
    expect(seen).toEqual(['Status']);
    expect((table as any)._visibleColumns).not.toContain('Status');
    table.remove();
  });

  it("REGRESSION: clicking a column's name toggles it exactly once", async () => {
    const table = await openMenu();
    const seen = toggles(table);
    (menuItem(table, 'Status').querySelector('.col-label') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await table.updateComplete;
    expect(seen).toEqual(['Status']);
    expect((table as any)._visibleColumns).not.toContain('Status');
    table.remove();
  });

  it('REGRESSION: clicking the row background toggles it exactly once', async () => {
    const table = await openMenu();
    const seen = toggles(table);
    menuItem(table, 'Status').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await table.updateComplete;
    expect(seen).toEqual(['Status']);
    expect((table as any)._visibleColumns).not.toContain('Status');
    table.remove();
  });

  it('a second click shows the column again', async () => {
    // The user's undo for a mis-click. With the double toggle this looked like it
    // worked, because both clicks were no-ops.
    const table = await openMenu();
    const label = menuItem(table, 'Status').querySelector('.col-label') as HTMLElement;
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await table.updateComplete;
    expect((table as any)._visibleColumns).not.toContain('Status');
    (menuItem(table, 'Status').querySelector('.col-label') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await table.updateComplete;
    expect((table as any)._visibleColumns).toContain('Status');
    table.remove();
  });

  it("clicking Name's row leaves it visible", async () => {
    // Name is pinned: its checkbox is disabled, so the forwarded click produces
    // no change event and nothing toggles.
    const table = await openMenu();
    const seen = toggles(table);
    menuItem(table, 'Name').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await table.updateComplete;
    expect(seen).toEqual([]);
    expect((table as any)._visibleColumns).toContain('Name');
    table.remove();
  });

  it('a click inside the menu does not reach the document handler that closes it', async () => {
    // The menu closes on any click outside itself. Toggling a column is inside,
    // so the menu must stay open for the user to toggle a second column.
    const table = await openMenu();
    (menuItem(table, 'Status').querySelector('.col-label') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    );
    await table.updateComplete;
    expect((table as any)._columnMenuOpen).toBe(true);
    table.remove();
  });
});
