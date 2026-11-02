// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The read-only cell-editor gate, as it ships: table-main.ts hands its table to view's
// connectTable with `editing`, whose gate swallows Enter on the grid of a read-only document
// before the cell editor sees it. The gate itself (it swallows only Enter and only on the grid,
// so a read-only view's search box still commits, and an editable one opens its cells) is
// connectTable's, and view proves it (test/connectTableEditing.test.ts). This is the shell's
// check that the gate is wired.
//
// table-main.ts is importable with two stubs — `acquireVsCodeApi` as a global, since the module
// calls it at top level, and a <dex-tree-table> in the body for it to bind to — both in place
// before the dynamic import. Imported once, in beforeAll: a module body runs once per test
// FILE, and this one wires window and body listeners.
import { describe, it, expect, beforeAll } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('the shipped gate', () => {
  let table: any;

  // Its own timeout: a cold import of the whole table-main webview is what a loaded machine stretches.
  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: () => {} });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  }, 60_000);

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

  it('read-only: Enter on the grid is still swallowed before the cell editor sees it', async () => {
    // The gate's whole purpose: no cell editor opens on a document that cannot be edited.
    await paint(false);
    let reached = 0;
    const grid = table.shadowRoot.querySelector('[role="treegrid"]') as HTMLElement;
    grid.addEventListener('keydown', () => reached++);
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(reached).toBe(0);
  });
});
