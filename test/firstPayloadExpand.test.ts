// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Review #2, through the entry point as it ships (table-main.ts): the top level opens on the
// FIRST payload with rows only. The table used to infer "first load" from an empty expansion,
// so a user who collapsed every section had them all reopened by the next repaint — any edit,
// undo or text-view keystroke. Its own file because the first payload of a module instance
// is the thing under test, and a module body runs once per test file.
import { describe, it, expect, beforeAll } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

let table: any;
const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));

const rows = () => [
  { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
  { ID: 'd/design/A', parent: 'section:design', Name: { label: 'A' } },
  { ID: 'section:arch', parent: null, Name: { label: 'Architectural Data' } },
  { ID: 'd/arch/V', parent: 'section:arch', Name: { label: 'V' } },
];
// The table keeps the expansion itself (view's connectTable sets expandTopLevel), so it is decided
// as the table updates: after the payload is in and the table has drawn it.
const paint = async (r: any[] = rows()) => {
  send({ type: 'setRows', docUri: 'file:///fx/d.sldd', rows: r, columns: ['Name'], columnLabels: { Name: 'Name' }, editable: true });
  await new Promise((done) => setTimeout(done, 0));
  await table.updateComplete;
};
const expanded = () => [...(table._expandedIds as Set<string>)].sort();

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: () => {} });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
}, 60_000);

describe('the top level opens once', () => {
  it('an empty first payload opens nothing, and the first payload with rows opens the top level', async () => {
    // An empty file shows no rows, so there is no expansion of the user's to keep yet: the
    // first payload that has rows is still the first load (a new MAT-file's first variable).
    await paint([]);
    expect(expanded()).toEqual([]);
    await paint();
    expect(expanded()).toEqual(['section:arch', 'section:design']);
  });

  it('after the user collapses everything, a repaint keeps it collapsed', async () => {
    table._expandedIds = new Set();
    await paint();
    expect(expanded()).toEqual([]);
    await paint();
    expect(expanded()).toEqual([]);
  });

  it('and what they did open stays open', async () => {
    table._expandedIds = new Set(['section:arch']);
    await paint();
    expect(expanded()).toEqual(['section:arch']);
  });
});
