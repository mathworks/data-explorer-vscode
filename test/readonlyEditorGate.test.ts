// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { shouldOpenCellEditor } from '../src/webview/menuItems.js';

// The vendored dex-tree-table opens its inline cell editor from handlers bound
// INSIDE its shadow DOM (on the <td> cells) for both double-click and Enter.
// The webview blocks that for read-only documents with a CAPTURE-phase listener
// on the host element that calls stopPropagation before the event descends into
// the shadow tree. These tests lock down that mechanism: capture-phase
// stopPropagation on the host must prevent a shadow-internal listener from
// firing, and must do so exactly when the document is read-only.
//
// This half mirrors the component's event contract on a bare host+shadow pair, so the
// mechanism is pinned independently of the table. The second half below drives the
// listener table-main.ts actually installs — which is where the interesting bug was.

describe('read-only cell-editor gate (capture-phase interception)', () => {
  let host: HTMLElement;
  let shadowCell: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="host"></div>';
    host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const td = document.createElement('td');
    td.id = 'cell';
    shadow.appendChild(td);
    shadowCell = td;
  });

  // Install the same guards table-main.ts installs, parameterized by editable.
  function installGuards(editable: boolean): void {
    host.addEventListener(
      'dblclick',
      (e) => {
        if (!shouldOpenCellEditor(editable)) e.stopPropagation();
      },
      true,
    );
    host.addEventListener(
      'keydown',
      (e) => {
        if ((e as KeyboardEvent).key === 'Enter' && !shouldOpenCellEditor(editable)) {
          e.stopPropagation();
        }
      },
      true,
    );
  }

  it('read-only: a double-click never reaches the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('dblclick', () => opened++);
    installGuards(false);
    shadowCell.dispatchEvent(new Event('dblclick', { bubbles: true, composed: true }));
    expect(opened).toBe(0);
  });

  it('read-only: an Enter keydown never reaches the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') opened++;
    });
    installGuards(false);
    shadowCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(opened).toBe(0);
  });

  it('editable: a double-click DOES reach the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('dblclick', () => opened++);
    installGuards(true);
    shadowCell.dispatchEvent(new Event('dblclick', { bubbles: true, composed: true }));
    expect(opened).toBe(1);
  });

  it('editable: an Enter keydown DOES reach the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') opened++;
    });
    installGuards(true);
    shadowCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(opened).toBe(1);
  });

  it('read-only: a non-Enter key (e.g. ArrowDown) is NOT swallowed — only Enter is blocked', () => {
    let navigated = 0;
    shadowCell.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'ArrowDown') navigated++;
    });
    installGuards(false);
    shadowCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
    expect(navigated).toBe(1);
  });

  // The Variable Editor is a VIEW. table-main swallows dblclick and Enter on a
  // read-only document to stop the inline editor opening; the glyph must survive
  // that, because there is nothing to edit. The gate is keyed on the GESTURE, and
  // the glyph's gesture is a single click on a control — not a dblclick — so the
  // two never collide.
  describe('the read-only gate does not reach the Variable Editor glyph', () => {
    it('leaves the inline editor gated while a plain click stays available', () => {
      expect(shouldOpenCellEditor(false)).toBe(false);
      expect(shouldOpenCellEditor(true)).toBe(true);
    });

    it('read-only: a single click still crosses the host, so the glyph can fire', () => {
      let clicked = 0;
      shadowCell.addEventListener('click', () => clicked++);
      installGuards(false);
      shadowCell.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      expect(clicked).toBe(1);
    });

    it('read-only: the glyph’s own dex-matrix-open event is not gated either', () => {
      // It is dispatched from inside the glyph's shadow root, on neither of the
      // two gated gestures, so nothing on the host swallows it.
      let opened = 0;
      host.addEventListener('dex-matrix-open', () => opened++);
      installGuards(false);
      shadowCell.dispatchEvent(new CustomEvent('dex-matrix-open', { bubbles: true, composed: true }));
      expect(opened).toBe(1);
    });
  });
});

// ── the same gate, as it actually ships ───────────────────────────────────────────
// Everything above installs a COPY of the guard. That is one rule on two paths, and
// this is the bug it let through: Enter became how a search commits, and the guard —
// which knows only "read-only" and "the key is Enter" — swallowed it in the capture
// phase before it could reach the search box. Every read-only view (.slx, .mdl, .mat,
// .prj) had a filter box that did nothing; .sldd, being editable, was fine, which is
// exactly the shape the bug was reported in.
//
// So this half drives the LISTENER THAT SHIPS. table-main.ts is importable with two
// stubs — `acquireVsCodeApi` as a global, since the module calls it at top level, and a
// <dex-tree-table> in the body for it to bind to — both in place before the dynamic
// import. Imported once, in beforeAll: a module body runs once per test FILE, and this
// one wires window and body listeners.
describe('the shipped gate keeps a read-only view searchable', () => {
  let table: any;

  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: () => {} });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  });

  // A .slx-shaped payload: two rows and the read-only flag the gate reads.
  async function paint(editable: boolean): Promise<void> {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'setRows',
          docUri: 'file:///fx/m.slx',
          rows: [
            { ID: 's', parent: null, Name: { label: 'Model Elements' } },
            { ID: 'b', parent: 's', Name: { label: 'ChainGain' } },
          ],
          columns: ['Name', 'Value', 'DataType'],
          columnLabels: { Name: 'Name', Value: 'Value', DataType: 'Data Type' },
          editable,
        },
      }),
    );
    await table.updateComplete;
  }

  const barOf = () => table.shadowRoot.querySelector('dex-filter-bar');
  const boxOf = () => barOf().shadowRoot.querySelector('.filter-input') as HTMLInputElement;

  /**
   * Type a search and commit it with a real Enter, from inside the bar's shadow root.
   * Each call is a FRESH question: the bar APPENDS its committed tail to what is already
   * applied, and one table serves every case here.
   */
  async function searchFor(text: string): Promise<void> {
    table._setFilterText('');
    await table.updateComplete;
    const input = boxOf();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    await barOf().updateComplete;
    await table.updateComplete;
  }

  it('read-only: Enter in the search box commits the search', async () => {
    await paint(false);
    await searchFor('ChainGain');
    expect(table._filterText).toBe('ChainGain');
    expect(table._getVisibleRows().map((r: { ID: string }) => r.ID)).toEqual(['s', 'b']);
  });

  it('editable: Enter in the search box commits the search too', async () => {
    // The two views must agree. The gate is about the GRID, and the box is not the grid.
    await paint(true);
    await searchFor('ChainGain');
    expect(table._filterText).toBe('ChainGain');
  });

  it('read-only: Enter on the grid is still swallowed before the cell editor sees it', async () => {
    // The gate's whole purpose, unchanged: this is what the exemption above must not cost.
    await paint(false);
    let reached = 0;
    const grid = table.shadowRoot.querySelector('[role="treegrid"]') as HTMLElement;
    grid.addEventListener('keydown', () => reached++);
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(reached).toBe(0);
  });

  it('editable: Enter on the grid still reaches it, so a cell can be opened', async () => {
    await paint(true);
    let reached = 0;
    const grid = table.shadowRoot.querySelector('[role="treegrid"]') as HTMLElement;
    grid.addEventListener('keydown', () => reached++);
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(reached).toBe(1);
  });
});
