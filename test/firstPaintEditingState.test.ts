// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The editing state the FIRST paint carries lands with its rows, in the task that delivered it.
//
// table-main used to set the table's canAdd, rowDrag and addClasses from a setRows inside its
// message listener. They are set by view's connectTable({editing}) now, as the paint is
// installed, and the first setRows answers `ready`, so that is in the microtask checkpoint right
// after the listener returns (answersLandInTheirTask.test.ts says why). It is still the same
// task, so an editable document's first frame has its + Add button and its draggable rows, as it
// did. This pins that, so a change that set them in a later task (a timer, a frame) fails here
// rather than as a button and a drag that turn up a frame late. A file of its own, because only
// one setRows per module load is the first.
import { beforeAll, describe, expect, it } from 'vitest';
import { nextTask } from './tools/nextTask.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const posted: any[] = [];
let table: any;
const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
}, 60_000);

describe("the first paint's editing state lands in the task that delivers it", () => {
  it('an editable first setRows draws its Add button and its row drag before the next task', async () => {
    expect(posted).toEqual([{ type: 'ready' }]);
    expect({ canAdd: table.canAdd, addClasses: table.addClasses }).toEqual({ canAdd: false, addClasses: null });
    // The table's own default is a row drag, so it is cleared first: setting it is then something to see.
    table.rowDrag = false;
    const seen = await nextTask(
      () =>
        send({
          type: 'setRows',
          docUri: 'file:///fx/gains.mat',
          rows: [{ ID: 'm/x', parent: null, Name: { label: 'x' } }],
          columns: ['Name'],
          columnLabels: { Name: 'Name' },
          editable: true,
          add: { classes: ['double'] },
        }),
      () => ({
        canAdd: table.canAdd,
        rowDrag: table.rowDrag,
        addClasses: table.addClasses,
        drawn: !table.isUpdatePending,
        addButton: table.shadowRoot.querySelector('.add-button')?.getAttribute('title') ?? null,
        rowDraggable: table.shadowRoot.querySelector('tr[data-row-id="m/x"]')?.getAttribute('draggable') ?? null,
      }),
    );
    expect(seen).toEqual({
      canAdd: true,
      rowDrag: true,
      addClasses: ['double'],
      drawn: true,
      addButton: 'Add a variable',
      rowDraggable: 'true',
    });
  });
});
