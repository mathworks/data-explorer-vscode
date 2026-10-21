// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The MAT-file editor's two departures from a dictionary's table, through the webview entry
// point as it ships (table-main.ts), as addEntryWiring.test.ts drives the gallery's:
//
//  - `add: 'variable'`: the Add button and its key add one variable at once, `var` = 0 in core,
//    with its name editor asked for, and open no gallery of dictionary classes;
//  - `clipboard: false`: the copy, cut and paste chords and a row drag send nothing, since a
//    variable has no dictionary entry form to travel as. Delete still goes.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import '../src/webview/components/dex-add-gallery.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const rowsOf = () => [
  { ID: 'm/x', parent: null, Name: { label: 'x', editable: true }, Value: '1', _canDelete: true, _canCopy: false },
  { ID: 'm/y', parent: null, Name: { label: 'y', editable: true }, Value: '2', _canDelete: true, _canCopy: false },
];

describe('the MAT-file table, wired through the webview entry point', () => {
  let table: any;
  let posted: any[];

  beforeAll(async () => {
    posted = [];
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  }, 60_000);

  beforeEach(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'setRows',
          docUri: 'file:///fx/d.mat',
          rows: rowsOf(),
          columns: ['Name', 'Value'],
          columnLabels: { Name: 'Name', Value: 'Value' },
          editable: true,
          add: 'variable',
          clipboard: false,
        },
      }),
    );
    table._editingCell = null;
    await table.updateComplete;
    posted.length = 0;
  });

  const popover = () => table.shadowRoot.querySelector('dex-add-gallery');
  const addsOf = () => posted.filter((m) => m.type === 'addEntry');

  it('the Add button adds a variable at once and opens no gallery', async () => {
    const button = table.shadowRoot.querySelector('.add-button') as HTMLElement;
    expect(button.getAttribute('title')).toBe('Add a variable');
    expect(button.hasAttribute('aria-haspopup')).toBe(false);
    button.click();
    await table.updateComplete;
    expect(popover()).toBeNull();
    expect(addsOf()).toEqual([{ type: 'addEntry', section: '', className: 'MatlabVariable', rename: true }]);
  });

  it('the Add key does the same', async () => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'openAddGallery' } }));
    await table.updateComplete;
    expect(popover()).toBeNull();
    expect(addsOf()).toEqual([{ type: 'addEntry', section: '', className: 'MatlabVariable', rename: true }]);
  });

  it('copy, cut and paste chords send nothing; Delete still goes', async () => {
    table.selectedRowIds = ['m/x'];
    await table.updateComplete;
    for (const key of ['c', 'x', 'v']) {
      table.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    }
    expect(posted.filter((m) => ['copy', 'cut', 'paste'].includes(m.type))).toEqual([]);
    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(posted.filter((m) => m.type === 'delete')).toEqual([{ type: 'delete', rowIds: ['m/x'] }]);
  });

  it('a row drag and a drop send nothing', () => {
    table.dispatchEvent(new CustomEvent('dex-row-drag-start', { detail: { rowIds: ['m/x'] } }));
    table.dispatchEvent(new CustomEvent('dex-row-drop', { detail: { targetRowId: 'm/y', mode: 'move' } }));
    expect(posted.filter((m) => m.type === 'dragStart' || m.type === 'drop')).toEqual([]);
  });
});
