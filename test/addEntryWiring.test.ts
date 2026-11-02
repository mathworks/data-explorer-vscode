// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Add accelerator through the webview entry point, driven as it ships: the host's
// `openAddGallery` (dataExplorer.addEntry) is a message of this extension's, not of the table's
// wire, and table-main.ts hands it to the table's own toggle (messageSource's `extra` →
// handle.toggleAddGallery()), so the keyboard and the button share one path.
//
// The rest of the Add gallery's wiring is view's connectTable({editing}), and view proves it: a
// tile click becomes one `addEntry`, read-only views send none, a pinned run asks for no
// rename, and `beginRename` is held until its row arrives (test/addGalleryWidget.test.ts,
// test/addPopoverRename.test.ts, test/editingTrace.test.ts).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION_ROW = 'section:design';

// Two rows shaped like a real dictionary: the section header a narrow insert is placed
// against, and one entry with a renameable Name (core sets `editable` from nameEditable).
const rowsOf = () => [
  { ID: SECTION_ROW, parent: null, Name: { label: 'Design Data' } },
  { ID: 'doc/design/gain', parent: SECTION_ROW, Name: { label: 'gain', editable: true }, Value: '5' },
];

describe('the Add gallery, wired through the webview entry point', () => {
  let table: any;
  let posted: any[];

  // Its own timeout: a cold import of the whole table-main webview is what a loaded machine stretches.
  beforeAll(async () => {
    posted = [];
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  }, 60_000);

  beforeEach(() => {
    posted.length = 0;
  });

  // A fresh painted table. `editable` is what the toggle reads, and setRows is the only thing
  // that sets it — so every case has to state which view it is.
  async function paint(editable: boolean): Promise<void> {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'setRows',
          docUri: 'file:///fx/d.sldd',
          rows: rowsOf(),
          columns: ['Name', 'Value'],
          columnLabels: { Name: 'Name', Value: 'Value' },
          editable,
        },
      }),
    );
    // One table serves the whole file (the module body wires window listeners once), so an
    // editor left open by the previous case would read as this case's answer. A setRows closes
    // it only when its row or column is gone (ruling V-037), and these rows are the same ones.
    table._editingCell = null;
    await table.updateComplete;
    posted.length = 0;
  }

  const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
  const addsOf = () => posted.filter((m) => m.type === 'addEntry');

  describe('inward: openAddGallery is the accelerator arriving', () => {
    const popover = () => table.shadowRoot.querySelector('dex-add-gallery');

    it('opens the gallery, and toggles it exactly as the button does', async () => {
      await paint(true);
      send({ type: 'openAddGallery' });
      await table.updateComplete;
      expect(popover()).not.toBeNull();
      // Toggled, not re-opened: the accelerator is the same gesture as the button, so a
      // second press closes what the first opened rather than leaving it up.
      send({ type: 'openAddGallery' });
      await table.updateComplete;
      expect(popover()).toBeNull();
    });

    it('opens nothing on a read-only view', async () => {
      // The Command Palette lists what its `when` clause allows, but a palette entry is not
      // a promise — and a read-only .slx has no Add button to anchor a popover to.
      await paint(false);
      send({ type: 'openAddGallery' });
      await table.updateComplete;
      expect(popover()).toBeNull();
    });

    it('adds from the gallery it opened, like any other', async () => {
      // The whole point of routing the key through the button's own method: what opens is
      // the same popover, wired to the same outward relay.
      await paint(true);
      send({ type: 'openAddGallery' });
      await table.updateComplete;
      const g = popover() as any;
      await g.updateComplete;
      const tile = [...g.shadowRoot.querySelectorAll('.tile')].find(
        (t: any) => t.dataset.className === 'Simulink.Parameter',
      ) as HTMLElement;
      tile.click();
      expect(addsOf()).toEqual([
        { type: 'addEntry', section: 'design', className: 'Simulink.Parameter', rename: true },
      ]);
    });
  });
});
