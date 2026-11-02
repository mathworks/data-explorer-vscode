// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The MAT-file editor's table, through the webview entry point as it ships (table-main.ts), as
// addEntryWiring.test.ts drives the gallery's: the Add key, the host's `openAddGallery`, opens
// the gallery of the classes the host says the file can take a new variable of (core's
// MatNode.getAllowedTypes). The message is this extension's, so this is table-main's half.
//
// The rest of the MAT-file table is view's connectTable({editing}), and view proves it: the
// gallery of the file's classes, a tile asking in no section, the chords and the row drags of a
// dictionary's table, and a later dictionary's setRows offering the whole gallery again
// (test/editingTrace.test.ts, test/addGalleryGrid.test.ts, test/addGalleryRepaint.test.ts).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// What a host says a MAT-file takes: a subset, in core's order, so the gallery's order is the
// catalog's and not this list's; and `string`, which core lists and the gallery leaves out
// (MAT_OMITTED: typing one into a variable's Value makes one).
const CLASSES = ['Simulink.Bus', 'string', 'MatlabVariable', 'Simulink.Parameter', 'MatlabStruct'];
const IN_CATALOG_ORDER = ['MatlabVariable', 'MatlabStruct', 'Simulink.Parameter', 'Simulink.Bus'];

const rowsOf = () => [
  { ID: 'm/x', parent: null, Name: { label: 'x', editable: true }, Value: '1', _canDelete: true, _canCopy: true },
  { ID: 'm/y', parent: null, Name: { label: 'y', editable: true }, Value: '2', _canDelete: true, _canCopy: true },
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
        },
      }),
    );
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

  it('the Add key opens the same gallery', async () => {
    await closeGallery();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'openAddGallery' } }));
    await table.updateComplete;
    await popover().updateComplete;
    expect(tilesOf().map((t) => t.dataset.className)).toEqual(IN_CATALOG_ORDER);
    expect(addsOf()).toEqual([]);
    await closeGallery();
  });
});
