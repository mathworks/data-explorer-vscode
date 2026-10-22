// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The MAT-file editor's two departures from a dictionary's table, through the webview entry
// point as it ships (table-main.ts), as addEntryWiring.test.ts drives the gallery's:
//
//  - `add: {classes}`: the Add button and its key open a gallery of the classes the host says the
//    file can take a new variable of (core's MatNode.getAllowedTypes), and a tile asks for one of
//    that class, in no section, with its name editor asked for;
//  - `clipboard: false`: the copy, cut and paste chords and a row drag send nothing, since a
//    variable has no dictionary entry form to travel as. Delete still goes.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import '../src/webview/components/dex-add-gallery.js';
import { allTiles } from '../src/common/addCatalog.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// What a host says a MAT-file takes: a subset, in core's order, so the gallery's order is the
// catalog's and not this list's (the String tile follows the Structure, its catalog place).
const CLASSES = ['Simulink.Bus', 'string', 'MatlabVariable', 'Simulink.Parameter', 'MatlabStruct'];
const IN_CATALOG_ORDER = ['MatlabVariable', 'MatlabStruct', 'string', 'Simulink.Parameter', 'Simulink.Bus'];

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
          add: { classes: CLASSES },
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

  const tilesOf = (): HTMLElement[] => [...popover().shadowRoot.querySelectorAll('.tile')] as HTMLElement[];
  const closeGallery = async () => {
    if (popover()) table.toggleAddGallery();
    await table.updateComplete;
  };

  it("the Add button opens a gallery of the file's classes, and a tile asks for one, in no section", async () => {
    await closeGallery();
    const button = table.shadowRoot.querySelector('.add-button') as HTMLElement;
    expect(button.getAttribute('title')).toBe('Add a variable');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    button.click();
    await table.updateComplete;
    await popover().updateComplete;
    expect(tilesOf().map((t) => t.dataset.className)).toEqual(IN_CATALOG_ORDER);
    expect(tilesOf().map((t) => t.getAttribute('aria-label'))).toEqual(['Add MATLAB Variable', 'Add MATLAB Structure', 'Add MATLAB String', 'Add Simulink Parameter', 'Add Simulink Bus']);
    expect(popover().shadowRoot.querySelectorAll('.tile-badge').length).toBe(0);
    tilesOf()[3].click();
    await table.updateComplete;
    expect(addsOf()).toEqual([{ type: 'addEntry', section: '', className: 'Simulink.Parameter', rename: true }]);
    expect(popover(), 'an unpinned add closes the gallery').toBeNull();
  });

  it('the Add key opens the same gallery', async () => {
    await closeGallery();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'openAddGallery' } }));
    await table.updateComplete;
    await popover().updateComplete;
    expect(tilesOf().map((t) => t.dataset.className)).toEqual(IN_CATALOG_ORDER);
    expect(addsOf()).toEqual([]);
    await closeGallery();
  });

  it("a dictionary's table, told no classes, offers its whole gallery again", async () => {
    await closeGallery();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'setRows', docUri: 'file:///fx/d.sldd', rows: rowsOf(), columns: ['Name', 'Value'], columnLabels: {}, editable: true },
      }),
    );
    await table.updateComplete;
    table.toggleAddGallery();
    await table.updateComplete;
    await popover().updateComplete;
    expect(tilesOf().map((t) => `${t.dataset.section} ${t.dataset.className}`)).toEqual(allTiles().map((t) => `${t.section} ${t.className}`));
    await closeGallery();
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

  it('no row is draggable, though a dictionary’s are', async () => {
    const rowEls = () => [...table.shadowRoot.querySelectorAll('tr.data-row')] as HTMLElement[];
    expect(rowEls().length).toBeGreaterThan(0);
    expect(rowEls().every((r) => r.getAttribute('draggable') === 'false')).toBe(true);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'setRows', docUri: 'file:///fx/d.sldd', rows: rowsOf(), columns: ['Name', 'Value'], columnLabels: {}, editable: true },
      }),
    );
    await table.updateComplete;
    expect(rowEls().every((r) => r.getAttribute('draggable') === 'true')).toBe(true);
  });

  it('a row drag and a drop send nothing', () => {
    table.dispatchEvent(new CustomEvent('dex-row-drag-start', { detail: { rowIds: ['m/x'] } }));
    table.dispatchEvent(new CustomEvent('dex-row-drop', { detail: { targetRowId: 'm/y', mode: 'move' } }));
    expect(posted.filter((m) => m.type === 'dragStart' || m.type === 'drop')).toEqual([]);
  });
});
