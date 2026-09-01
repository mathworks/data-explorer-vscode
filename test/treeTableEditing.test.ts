// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Inline cell editing. This is the one part of the table that WRITES to the
// user's file: `dex-edit-completed` is relayed straight to the host, which
// applies {rowId, columnId, oldValue, newValue} to the .sldd/.mat/.slx. A wrong
// field in that payload does not throw — it quietly changes the wrong entry, or
// the right entry to the wrong value, and the user finds out later. So these
// tests check the payload identity as carefully as the values.
import { describe, it, expect, beforeEach } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

const HOST_COLUMNS = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'storageClass', 'Description'];

// storageClass ships hidden by default, so reveal every column: the generic
// (non-Name/Value/Description) editable-column path only runs for a rendered cell.
beforeEach(() => localStorage.clear());

function makeRow(id: string, name: string, extra: Partial<TreeTableRow> = {}): TreeTableRow {
  return { ID: id, parent: null, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '', ...extra };
}

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = HOST_COLUMNS;
  document.body.appendChild(table);
  (table as any)._hiddenColumns = new Set<string>();
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

// A commit tears the editor down on the next render. Wait for that render to
// actually land (a microtask flush alone leaves the old input in the DOM) before
// opening another editor, the way a real browser would between two user clicks.
async function settle(table: DexTreeTable): Promise<void> {
  await table.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

type Edit = { rowId: string; columnId: string; oldValue: string; newValue: string };

function recordEdits(table: DexTreeTable): Edit[] {
  const edits: Edit[] = [];
  table.addEventListener('dex-edit-completed', (e) => edits.push((e as CustomEvent).detail));
  return edits;
}

// The live editor element for the cell currently being edited.
function editor(table: DexTreeTable): HTMLInputElement {
  return table.shadowRoot!.querySelector('.edit-input') as HTMLInputElement;
}

// A double-click on the rendered cell — the real entry point, so this covers the
// dblclick binding and the per-column editable checks together.
function dblClickCell(table: DexTreeTable, rowId: string, columnId: string): void {
  const td = table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"] td.col-${columnId}`) as HTMLElement;
  td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

describe('opening an editor', () => {
  it('a double-click on an editable Value cell opens an input seeded with the current text', async () => {
    const table = await mount([makeRow('a', 'A', { Value: { text: 'v1', editable: true } })]);
    dblClickCell(table, 'a', 'Value');
    await table.updateComplete;

    expect((table as any)._editingCell).toMatchObject({ rowId: 'a', columnId: 'Value', value: 'v1' });
    expect(editor(table).value).toBe('v1');
    table.remove();
  });

  it('a read-only Value cell does not open an editor', async () => {
    // The host marks a cell non-editable when the underlying entry cannot be
    // written (e.g. a derived or locked field); showing an input would invite the
    // user to type a change that gets silently dropped.
    const table = await mount([makeRow('a', 'A', { Value: { text: 'v1', editable: false } })]);
    dblClickCell(table, 'a', 'Value');
    await table.updateComplete;
    expect((table as any)._editingCell).toBeNull();
    expect(editor(table)).toBeNull();
    table.remove();
  });

  it('a plain-string Value cell honours the row-level _valueEditable flag', async () => {
    const editable = await mount([makeRow('a', 'A', { Value: 'plain', _valueEditable: true })]);
    dblClickCell(editable, 'a', 'Value');
    await editable.updateComplete;
    expect((editable as any)._editingCell).toMatchObject({ columnId: 'Value', value: 'plain' });
    editable.remove();

    const locked = await mount([makeRow('b', 'B', { Value: 'plain' })]);
    dblClickCell(locked, 'b', 'Value');
    await locked.updateComplete;
    expect((locked as any)._editingCell).toBeNull();
    locked.remove();
  });

  it('the Name cell opens only when the host marks the name editable', async () => {
    // Renaming rewrites the entry's key in the dictionary, so it is gated
    // separately from editing its value.
    const locked = await mount([makeRow('a', 'A')]);
    dblClickCell(locked, 'a', 'Name');
    await locked.updateComplete;
    expect((locked as any)._editingCell).toBeNull();
    locked.remove();

    const renamable = await mount([{ ...makeRow('b', 'B'), Name: { label: 'B', editable: true } }]);
    dblClickCell(renamable, 'b', 'Name');
    await renamable.updateComplete;
    expect((renamable as any)._editingCell).toMatchObject({ columnId: 'Name', value: 'B' });
    renamable.remove();
  });

  it('Description is editable unless the row is read-only', async () => {
    const table = await mount([makeRow('a', 'A', { Description: 'notes' })]);
    dblClickCell(table, 'a', 'Description');
    await table.updateComplete;
    expect((table as any)._editingCell).toMatchObject({ columnId: 'Description', value: 'notes' });
    table.remove();

    const readOnly = await mount([makeRow('b', 'B', { Description: 'notes', _valueEditable: false })]);
    dblClickCell(readOnly, 'b', 'Description');
    await readOnly.updateComplete;
    expect((readOnly as any)._editingCell).toBeNull();
    readOnly.remove();
  });

  it('a generic column opens an editor only when its cell object says editable', async () => {
    // Schema-driven columns arrive as plain strings when read-only and as
    // {text, editable} objects when writable; a string must never open an editor.
    const table = await mount([
      makeRow('a', 'A', { storageClass: { text: 'Auto', editable: true } as any }),
      makeRow('b', 'B', { storageClass: 'Auto' as any }),
    ]);
    dblClickCell(table, 'a', 'storageClass');
    await table.updateComplete;
    expect((table as any)._editingCell).toMatchObject({ rowId: 'a', columnId: 'storageClass', value: 'Auto' });
    (table as any)._editingCell = null;
    await settle(table);

    dblClickCell(table, 'b', 'storageClass');
    await table.updateComplete;
    expect((table as any)._editingCell).toBeNull();
    table.remove();
  });

  it('a second double-click while editing leaves the first editor in place', async () => {
    const table = await mount([
      makeRow('a', 'A', { Value: { text: 'aVal', editable: true } }),
      makeRow('b', 'B', { Value: { text: 'bVal', editable: true } }),
    ]);
    dblClickCell(table, 'a', 'Value');
    await table.updateComplete;
    dblClickCell(table, 'a', 'Value');
    await settle(table);
    expect((table as any)._editingCell).toMatchObject({ rowId: 'a', columnId: 'Value' });
    table.remove();
  });

  it('a select editor renders the host-supplied options with the current one chosen', async () => {
    // An enumerated field (e.g. storage class) must offer exactly the values the
    // host allows — a free-text input would let the user save an invalid one.
    const table = await mount([
      makeRow('a', 'A', {
        storageClass: { text: 'ExportedGlobal', editable: true, editor: 'select', options: ['Auto', 'ExportedGlobal', 'ImportedExtern'] } as any,
      }),
    ]);
    dblClickCell(table, 'a', 'storageClass');
    await table.updateComplete;

    const select = table.shadowRoot!.querySelector('select.edit-input') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['Auto', 'ExportedGlobal', 'ImportedExtern']);
    expect(select.value).toBe('ExportedGlobal');
    table.remove();
  });
});

describe('committing an edit', () => {
  it('Enter emits dex-edit-completed with the exact host payload', async () => {
    // oldValue is what the host uses to detect a conflicting concurrent change,
    // and rowId/columnId address the entry to write; all four fields matter.
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;

    const input = editor(table);
    input.value = '42';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(edits).toEqual([{ rowId: 'p1', columnId: 'Value', oldValue: '3', newValue: '42' }]);
    expect((table as any)._editingCell).toBeNull();
    table.remove();
  });

  it('blur commits too, so clicking away does not lose the typed value', async () => {
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;

    const input = editor(table);
    input.value = '9';
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(edits).toEqual([{ rowId: 'p1', columnId: 'Value', oldValue: '3', newValue: '9' }]);
    table.remove();
  });

  it('an unchanged value emits nothing, so no needless file write or dirty flag', async () => {
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;
    editor(table).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).toBeNull();
    table.remove();
  });

  it('clearing a cell commits the empty string rather than being treated as no change', async () => {
    // Blanking a value is a real edit — the user is deleting the value.
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;
    const input = editor(table);
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(edits).toEqual([{ rowId: 'p1', columnId: 'Value', oldValue: '3', newValue: '' }]);
    table.remove();
  });

  it('Escape discards the typed text and emits nothing', async () => {
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;

    const input = editor(table);
    input.value = 'oops';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await table.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    expect(edits).toEqual([]);
    expect((table as any)._editingCell).toBeNull();
    // The cell shows the original value again, not the abandoned text.
    const td = table.shadowRoot!.querySelector('tr[data-row-id="p1"] td.col-Value') as HTMLElement;
    expect(td.textContent).toContain('3');
    table.remove();
  });

  it('Enter and Escape are swallowed so the table does not also act on them', async () => {
    // Enter would otherwise bubble to the grid handler and re-open an editor;
    // Escape would reach the host and could close the panel.
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    editor(table).dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);

    await settle(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;
    const ent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    editor(table).dispatchEvent(ent);
    expect(ent.defaultPrevented).toBe(true);
    table.remove();
  });

  it('a key the editor does not handle neither commits nor cancels', async () => {
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;
    editor(table).dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(edits).toEqual([]);
    expect((table as any)._editingCell).not.toBeNull();
    table.remove();
  });

  it('changing a select commits the chosen option', async () => {
    const table = await mount([
      makeRow('a', 'A', {
        storageClass: { text: 'Auto', editable: true, editor: 'select', options: ['Auto', 'ExportedGlobal'] } as any,
      }),
    ]);
    const edits = recordEdits(table);
    dblClickCell(table, 'a', 'storageClass');
    await table.updateComplete;

    const select = table.shadowRoot!.querySelector('select.edit-input') as HTMLSelectElement;
    select.value = 'ExportedGlobal';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(edits).toEqual([
      { rowId: 'a', columnId: 'storageClass', oldValue: 'Auto', newValue: 'ExportedGlobal' },
    ]);
    table.remove();
  });

  it('a blur after the edit already closed does not emit a second event', async () => {
    // Enter commits and then the browser blurs the input as it is torn down; a
    // second event would apply the same change twice and push a spurious undo step.
    const table = await mount([makeRow('p1', 'gain', { Value: { text: '3', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'p1', 'Value');
    await table.updateComplete;

    const input = editor(table);
    input.value = '7';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(edits.length).toBe(1);
    table.remove();
  });

  it('a zero keeps its editor and commits as "0" rather than being read as empty', async () => {
    // "0" is falsy; a truthiness check anywhere on this path would show an empty
    // editor and then write an empty value over a legitimate zero.
    const table = await mount([makeRow('z', 'zeroParam', { Value: { text: '0', editable: true } })]);
    const edits = recordEdits(table);
    dblClickCell(table, 'z', 'Value');
    await table.updateComplete;
    expect(editor(table).value).toBe('0');

    const input = editor(table);
    input.value = '0';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(edits).toEqual([]); // unchanged

    await settle(table);
    dblClickCell(table, 'z', 'Value');
    await table.updateComplete;
    const again = editor(table);
    again.value = '1';
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(edits).toEqual([{ rowId: 'z', columnId: 'Value', oldValue: '0', newValue: '1' }]);
    table.remove();
  });
});

describe('an abandoned editor never writes to the newly opened cell', () => {
  // Regression, and the worst defect this component had. _commitEdit used to read
  // the value with a shadow-root `.edit-input` lookup. Opening a second cell's
  // editor blurs the first one, and that blur arrives BEFORE Lit tears the old
  // input down — so the commit read the abandoned input's text and wrote it into
  // whatever cell was now being edited. The user double-clicks row B after typing
  // in row A and silently gets A's text saved into B's entry in their file.
  it('a stale blur from another row is rejected', async () => {
    const table = await mount([
      makeRow('a', 'A', { Value: { text: 'aVal', editable: true } }),
      makeRow('b', 'B', { Value: { text: 'bVal', editable: true } }),
    ]);
    const edits = recordEdits(table);

    dblClickCell(table, 'a', 'Value');
    await table.updateComplete;
    const inputA = editor(table);
    inputA.value = 'typedIntoA';

    // Opening B's editor moves focus, which blurs A's still-attached input.
    dblClickCell(table, 'b', 'Value');
    expect((table as any)._editingCell).toMatchObject({ rowId: 'b', columnId: 'Value' });
    inputA.dispatchEvent(new Event('blur', { bubbles: true }));

    expect(edits).toEqual([]);
    // B's edit session survives the stale blur, so the user can still type in it.
    expect((table as any)._editingCell).toMatchObject({ rowId: 'b', columnId: 'Value' });
    table.remove();
  });

  it('a stale blur from another column of the same row is rejected', async () => {
    // Same hazard sideways: tabbing from Value to Description within one row must
    // not copy the Value text into the Description field.
    const table = await mount([
      makeRow('a', 'A', { Value: { text: 'aVal', editable: true }, Description: 'desc' }),
    ]);
    const edits = recordEdits(table);

    dblClickCell(table, 'a', 'Value');
    await table.updateComplete;
    const valueInput = editor(table);
    valueInput.value = 'typedIntoValue';

    dblClickCell(table, 'a', 'Description');
    valueInput.dispatchEvent(new Event('blur', { bubbles: true }));

    expect(edits).toEqual([]);
    table.remove();
  });

  it('after the stale blur the new cell still commits its own value correctly', async () => {
    const table = await mount([
      makeRow('a', 'A', { Value: { text: 'aVal', editable: true } }),
      makeRow('b', 'B', { Value: { text: 'bVal', editable: true } }),
    ]);
    const edits = recordEdits(table);

    dblClickCell(table, 'a', 'Value');
    await table.updateComplete;
    const inputA = editor(table);
    inputA.value = 'typedIntoA';
    dblClickCell(table, 'b', 'Value');
    inputA.dispatchEvent(new Event('blur', { bubbles: true }));
    await table.updateComplete;

    const inputB = editor(table);
    inputB.value = 'typedIntoB';
    inputB.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(edits).toEqual([{ rowId: 'b', columnId: 'Value', oldValue: 'bVal', newValue: 'typedIntoB' }]);
    table.remove();
  });
});
