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

// Painted open, whatever the cases before it left the expansion as: what a case drags over
// has to be on screen.
async function paint(over: Record<string, unknown> = {}): Promise<void> {
  send({ type: 'setRows', docUri: SLDD, rows: DICT_ROWS(), columns: ['Name'], columnLabels: { Name: 'Name' }, editable: true, ...over });
  table._expandedIds = new Set(['section:design']);
  table._visibleRowsCache = null;
  table.requestUpdate();
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

// #4: a repaint that removed every selected row (a delete from the text view, an undo of an
// add, a revert) left the selection naming rows that no longer exist: the Property Inspector
// went on showing a deleted entry and every chord found no operand. The selection now clears,
// and the host is told so once.
describe('a selection whose rows all vanished', () => {
  const withoutB = () => DICT_ROWS().filter((r) => r.ID !== 'd/design/B');
  // The clear waits one task, so a re-selection the host sends right behind the repaint can
  // take over first (see the rows-then-selectRows case below).
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

  it('a selection that survives in part keeps the part, and says nothing new', async () => {
    await paint();
    table.selectedRowIds = ['d/design/A', 'd/design/B'];
    posted.length = 0;
    send({ type: 'setRows', docUri: SLDD, rows: withoutB(), columns: ['Name'], columnLabels: {}, editable: true });
    await settle();
    expect(table.selectedRowIds).toEqual(['d/design/A']);
    expect(sent('select')).toEqual([]);
  });

  it('a rename re-selects the row under its new id without a "nothing selected" in between', async () => {
    await paint();
    table.selectedRowIds = ['d/design/B'];
    // The host asks for the new id first, then repaints (SlddTextEditorProvider's rename).
    send({ type: 'selectRows', rowIds: ['d/design/B2'] });
    posted.length = 0;
    const renamed = DICT_ROWS().map((r) => (r.ID === 'd/design/B' ? { ...r, ID: 'd/design/B2', Name: { label: 'B2' } } : r));
    send({ type: 'setRows', docUri: SLDD, rows: renamed, columns: ['Name'], columnLabels: {}, editable: true });
    await settle();
    expect(table.selectedRowIds).toEqual(['d/design/B2']);
    expect(sent('select')).toEqual([{ type: 'select', rowIds: ['d/design/B2'] }]);
  });

  it('nor when the host repaints the renamed entry first and asks for its new id after', async () => {
    // The narrow rename path's order: updateEntryRows (the old id leaves the table), then
    // selectRows (the new id), as two messages. Clearing on the first and re-selecting on the
    // second posted `select []` and then `select [new]`, and the Property Inspector blanked
    // and came back between them.
    await paint();
    table.selectedRowIds = ['d/design/B'];
    posted.length = 0;
    send({ type: 'updateEntryRows', entryRowId: 'd/design/B', rows: [{ ID: 'd/design/B2', parent: 'section:design', Name: { label: 'B2' } }] });
    send({ type: 'selectRows', rowIds: ['d/design/B2'] });
    await settle();
    expect(table.selectedRowIds).toEqual(['d/design/B2']);
    expect(sent('select')).toEqual([{ type: 'select', rowIds: ['d/design/B2'] }]);
  });

  it('an entry-scoped repaint that removes the selected entry clears it too', async () => {
    await paint();
    table.selectedRowIds = ['d/design/A'];
    posted.length = 0;
    send({ type: 'updateEntryRows', entryRowId: 'd/design/A', rows: [] });
    await settle();
    expect(table.selectedRowIds).toEqual([]);
    expect(sent('select')).toEqual([{ type: 'select', rowIds: [] }]);
  });

  it('a selection the user makes before the clear lands is theirs, and is not cleared', async () => {
    await paint();
    table.selectedRowIds = ['d/design/B'];
    send({ type: 'setRows', docUri: SLDD, rows: withoutB(), columns: ['Name'], columnLabels: {}, editable: true });
    table.selectedRowIds = ['d/design/A'];
    posted.length = 0;
    await settle();
    expect(table.selectedRowIds).toEqual(['d/design/A']);
    expect(sent('select')).toEqual([]);
  });
});

// #8: what a full payload leaves stale. A selection or a rename still waiting for its row
// after a `setRows` has none in it — and a full payload holds every row it is going to —
// so holding the request would let it land on whatever row next takes that id (after an
// undo, a different entry). A document's drop rules go when the payload says its rows no
// longer travel. The broadcast drag does NOT: it is the host's, and a repaint ends no drag.
describe('a full payload clears what it leaves stale', () => {
  const NEW = 'd/design/New';
  const withNew = () => [...DICT_ROWS(), { ID: NEW, parent: 'section:design', Name: { label: 'New' } }];
  const repaint = (rows: any[], over: Record<string, unknown> = {}) =>
    send({ type: 'setRows', docUri: SLDD, rows, columns: ['Name'], columnLabels: {}, editable: true, ...over });

  it('a rename whose row the payload lacks is dropped, not opened on a later row of that id', async () => {
    await paint();
    const renamed: string[] = [];
    const real = table.beginRename;
    table.beginRename = (id: string) => renamed.push(id);
    try {
      send({ type: 'beginRename', rowId: NEW });
      repaint(DICT_ROWS());
      repaint(withNew());
      expect(renamed).toEqual([]);
    } finally {
      table.beginRename = real;
    }
  });

  it('a rename whose row the payload carries still opens', async () => {
    await paint();
    const renamed: string[] = [];
    const real = table.beginRename;
    table.beginRename = (id: string) => renamed.push(id);
    try {
      send({ type: 'beginRename', rowId: NEW });
      repaint(withNew());
      expect(renamed).toEqual([NEW]);
    } finally {
      table.beginRename = real;
    }
  });

  it('a selection whose rows the payload lacks is dropped too', async () => {
    await paint();
    table.selectedRowIds = ['d/design/A'];
    send({ type: 'selectRows', rowIds: [NEW] });
    repaint(DICT_ROWS());
    repaint(withNew());
    expect(table.selectedRowIds).toEqual(['d/design/A']);
  });

  it('a drag in flight is still predicted after a repaint lands under it', async () => {
    // The descriptor mirrors the host's drag register, whose snapshot a repaint does not
    // touch; only the host ends a drag (dragEnd, and after every drop). Clearing it here
    // would refuse the rest of the drag after, say, a file changed on disk.
    await paint();
    send({ type: 'sectionRules', docUri: SLDD, rules: [{ sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] }] });
    send({ type: 'dragState', descriptor: { docUri: 'file:///fx/other.sldd', items: [{ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false, sectionName: 'design' }] } });
    expect(dragOver('d/design/B').defaultPrevented).toBe(true);
    repaint(DICT_ROWS());
    send({ type: 'sectionRules', docUri: SLDD, rules: [{ sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] }] });
    await table.updateComplete;
    expect(dragOver('d/design/B').defaultPrevented).toBe(true);
    send({ type: 'dragState', descriptor: null });
    expect(dragOver('d/design/B').defaultPrevented).toBe(false);
  });

  it("a payload whose rows do not travel drops the document's rules; one whose rows do keeps them", async () => {
    const rules = [{ sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] }];
    send({ type: 'clipboardState', canPaste: true, mode: 'copy', items: [{ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false }] });
    const pasteEnabled = () => {
      table.selectedRowIds = ['d/design/A'];
      posted.length = 0;
      table.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true, composed: true }));
      return sent('paste').length > 0;
    };
    // Rules are posted after the payload they belong to, and survive the next editable one,
    // whichever order a host sends them in.
    repaint(DICT_ROWS());
    send({ type: 'sectionRules', docUri: SLDD, rules });
    repaint(DICT_ROWS());
    expect(pasteEnabled()).toBe(true);
    // A read-only payload: no rule is about this view any more.
    repaint(DICT_ROWS(), { editable: false });
    repaint(DICT_ROWS());
    expect(pasteEnabled()).toBe(false);
  });
});

