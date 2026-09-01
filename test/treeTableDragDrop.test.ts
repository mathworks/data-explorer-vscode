// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Row drag and drop. A completed drop MOVES or COPIES entries in the user's
// file, so the two things that must not go wrong are the payload (which rows,
// which mode) and the veto (a drop the host said was impossible must never be
// dispatched). The copy-vs-move mode is read from the last `dragover` rather
// than from `drop`, because Chromium on macOS often reports the modifier as
// released by the time `drop` fires — a Cmd-drag Copy would silently become a
// Move, deleting the original.
//
// happy-dom has no drag implementation, so these dispatch DragEvent-shaped
// events with a stub dataTransfer. That covers the component's own decisions
// (payload, mode, veto, drop-target state); it does NOT cover the browser's
// native drag pipeline or the real drag image, which need a live browser.
import { describe, it, expect } from 'vitest';
import { DexTreeTable, type TreeTableRow } from '../src/webview/components/dex-tree-table.js';

function makeRow(id: string, parent: string | null, name = id): TreeTableRow {
  return { ID: id, parent, Name: { label: name }, Value: '', DataType: '', Description: '', Status: '' };
}

async function mount(rows: TreeTableRow[]): Promise<DexTreeTable> {
  const table = new DexTreeTable();
  table.columns = ['Name', 'Value', 'DataType', 'Status'];
  document.body.appendChild(table);
  table.rows = rows;
  table.requestUpdate();
  await table.updateComplete;
  return table;
}

// A minimal stand-in for DataTransfer: happy-dom does not construct one, and the
// component only ever sets effectAllowed/dropEffect and calls setData/setDragImage.
function stubTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (t: string, v: string) => store.set(t, v),
    getData: (t: string) => store.get(t) ?? '',
    setDragImage: () => {},
    _store: store,
  };
}

type Mods = { altKey?: boolean; ctrlKey?: boolean; clientX?: number; clientY?: number };

// Dispatch a drag event on a row, with a dataTransfer the component can write to.
function fire(table: DexTreeTable, rowId: string, type: string, mods: Mods = {}) {
  const dt = stubTransfer();
  const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
  Object.assign(ev, { dataTransfer: dt, altKey: false, ctrlKey: false, clientX: 0, clientY: 0 }, mods);
  const tr = table.shadowRoot!.querySelector(`tr[data-row-id="${rowId}"]`) as HTMLElement;
  tr.dispatchEvent(ev);
  return { ev, dt };
}

const ROWS = [makeRow('a', null), makeRow('b', null), makeRow('c', null), makeRow('section:Grp', null, 'Group')];

describe('what a drag carries', () => {
  it('dragging one row carries just that row', async () => {
    const table = await mount(ROWS);
    const starts: string[][] = [];
    table.addEventListener('dex-row-drag-start', (e) => starts.push((e as CustomEvent).detail.rowIds));
    fire(table, 'a', 'dragstart');
    expect(starts).toEqual([['a']]);
    table.remove();
  });

  it('dragging a row inside a multi-selection carries the whole selection', async () => {
    // The user selected several entries in order to move them together; dragging
    // one of them must not silently move only that one.
    const table = await mount(ROWS);
    table.selectedRowIds = ['a', 'b'];
    await table.updateComplete;
    const starts: string[][] = [];
    table.addEventListener('dex-row-drag-start', (e) => starts.push((e as CustomEvent).detail.rowIds));
    fire(table, 'a', 'dragstart');
    expect(starts).toEqual([['a', 'b']]);
    table.remove();
  });

  it('dragging a row OUTSIDE the selection carries only the dragged row', async () => {
    // Otherwise grabbing an unselected row would drag away entries the user
    // had selected earlier and forgotten about.
    const table = await mount(ROWS);
    table.selectedRowIds = ['b', 'c'];
    await table.updateComplete;
    const starts: string[][] = [];
    table.addEventListener('dex-row-drag-start', (e) => starts.push((e as CustomEvent).detail.rowIds));
    fire(table, 'a', 'dragstart');
    expect(starts).toEqual([['a']]);
    table.remove();
  });

  it('a section header cannot be dragged at all', async () => {
    // Section rows are labels the viewer invents, not entries in the file; there
    // is nothing for the host to move.
    const table = await mount(ROWS);
    const starts: unknown[] = [];
    table.addEventListener('dex-row-drag-start', (e) => starts.push(e));
    const { ev } = fire(table, 'section:Grp', 'dragstart');
    expect(ev.defaultPrevented).toBe(true);
    expect(starts).toEqual([]);
    table.remove();
  });

  it('a section header caught in a multi-selection is stripped from the payload', async () => {
    const table = await mount(ROWS);
    table.selectedRowIds = ['a', 'section:Grp', 'b'];
    await table.updateComplete;
    const starts: string[][] = [];
    table.addEventListener('dex-row-drag-start', (e) => starts.push((e as CustomEvent).detail.rowIds));
    fire(table, 'a', 'dragstart');
    expect(starts).toEqual([['a', 'b']]);
    table.remove();
  });

  it('the dataTransfer payload allows both copy and move', async () => {
    // effectAllowed gates which cursor the browser will even offer; restricting it
    // to move would make Option-drag Copy impossible.
    const table = await mount(ROWS);
    const { dt } = fire(table, 'a', 'dragstart');
    expect(dt.effectAllowed).toBe('copyMove');
    expect(JSON.parse(dt.getData('application/dex-rows'))).toEqual({ rowIds: ['a'] });
    table.remove();
  });

  it('the dragged row is marked so the user can see what they picked up', async () => {
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    await table.updateComplete;
    expect((table.shadowRoot!.querySelector('tr[data-row-id="a"]') as HTMLElement).className).toContain('drag-source');
    table.remove();
  });
});

