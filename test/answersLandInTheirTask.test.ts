// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// WHEN the table webview takes what the host sends: within the task that delivered it.
//
// table-main used to apply a setRows, a childRows and a matrixCells inside its message listener.
// Since the table is view's connectTable over messageSource, an answer to a question the table
// asked (the first setRows answers `ready`; childRows answers requestChildren; matrixCells answers
// requestMatrix) resolves a promise, so it is applied in the microtask checkpoint right after the
// listener returns, one step later. That is still inside the same task, before the next message
// is handled and before a frame is drawn, so nothing a user or the host can observe moves: the
// screenshot harness sees the same frames and the same posted messages. This pins the "same task"
// half, so a change that pushed an answer into a later task (a timer, a frame) fails here rather
// than as a flicker. Driven through the entry point as it ships, as tableMainChildRows.test.ts is.
import { beforeAll, describe, expect, it } from 'vitest';
import { nextTask } from './tools/nextTask.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const posted: any[] = [];
let table: any;
let editor: any;
const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));

const ROWS = [
  { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
  { ID: 'A', parent: 'section:design', Name: { label: 'A' }, _lazy: true },
  {
    ID: 'M',
    parent: 'section:design',
    Name: { label: 'M' },
    _matrix: { name: 'M', className: 'double', dims: [2, 2], nodeId: 'M' },
  },
];

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
  editor = document.querySelector('dex-variable-editor');
}, 60_000);

describe('what the host sends lands in the task that delivers it', () => {
  it('the first setRows, the answer to ready, is installed and drawn before the next task', async () => {
    expect(posted).toEqual([{ type: 'ready' }]);
    expect(table.loading).toBe(true);
    const seen = await nextTask(
      () => send({ type: 'setRows', docUri: 'file:///fx/d.sldd', rows: ROWS, columns: ['Name'], columnLabels: { Name: 'Name' }, editable: false }),
      () => ({ rows: table.rows.map((r: any) => r.ID), loading: table.loading, drawn: !table.isUpdatePending }),
    );
    expect(seen).toEqual({ rows: ['section:design', 'A', 'M'], loading: false, drawn: true });
  });

  it("a childRows, the answer to a row's requestChildren, is merged and drawn before the next task", async () => {
    table.dispatchEvent(new CustomEvent('dex-request-children', { detail: { nodeId: 'A' } }));
    expect(posted.at(-1)).toEqual({ type: 'requestChildren', nodeId: 'A' });
    const seen = await nextTask(
      () => send({ type: 'childRows', nodeId: 'A', rows: [{ ID: 'A.k', parent: 'A', Name: { label: 'k' } }], truncated: 0 }),
      () => ({ rows: table.rows.map((r: any) => r.ID), drawn: !table.isUpdatePending }),
    );
    expect(seen).toEqual({ rows: ['section:design', 'A', 'A.k', 'M'], drawn: true });
  });

  it('a matrixCells, the answer to requestMatrix, reaches the variable editor before the next task', async () => {
    const delivered: any[] = [];
    const deliver = editor.deliver.bind(editor);
    editor.deliver = (answer: any) => (delivered.push(answer), deliver(answer));
    table.dispatchEvent(new CustomEvent('dex-matrix-open', { detail: { matrix: ROWS[2]._matrix, anchorEl: table }, bubbles: true }));
    expect(posted.at(-1)).toEqual({ type: 'requestMatrix', nodeId: 'M' });
    const cells = { name: 'M', className: 'double', dims: [2, 2], nodeId: 'M', cells: ['1', '2', '3', '4'] };
    const seen = await nextTask(
      () => send({ type: 'matrixCells', nodeId: 'M', matrix: cells }),
      () => delivered.slice(),
    );
    expect(seen).toEqual([{ nodeId: 'M', matrix: cells }]);
  });

  it('a later setRows, a change no question waits for, is installed inside the listener, as before', () => {
    send({ type: 'setRows', docUri: 'file:///fx/d.sldd', rows: ROWS.slice(0, 2), columns: ['Name'], columnLabels: { Name: 'Name' }, editable: false });
    expect(table.rows.map((r: any) => r.ID)).toEqual(['section:design', 'A']);
  });
});
