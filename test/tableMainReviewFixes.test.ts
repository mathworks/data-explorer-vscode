// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The table webview review's fixes (2026-10-23), driven through the entry point as it ships
// (table-main.ts) rather than a copy of its listeners — see tableMainChildRows.test.ts for the
// pattern.
//
// The fixes are connectTable's, and view proves them (test/connectTableRepaints.test.ts). One
// stays here as the shell's check that a selection the table changes is relayed to the host,
// for the Property Inspector: table-main's `select` relay.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SLDD = 'file:///fx/d.sldd';
const posted: any[] = [];
let table: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const sent = (type: string) => posted.filter((m) => m.type === type);

const DICT_ROWS = () => [
  { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
  { ID: 'd/design/A', parent: 'section:design', Name: { label: 'A' }, _canCopy: true, _canDelete: true },
  { ID: 'd/design/B', parent: 'section:design', Name: { label: 'B' }, _canCopy: true, _canDelete: true },
];

// Painted open.
async function paint(): Promise<void> {
  send({ type: 'setRows', docUri: SLDD, rows: DICT_ROWS(), columns: ['Name'], columnLabels: { Name: 'Name' }, editable: true });
  table._expandedIds = new Set(['section:design']);
  table._visibleRowsCache = null;
  table.requestUpdate();
  await table.updateComplete;
}

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
}, 60_000);

beforeEach(() => {
  posted.length = 0;
});

describe('a selection whose rows all vanished', () => {
  const withoutB = () => DICT_ROWS().filter((r) => r.ID !== 'd/design/B');
  // The clear waits one task, so a re-selection the host sends right behind the repaint can
  // take over first.
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));

  it('is cleared, and the host told once', async () => {
    await paint();
    table.selectedRowIds = ['d/design/B'];
    posted.length = 0;
    send({ type: 'setRows', docUri: SLDD, rows: withoutB(), columns: ['Name'], columnLabels: {}, editable: true });
    await settle();
    expect(table.selectedRowIds).toEqual([]);
    expect(sent('select')).toEqual([{ type: 'select', rowIds: [] }]);
    send({ type: 'setRows', docUri: SLDD, rows: withoutB(), columns: ['Name'], columnLabels: {}, editable: true });
    await settle();
    expect(sent('select')).toHaveLength(1);
  });
});