describe('dragging over a row', () => {
  it('accepting the drop is what lets the browser fire a drop event at all', async () => {
    // Without preventDefault on dragover the browser refuses the drop entirely and
    // the user's drag just snaps back.
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    const { ev, dt } = fire(table, 'b', 'dragover');
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('move');
    table.remove();
  });

  it('the target row is marked so the user can see where the drop will land', async () => {
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    await table.updateComplete;
    expect((table.shadowRoot!.querySelector('tr[data-row-id="b"]') as HTMLElement).className).toContain(
      'drop-target-on',
    );
    table.remove();
  });

  it('dragging over the source row itself is not a drop target', async () => {
    // Dropping a row onto itself is a no-op; offering it as a target implies
    // something will happen.
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    const { ev } = fire(table, 'a', 'dragover');
    expect(ev.defaultPrevented).toBe(false);
    expect((table as any)._dropTargetId).toBeNull();
    table.remove();
  });

  it('leaving a row clears the marker', async () => {
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    fire(table, 'b', 'dragleave');
    await table.updateComplete;
    expect((table as any)._dropTargetId).toBeNull();
    expect((table.shadowRoot!.querySelector('tr[data-row-id="b"]') as HTMLElement).className).not.toContain(
      'drop-target-on',
    );
    table.remove();
  });

  it('ending the drag clears every trace of it and tells the host', async () => {
    // The host holds the drag register; leaving it populated would let a later,
    // unrelated drop reuse stale source rows.
    const table = await mount(ROWS);
    let ended = 0;
    table.addEventListener('dex-row-drag-end', () => ended++);
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    fire(table, 'a', 'dragend');
    await table.updateComplete;

    expect(ended).toBe(1);
    expect((table as any)._dragSourceId).toBeNull();
    expect((table as any)._dropTargetId).toBeNull();
    expect((table as any)._dragLabel).toBe('');
    expect(table.shadowRoot!.querySelector('.drop-tooltip')).toBeNull();
    table.remove();
  });
});

describe('the host predictor decides what a drop does', () => {
  it('a permitted copy shows the copy cursor and the host tooltip', async () => {
    const table = await mount(ROWS);
    table.dropPredictor = () => ({ canDrop: true, cursor: 'copy', tooltip: 'Copy Bus', noop: false });
    fire(table, 'a', 'dragstart');
    const { ev, dt } = fire(table, 'b', 'dragover');
    await table.updateComplete;

    expect(ev.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('copy');
    expect(table.shadowRoot!.querySelector('.drop-tooltip')!.textContent).toContain('Copy Bus');
    table.remove();
  });

  it('a forbidden drop is not accepted and explains why', async () => {
    // The reason text is the only way the user learns why the drag will not work
    // (e.g. a Simulink parameter cannot live in Architectural Data).
    const table = await mount(ROWS);
    table.dropPredictor = () => ({
      canDrop: false,
      cursor: 'none',
      tooltip: 'Simulink Parameter cannot be in Architectural Data',
      noop: false,
    });
    fire(table, 'a', 'dragstart');
    const { ev, dt } = fire(table, 'b', 'dragover');
    await table.updateComplete;

    expect(ev.defaultPrevented).toBe(false);
    expect(dt.dropEffect).toBe('none');
    const tip = table.shadowRoot!.querySelector('.drop-tooltip') as HTMLElement;
    expect(tip.className).toContain('forbidden');
    expect(tip.textContent).toContain('cannot be in Architectural Data');
    expect((table.shadowRoot!.querySelector('tr[data-row-id="b"]') as HTMLElement).className).toContain(
      'drop-target-forbidden',
    );
    table.remove();
  });

  it('a forbidden drop that somehow fires is still not dispatched to the host', async () => {
    // Belt and braces: the drop handler re-asks the predictor, so a drop the
    // browser lets through cannot modify the file behind the host's veto.
    const table = await mount(ROWS);
    table.dropPredictor = () => ({ canDrop: false, cursor: 'none', tooltip: 'nope', noop: false });
    const drops: unknown[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));

    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    fire(table, 'b', 'drop');
    expect(drops).toEqual([]);
    table.remove();
  });

  it('a permitted drop reports the target and mode to the host', async () => {
    const table = await mount(ROWS);
    table.dropPredictor = () => ({ canDrop: true, cursor: 'move', tooltip: 'Move', noop: false });
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));

    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    fire(table, 'b', 'drop');
    expect(drops).toEqual([{ targetRowId: 'b', mode: 'move' }]);
    table.remove();
  });

  it('with no predictor the drop still works, so the table is usable without host glue', async () => {
    const table = await mount(ROWS);
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    fire(table, 'b', 'drop');
    expect(drops).toEqual([{ targetRowId: 'b', mode: 'move' }]);
    table.remove();
  });

  it('the predictor is consulted with the row under the cursor and the live mode', async () => {
    const table = await mount(ROWS);
    const asked: Array<[string, string]> = [];
    table.dropPredictor = (rowId: string, mode: string) => {
      asked.push([rowId, mode]);
      return { canDrop: true, cursor: 'move', tooltip: '', noop: false };
    };
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    expect(asked).toEqual([['b', 'move']]);
    table.remove();
  });

  it('the drop is suppressed even if the browser reports no modifier', async () => {
    const table = await mount(ROWS);
    table.dropPredictor = (_rowId: string, mode: string) => ({
      canDrop: mode === 'move',
      cursor: mode,
      tooltip: mode,
      noop: false,
    });
    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));

    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    fire(table, 'b', 'drop');
    expect(drops).toEqual([{ targetRowId: 'b', mode: 'move' }]);
    table.remove();
  });
});

