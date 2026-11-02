// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A deferred row's question, `requestChildren`, leaving the table webview through the listener
// that ships.
//
// What the table does with the answer (which arrivals get installed, which get dropped, and
// which say something to the user) is view's messageSource and connectTable, and view proves
// it (test/connectTableRepaints.test.ts, test/rowUpdates.test.ts). What stays here is the
// shell's half: table-main.ts wires the table to the host, so the question reaches it. This
// imports table-main.ts and dispatches real events at it, the way linkRoute.test.ts and
// readonlyEditorGate.test.ts drive their halves. See the memory
// `table-main-is-importable`: two stubs in place before the dynamic import, once per
// file, because a module body runs once per test FILE and this one wires window and body
// listeners.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const posted: any[] = [];
let table: any;

/** Hand the table a message exactly as the host's `postMessage` does. */
function send(data: any): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

/**
 * A planned payload: one section, one entry whose children were held back.
 *
 * `_lazy` on `A` is the whole premise: the host stamped it because its children did not fit.
 */
function paint(): void {
  send({
    type: 'setRows',
    docUri: 'file:///fx/big.mat',
    rows: [
      { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
      { ID: 'A', parent: 'section:design', Name: { label: 'A' }, _lazy: true },
      { ID: 'B', parent: 'section:design', Name: { label: 'B' } },
    ],
    columns: ['Name', 'Value'],
    columnLabels: { Name: 'Name', Value: 'Value' },
    editable: false,
  });
}

// Its own timeout: a cold import of the whole table-main webview is what a loaded machine stretches.
beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
}, 60_000);

beforeEach(() => {
  posted.length = 0;
  paint();
});

describe('opening a deferred row asks the host about it', () => {
  it('relays the row id the component asked about', () => {
    // The component decides WHEN to ask (treeTableLazyRows.test.ts); this is the one
    // line that turns that into a message, and a read-only `.mat` is navigated entirely
    // through it — so it must not be gated on `editable`, which this payload is not.
    table.dispatchEvent(new CustomEvent('dex-request-children', { detail: { nodeId: 'A' } }));
    expect(posted).toEqual([{ type: 'requestChildren', nodeId: 'A' }]);
  });
});
