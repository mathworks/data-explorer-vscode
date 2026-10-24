// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The ruling: Description is just a property. If the object has it, show it and allow
// editing; if the object has no such property, show the cell as not applicable — the
// grayed-out cell a blank Value or Data Type already gets.
//
// Core says which on every row: `_descriptionApplies` (beside `Description` and
// `_descriptionEditable`). false is "this object has no Description property at all" — a
// plain MATLAB variable, a value inside another — and that is NOT the same as a Description
// that is empty, or one this file could not save (`_descriptionEditable: false`): an empty
// property is an ordinary empty value and keeps today's look. So the not-applicable state
// here is stated by core, not inferred from a blank, and Description stays OUT of
// NOT_APPLICABLE_WHEN_BLANK. A row from an older core carries no key, and is drawn and edited
// exactly as before.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const COLUMNS = ['Name', 'Value', 'DataType', 'Description', 'Status'];

beforeEach(() => localStorage.clear());

function makeRow(id: string, extra: Partial<TreeTableRow> & Record<string, unknown> = {}): TreeTableRow {
  return { ID: id, parent: null, Name: { label: id, editable: true }, Value: '1', DataType: 'double', Description: '', Status: '', ...extra } as TreeTableRow;
}

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

const cell = (t: DexTreeTable, rowId: string, col = 'Description'): HTMLElement =>
  t.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] td.col-${col}`) as HTMLElement;

function recordEdits(t: DexTreeTable): any[] {
  const edits: any[] = [];
  t.addEventListener('dex-edit-completed', (e) => edits.push((e as CustomEvent).detail));
  return edits;
}

async function dblclick(t: DexTreeTable, rowId: string, col = 'Description'): Promise<boolean> {
  (t as any)._editingCell = null;
  cell(t, rowId, col).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await t.updateComplete;
  return (t as any)._editingCell !== null;
}

// The rows of the ruling, one each. `na` carries text on purpose: a row that says the
// property does not exist must not show whatever the cell happens to hold.
const NA = makeRow('na', { _descriptionApplies: false, Description: 'stale text' });
const HAS = makeRow('has', { _descriptionApplies: true, _descriptionEditable: true, Description: 'gain of the loop' });
const OLD = makeRow('old', { Description: 'from an older core' });
const UNSAVABLE = makeRow('unsavable', { _descriptionApplies: true, _descriptionEditable: false, Description: 'kept as is' });

describe('a Description the object does not have', () => {
  it('is drawn with the not-applicable wash a blank Value or Data Type gets, and no text', async () => {
    const t = await mount([NA]);
    expect(cell(t, 'na').className).toContain('cell-readonly');
    expect(cell(t, 'na').className).toContain('cell-blank');
    expect(cell(t, 'na').textContent!.trim()).toBe('');
    // The same class, so the same look: nothing new was invented for it.
    const dataTypeNa = await mount([makeRow('bus', { DataType: '', Value: { text: '<1x1 Simulink.Bus>' } })]);
    expect(cell(dataTypeNa, 'bus', 'DataType').className).toBe(cell(t, 'na').className.replace('col-Description', 'col-DataType'));
    t.remove();
    dataTypeNa.remove();
  });

  it('opens no editor from a double-click or Enter, so no edit can be posted', async () => {
    const t = await mount([NA]);
    const edits = recordEdits(t);
    expect(await dblclick(t, 'na')).toBe(false);
    // Enter on the focused Description cell: the keyboard's way into the same editor.
    t.selectedRowIds = ['na'];
    (t as any)._focusedCol = COLUMNS.indexOf('Description');
    await t.updateComplete;
    const grid = t.shadowRoot!.querySelector('[role="treegrid"]') as HTMLElement;
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await t.updateComplete;
    expect((t as any)._editingCell).toBeNull();
    expect(edits).toEqual([]);
    t.remove();
  });

  it('reads as blank for search and sort, as it paints', async () => {
    // _getCellText is the string the table searches, sorts and copies by; a not-applicable
    // cell that still matched on its hidden text would surface a row for a word it does not show.
    const t = await mount([NA, HAS]);
    expect((t as any)._getCellText(NA, 'Description')).toBe('');
    t.remove();
  });

  it('an editor already open is closed when a repaint says the property is gone', async () => {
    // Kept open, it was an input inside a grayed cell whose typing the commit then threw
    // away. Closed as a repaint closes one whose cell is gone: as Escape does, writing
    // nothing, with the keyboard back on the table.
    const row = makeRow('gone', { _descriptionApplies: true, Description: 'before' });
    const t = await mount([row]);
    const edits = recordEdits(t);
    expect(await dblclick(t, 'gone')).toBe(true);
    await t.updateComplete;
    const input = t.shadowRoot!.querySelector('.edit-input') as HTMLInputElement;
    input.focus();
    input.value = 'half-typed';
    t.rows = [{ ...row, _descriptionApplies: false } as TreeTableRow];
    await t.updateComplete;
    await t.updateComplete;
    expect((t as any)._editingCell).toBeNull();
    expect(t.shadowRoot!.querySelector('.edit-input')).toBeNull();
    expect(cell(t, 'gone').className).toContain('cell-blank');
    expect(edits).toEqual([]);
    expect(t.shadowRoot!.activeElement).toBe((t as any)._container);
    t.remove();
  });

  it('as is any editor whose cell a repaint makes read-only, and one still editable is kept', async () => {
    // The same rule as the Description, through the one place that says whether a cell opens
    // an editor (_cellEditTarget): a Value the host now says is read-only would only commit
    // an edit the host refuses.
    const ro = makeRow('ro', { Value: { text: 'v1', editable: true } });
    const kept = makeRow('kept', { Value: { text: 'v2', editable: true } });
    const t = await mount([ro, kept]);
    const edits = recordEdits(t);
    await dblclick(t, 'ro', 'Value');
    t.rows = [{ ...ro, Value: { text: 'v1', editable: false } } as TreeTableRow, kept];
    await t.updateComplete;
    expect((t as any)._editingCell).toBeNull();
    await dblclick(t, 'kept', 'Value');
    (t.shadowRoot!.querySelector('.edit-input') as HTMLInputElement).value = 'typed';
    t.rows = [ro, { ...kept }];
    await t.updateComplete;
    expect((t as any)._editingCell).toMatchObject({ rowId: 'kept', columnId: 'Value' });
    expect((t.shadowRoot!.querySelector('.edit-input') as HTMLInputElement).value).toBe('typed');
    expect(edits).toEqual([]);
    (t as any)._editingCell = null;
    t.remove();
  });

  it('an editor already open when a repaint says the property is gone posts nothing', async () => {
    // The row can change under an open editor (the object was retyped by another view).
    const row = makeRow('flip', { _descriptionApplies: true, Description: 'before' });
    const t = await mount([row]);
    const edits = recordEdits(t);
    expect(await dblclick(t, 'flip')).toBe(true);
    const input = t.shadowRoot!.querySelector('.edit-input') as HTMLInputElement;
    input.value = 'typed';
    t.rows = [{ ...row, _descriptionApplies: false } as TreeTableRow];
    (t as any)._visibleRowsCache = null;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await t.updateComplete;
    expect(edits).toEqual([]);
    t.remove();
  });
});

describe('a Description the object has', () => {
  it('shows its text and edits, posting the change', async () => {
    const t = await mount([HAS]);
    const edits = recordEdits(t);
    expect(cell(t, 'has').className).toContain('cell-editable');
    expect(cell(t, 'has').textContent).toContain('gain of the loop');
    expect(await dblclick(t, 'has')).toBe(true);
    const input = t.shadowRoot!.querySelector('.edit-input') as HTMLInputElement;
    input.value = 'loop gain';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await t.updateComplete;
    expect(edits).toEqual([{ rowId: 'has', columnId: 'Description', oldValue: 'gain of the loop', newValue: 'loop gain' }]);
    t.remove();
  });

  it('one this file cannot save is read-only but present: dimmed, not washed', async () => {
    const t = await mount([UNSAVABLE]);
    expect(cell(t, 'unsavable').className).toContain('cell-readonly');
    expect(cell(t, 'unsavable').className).not.toContain('cell-blank');
    expect(cell(t, 'unsavable').textContent).toContain('kept as is');
    expect(await dblclick(t, 'unsavable')).toBe(false);
    t.remove();
  });

  it('an EMPTY one is an ordinary empty value: editable, no wash', async () => {
    const t = await mount([makeRow('empty', { _descriptionApplies: true, Description: '' })]);
    expect(cell(t, 'empty').className).toContain('cell-editable');
    expect(cell(t, 'empty').className).not.toContain('cell-blank');
    t.remove();
  });
});

describe('a row from a core that does not say', () => {
  it('is drawn and edited exactly as before', async () => {
    const t = await mount([OLD, makeRow('oldRo', { _descriptionEditable: false, Description: '' })]);
    expect(cell(t, 'old').className).toContain('cell-editable');
    expect(cell(t, 'old').textContent).toContain('from an older core');
    expect(await dblclick(t, 'old')).toBe(true);
    (t as any)._editingCell = null;
    // A Description that cannot be saved, empty, from an older core: read-only, and still
    // NOT washed — Description is not in NOT_APPLICABLE_WHEN_BLANK, and only core's own
    // `_descriptionApplies: false` makes the cell not applicable.
    expect(cell(t, 'oldRo').className).toContain('cell-readonly');
    expect(cell(t, 'oldRo').className).not.toContain('cell-blank');
    t.remove();
  });
});