describe('the copy-vs-move mode survives the drop event', () => {
  it('a drop reuses the mode observed during dragover', async () => {
    // Regression guard for the Chromium/macOS behaviour where `drop` reports the
    // modifier as released: reading it there would turn the user's explicit Copy
    // into a Move and delete the original entry.
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    // Force the mode the way a real dragover with the platform's copy modifier
    // would; the platform-to-modifier mapping itself is unit-tested in dragMode.
    (table as any)._lastDragMode = 'copy';

    const drops: any[] = [];
    table.addEventListener('dex-row-drop', (e) => drops.push((e as CustomEvent).detail));
    // No modifiers on the drop event at all — the mode must still be copy.
    fire(table, 'b', 'drop');
    expect(drops).toEqual([{ targetRowId: 'b', mode: 'copy' }]);
    table.remove();
  });

  it('a drag starts as a move until a dragover says otherwise', async () => {
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    expect((table as any)._lastDragMode).toBe('move');
    table.remove();
  });

  it('the drop is consumed so it does not bubble out to the host page', async () => {
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    const { ev } = fire(table, 'b', 'drop');
    expect(ev.defaultPrevented).toBe(true);
    table.remove();
  });

  it('drag state is cleared after a drop, permitted or not', async () => {
    // A leftover drop-target highlight would make the row look permanently
    // selected as a target.
    const table = await mount(ROWS);
    table.dropPredictor = () => ({ canDrop: false, cursor: 'none', tooltip: 'nope', noop: false });
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    fire(table, 'b', 'drop');
    await table.updateComplete;
    expect((table as any)._dropTargetId).toBeNull();
    expect((table as any)._dragSourceId).toBeNull();
    expect((table as any)._dropForbidden).toBe(false);
    table.remove();
  });
});

describe('the floating drag affordance', () => {
  it('shows the dragged row name so the user can see what they are moving', async () => {
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    await table.updateComplete;
    const tip = table.shadowRoot!.querySelector('.drop-tooltip') as HTMLElement;
    expect(tip.querySelector('.drop-tooltip-name')!.textContent).toContain('a');
    table.remove();
  });

  it('a multi-row drag shows how many extra rows are coming along', async () => {
    // "(+1)" is the only feedback that the drag is carrying more than the one row
    // named in the box.
    const table = await mount(ROWS);
    table.selectedRowIds = ['a', 'b'];
    await table.updateComplete;
    fire(table, 'a', 'dragstart');
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.drop-tooltip-name')!.textContent).toContain('(+1)');
    table.remove();
  });

  it('it follows the cursor', async () => {
    const table = await mount(ROWS);
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover', { clientX: 100, clientY: 200 });
    await table.updateComplete;
    const tip = table.shadowRoot!.querySelector('.drop-tooltip') as HTMLElement;
    expect(tip.style.left).toBe('114px');
    expect(tip.style.top).toBe('216px');
    table.remove();
  });

  it('nothing floats when no drag is in progress', async () => {
    const table = await mount(ROWS);
    expect(table.shadowRoot!.querySelector('.drop-tooltip')).toBeNull();
    table.remove();
  });

  it('a forbidden drop adds the blocked glyph', async () => {
    const table = await mount(ROWS);
    table.dropPredictor = () => ({ canDrop: false, cursor: 'none', tooltip: 'nope', noop: false });
    fire(table, 'a', 'dragstart');
    fire(table, 'b', 'dragover');
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('.drop-tooltip-icon')!.textContent).toBe('⊘');
    table.remove();
  });
});
