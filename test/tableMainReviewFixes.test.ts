// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The table webview review's fixes (2026-10-23), each driven through the entry point as it
// ships (table-main.ts) rather than a copy of its listeners — see tableMainChildRows.test.ts
// for the pattern. One table serves every case, so each case paints the payload it needs.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SLDD = 'file:///fx/d.sldd';
const posted: any[] = [];
let table: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const sent = (type: string) => posted.filter((m) => m.type === type);
const rowEls = () => [...table.shadowRoot.querySelectorAll('tr.data-row')] as HTMLElement[];

const DICT_ROWS = () => [
  { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
  { ID: 'd/design/A', parent: 'section:design', Name: { label: 'A' }, _canCopy: true, _canDelete: true },
  { ID: 'd/design/B', parent: 'section:design', Name: { label: 'B' }, _canCopy: true, _canDelete: true },
];

async function paint(over: Record<string, unknown> = {}): Promise<void> {
  send({ type: 'setRows', docUri: SLDD, rows: DICT_ROWS(), columns: ['Name'], columnLabels: { Name: 'Name' }, editable: true, ...over });
  await table.updateComplete;
}

function dragOver(rowId: string): any {
  const ev = new Event('dragover', { bubbles: true, cancelable: true }) as any;
  Object.assign(ev, { dataTransfer: { dropEffect: '', effectAllowed: '' }, altKey: false, ctrlKey: false, clientX: 0, clientY: 0 });
  table.shadowRoot.querySelector(`tr[data-row-id="${rowId}"]`).dispatchEvent(ev);
  return ev;
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

// #1: the read-only views (BinaryEditorProvider: .slx/.mdl/.prj, a large JSON .sldd) send no
// `clipboard` at all, which reads as true — so their rows were draggable and a drag over them
// was accepted, into a view with no drop handler. A row drag is a structural edit, so it
// needs an editable document as well as rows that travel.
describe('a row drag needs an editable document whose rows travel', () => {
  it('a read-only view has no draggable row', async () => {
    await paint({ editable: false });
    expect(rowEls().length).toBeGreaterThan(0);
    expect(rowEls().every((r) => r.getAttribute('draggable') === 'false')).toBe(true);
  });

  it('nor does it accept a drag from another table over its rows', async () => {
    await paint({ editable: false });
    send({ type: 'dragState', descriptor: { docUri: 'file:///fx/other.sldd', items: [{ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false, sectionName: 'design' }] } });
    expect(dragOver('d/design/A').defaultPrevented).toBe(false);
    send({ type: 'dragState', descriptor: null });
  });

  it('an editable dictionary still drags', async () => {
    await paint();
    expect(rowEls().every((r) => r.getAttribute('draggable') === 'true')).toBe(true);
  });
});

// #6: the predictor answered null whenever it could not predict, and the table read null as
// "allow" — so a drag the host never announced (a file from the OS, text from another app, or
// the moment before the host's dragState arrives) was accepted over every row.
describe('a drag the webview cannot predict is refused', () => {
  it('with no drag announced, a dragover on an entry is not accepted', async () => {
    await paint();
    send({ type: 'sectionRules', docUri: SLDD, rules: [{ sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] }] });
    send({ type: 'dragState', descriptor: null });
    expect(dragOver('d/design/B').defaultPrevented).toBe(false);
  });

  it('an announced drag onto a section with a rule is still predicted and accepted', async () => {
    await paint();
    send({ type: 'sectionRules', docUri: SLDD, rules: [{ sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] }] });
    send({ type: 'dragState', descriptor: { docUri: 'file:///fx/other.sldd', items: [{ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false, sectionName: 'design' }] } });
    expect(dragOver('d/design/B').defaultPrevented).toBe(true);
    send({ type: 'dragState', descriptor: null });
  });
});

// #3: a by-name navigation means a top-level ENTRY first (see nameSelectTarget.test.ts), and
// read "entry" as "parent is a section header" — which no MAT-file row is, since its variables
// ARE its top level. So the entry pass found nothing there and the document-order fallback
// picked a nested field that happened to share the variable's name.
describe('a by-name selection in a table with no section rows prefers the top-level row', () => {
  it('selects the variable, not an earlier field of the same name', async () => {
    send({
      type: 'setRows',
      docUri: 'file:///fx/gains.mat',
      rows: [
        { ID: 'm/cfg', parent: null, Name: { label: 'cfg' } },
        { ID: 'm/cfg/gain', parent: 'm/cfg', Name: { label: 'gain' } },
        { ID: 'm/gain', parent: null, Name: { label: 'gain' } },
      ],
      columns: ['Name'],
      columnLabels: { Name: 'Name' },
      editable: true,
    });
    await table.updateComplete;
    send({ type: 'selectByName', name: 'gain' });
    expect(table.selectedRowIds).toEqual(['m/gain']);
    expect(sent('select')).toEqual([{ type: 'select', rowIds: ['m/gain'] }]);
  });

  it('a dictionary is unchanged: its section headers are never the entry a name means', async () => {
    send({
      type: 'setRows',
      docUri: SLDD,
      rows: [
        { ID: 'section:design', parent: null, Name: { label: 'A' } },
        { ID: 'd/design/B', parent: 'section:design', Name: { label: 'B' } },
        { ID: 'd/design/B/A', parent: 'd/design/B', Name: { label: 'A' } },
        { ID: 'd/design/A', parent: 'section:design', Name: { label: 'A' } },
      ],
      columns: ['Name'],
      columnLabels: { Name: 'Name' },
      editable: true,
    });
    await table.updateComplete;
    send({ type: 'selectByName', name: 'A' });
    expect(table.selectedRowIds).toEqual(['d/design/A']);
  });
});