// #9: every handler read its message as the protocol types it, so one malformed message — a
// null, a field of the wrong shape — threw inside the listener, and a throw there is a table
// that stops repainting without a word. Each now degrades: the row repaints ask for a full
// payload (what they do when they cannot apply), and the state messages keep only what is
// well-formed.
describe('a malformed message does not take the table down', () => {
  // happy-dom reports a listener's throw rather than propagating it to dispatchEvent, so the
  // throw is caught where the window reports it.
  function throwsOf(fn: () => void): unknown[] {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error ?? e.message);
      e.preventDefault?.();
    };
    window.addEventListener('error', onError);
    try {
      fn();
    } catch (err) {
      errors.push(err);
    } finally {
      window.removeEventListener('error', onError);
    }
    return errors;
  }

  it('a message that is not an object is ignored', async () => {
    await paint();
    for (const data of [null, undefined, 42, 'setRows', true]) {
      expect(throwsOf(() => send(data)), String(data)).toEqual([]);
    }
  });

  it('a row repaint whose rows are not a list asks for a full payload instead', async () => {
    await paint();
    for (const type of ['updateEntryRows', 'insertEntryRows']) {
      posted.length = 0;
      const errors = throwsOf(() => send({ type, entryRowId: 'd/design/A', sectionRowId: 'section:design', rows: { not: 'a list' } }));
      expect(errors, type).toEqual([]);
      expect(sent('ready'), type).toEqual([{ type: 'ready' }]);
      // And nothing was removed on the strength of it.
      expect(table.rows.map((r: any) => r.ID), type).toEqual(DICT_ROWS().map((r) => r.ID));
    }
  });

  it('a full payload whose rows are not a list shows an empty table', async () => {
    expect(throwsOf(() => send({ type: 'setRows', docUri: SLDD, rows: 'oops', columns: ['Name'], columnLabels: {}, editable: true }))).toEqual([]);
    expect(table.rows).toEqual([]);
  });

  it('an answer to a fetch whose rows are not a list is dropped', async () => {
    await paint();
    expect(throwsOf(() => send({ type: 'childRows', nodeId: 'd/design/A', rows: 7, truncated: 'many' }))).toEqual([]);
    expect(table.rows.map((r: any) => r.ID)).toEqual(DICT_ROWS().map((r) => r.ID));
  });

  it('rules, clipboard items and a drag that are not well-formed keep only what is', async () => {
    await paint();
    const errors = throwsOf(() => {
      send({ type: 'sectionRules', docUri: SLDD, rules: [null, 5, { sectionLabel: 'no name' }, { sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: 'all' }] });
      send({ type: 'clipboardState', canPaste: true, mode: 'copy', items: [null, 'x', { className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false }] });
      send({ type: 'dragState', descriptor: { docUri: 'file:///fx/o.sldd', items: 'not a list' } });
      table.selectedRowIds = ['d/design/A'];
      table.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true, composed: true }));
      table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId: 'd/design/A', x: 1, y: 1 } }));
      dragOver('d/design/B');
    });
    expect(errors).toEqual([]);
    // The one well-formed item, against the one well-formed rule (its bad list read as none).
    expect(sent('paste')).toEqual([{ type: 'paste', rowId: 'd/design/A' }]);
    (document.querySelector('dex-context-menu') as any).close();
  });
});

// rowId '' means "the document itself", which only a document that posted a whole-file rule
// (a MAT-file) can be a target as. The menu and the predictor already offer it nowhere else;
// this pins that the POST is refused locally too, so no path that reaches postAction or the
// drop listener with no row can hand a dictionary's host a paste or a drop it cannot place.
describe("a paste or drop with no row is posted only by a one-target document", () => {
  const contextMenu = () => document.querySelector('dex-context-menu') as any;

  it('a dictionary posts no paste for a menu action anchored at no row', async () => {
    await paint();
    send({ type: 'sectionRules', docUri: SLDD, rules: [{ sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] }] });
    send({ type: 'clipboardState', canPaste: true, mode: 'copy', items: [{ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false }] });
    // A right-click on no row: the dictionary shows no menu, but it is what leaves the
    // menu's anchor at no row, so an action arriving now would be anchored there.
    table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId: null, x: 1, y: 1 } }));
    posted.length = 0;
    contextMenu().dispatchEvent(new CustomEvent('dex-action', { detail: { actionId: 'paste' } }));
    expect(sent('paste')).toEqual([]);
  });

  it('a dictionary posts no drop on its empty body', async () => {
    await paint();
    posted.length = 0;
    table.dispatchEvent(new CustomEvent('dex-row-drop', { detail: { targetRowId: '', mode: 'move' } }));
    table.dispatchEvent(new CustomEvent('dex-row-drop', { detail: { mode: 'move' } }));
    expect(sent('drop')).toEqual([]);
  });

  it('a MAT-file with its whole-file rule posts both', async () => {
    send({ type: 'setRows', docUri: 'file:///fx/gains.mat', rows: [{ ID: 'm/x', parent: null, Name: { label: 'x' } }], columns: ['Name'], columnLabels: {}, editable: true });
    send({ type: 'sectionRules', docUri: 'file:///fx/gains.mat', rules: [{ sectionName: '', sectionLabel: 'gains.mat', isDerived: false, allowedTypes: [] }] });
    await table.updateComplete;
    table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId: null, x: 1, y: 1 } }));
    posted.length = 0;
    contextMenu().dispatchEvent(new CustomEvent('dex-action', { detail: { actionId: 'paste' } }));
    table.dispatchEvent(new CustomEvent('dex-row-drop', { detail: { targetRowId: '', mode: 'copy' } }));
    expect(sent('paste')).toEqual([{ type: 'paste', rowId: '' }]);
    expect(sent('drop')).toEqual([{ type: 'drop', rowId: '', mode: 'copy' }]);
    contextMenu().close();
  });
});
