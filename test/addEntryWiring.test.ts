// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Add gallery's two wires through the webview entry point, driven as they ship.
//
// Outward, a tile click becomes one `addEntry` message. Inward, `beginRename` opens the name
// editor on the entry the host just created. Both live in table-main.ts, which is why this
// file imports that module rather than reimplementing its listeners: a copy of a listener
// proves the copy works, and the gate on `editable` and the hold-until-the-row-arrives are
// exactly the parts a copy gets right and the shipped code gets wrong.
//
// The rename half is the one with an ordering hazard. `selectRows` and `beginRename` are two
// messages riding beside a repaint, and nothing in the webview may assume which arrives
// first — so a rename asked for before its row exists must be held, and then must actually
// happen when the row lands. The failure if it is not held is silent: the entry is created
// and selected, the editor never opens, and the user is left renaming it by hand.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import '../src/webview/components/dex-add-gallery.js';

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

  // A fresh painted table. `editable` is the module-level flag both wires read, and setRows
  // is the only thing that sets it — so every case has to state which view it is.
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

  describe('outward: a tile click becomes one addEntry', () => {
    it('sends the class, the section and the rename the gesture asked for', async () => {
      await paint(true);
      const gallery = table.shadowRoot.querySelector('.add-button') as HTMLElement;
      gallery.click();
      await table.updateComplete;
      const popover = table.shadowRoot.querySelector('dex-add-gallery') as any;
      await popover.updateComplete;
      const tile = [...popover.shadowRoot.querySelectorAll('.tile')].find(
        (t: any) => t.dataset.className === 'Simulink.Parameter',
      ) as HTMLElement;
      tile.click();

      // Nothing about the selection travels: a tile carries its own destination, so the add
      // means the same thing wherever the cursor is.
      expect(addsOf()).toEqual([
        { type: 'addEntry', section: 'design', className: 'Simulink.Parameter', rename: true },
      ]);
    });

    it('sends nothing on a read-only view, button or no button', async () => {
      await paint(false);
      // The button is absent there (table.canAdd), so the click cannot be the test. Dispatch
      // the event the button would have caused: the guard, not the missing affordance, is
      // what has to hold — a stale popover or a keyboard path would reach the same listener.
      expect(table.shadowRoot.querySelector('.add-button')).toBeNull();
      table.dispatchEvent(
        new CustomEvent('dex-add-entry', {
          detail: { className: 'Simulink.Parameter', section: 'design', rename: true },
        }),
      );
      expect(addsOf()).toEqual([]);
    });

    it('carries rename: false through a pinned run, one message per click', async () => {
      await paint(true);
      for (const rename of [false, false]) {
        table.dispatchEvent(
          new CustomEvent('dex-add-entry', {
            detail: { className: 'Simulink.Signal', section: 'design', rename },
          }),
        );
      }
      expect(addsOf()).toEqual([
        { type: 'addEntry', section: 'design', className: 'Simulink.Signal', rename: false },
        { type: 'addEntry', section: 'design', className: 'Simulink.Signal', rename: false },
      ]);
    });
  });

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

  describe('inward: beginRename opens the editor on the new entry', () => {
    const editingCell = () => table._editingCell ?? null;
    const editorInput = () => table.shadowRoot.querySelector('.edit-input') as HTMLInputElement | null;

    it('opens the name editor on a row that is already here', async () => {
      await paint(true);
      send({ type: 'beginRename', rowId: 'doc/design/gain' });
      await table.updateComplete;
      expect(editingCell()).toMatchObject({ rowId: 'doc/design/gain', columnId: 'Name' });
      // And the editor is really in the DOM with the name in it, which is what the user sees.
      expect(editorInput()?.value).toBe('gain');
    });

    it('holds the request until the row arrives, then opens it', async () => {
      // The ordering hazard: the host posts the repaint and then the rename, but the webview
      // must not depend on that — a resync, a queued message or a future host change could
      // reverse it, and the symptom would be an editor that silently never opens.
      await paint(true);
      const newRow = {
        ID: 'doc/design/Param',
        parent: SECTION_ROW,
        Name: { label: 'Param', editable: true },
        Value: '0',
      };
      send({ type: 'beginRename', rowId: newRow.ID });
      await table.updateComplete;
      expect(editingCell()).toBeNull();
      // No full-repaint request either: holding is the answer, not degrading.
      expect(posted.filter((m) => m.type === 'ready')).toEqual([]);

      send({ type: 'insertEntryRows', sectionRowId: SECTION_ROW, rows: [newRow] });
      await table.updateComplete;
      expect(editingCell()).toMatchObject({ rowId: newRow.ID, columnId: 'Name' });
      expect(editorInput()?.value).toBe('Param');
    });

    it('does not reopen on the next repaint once it has been answered', async () => {
      // The request is consumed, not remembered. After an undo the same id can name a
      // different entry, and an editor opening on it unasked would be an edit the user did
      // not start.
      await paint(true);
      send({ type: 'beginRename', rowId: 'doc/design/gain' });
      await table.updateComplete;
      expect(editingCell()).not.toBeNull();
      table._editingCell = null; // as an Escape in the editor would
      await table.updateComplete;

      send({ type: 'setRows', docUri: 'file:///fx/d.sldd', rows: rowsOf(), columns: ['Name', 'Value'], editable: true });
      await table.updateComplete;
      expect(editingCell()).toBeNull();
    });

    it('a whole repaint that drops the renamed row closes its editor; one that keeps it does not', async () => {
      // Ruling V-037 (b), through the shipped setRows handler. The entry being renamed is
      // undone, or deleted from the text view, and the repaint no longer carries it: the
      // editor closes rather than stay open over a row that is not there, which left the
      // table deaf to the keyboard.
      await paint(true);
      send({ type: 'beginRename', rowId: 'doc/design/gain' });
      await table.updateComplete;
      expect(editingCell()).toMatchObject({ rowId: 'doc/design/gain', columnId: 'Name' });

      const withoutGain = rowsOf().filter((r) => r.ID !== 'doc/design/gain');
      send({
        type: 'setRows',
        docUri: 'file:///fx/d.sldd',
        rows: withoutGain,
        columns: ['Name', 'Value'],
        editable: true,
      });
      await table.updateComplete;
      expect(editingCell()).toBeNull();
      expect(editorInput()).toBeNull();

      // The background repaint (a save) carries the row again: the editor stays open.
      await paint(true);
      send({ type: 'beginRename', rowId: 'doc/design/gain' });
      await table.updateComplete;
      const input = editorInput()!;
      input.value = 'gainTyped';
      send({ type: 'setRows', docUri: 'file:///fx/d.sldd', rows: rowsOf(), columns: ['Name', 'Value'], editable: true });
      await table.updateComplete;
      expect(editingCell()).toMatchObject({ rowId: 'doc/design/gain', columnId: 'Name' });
      expect(editorInput()?.value).toBe('gainTyped');
    });

    it('opens nothing for a row the table does not hold a renameable name for', async () => {
      // The component decides, through the same `_cellEditTarget` a double-click goes
      // through: a section header has no editable Name, so there is no editor to open and no
      // request left pending either.
      await paint(true);
      send({ type: 'beginRename', rowId: SECTION_ROW });
      await table.updateComplete;
      expect(editingCell()).toBeNull();

      send({ type: 'insertEntryRows', sectionRowId: SECTION_ROW, rows: [] });
      await table.updateComplete;
      expect(editingCell()).toBeNull();
    });

    it('ignores a rowId that is not a string rather than holding forever', async () => {
      await paint(true);
      send({ type: 'beginRename', rowId: undefined });
      await table.updateComplete;
      send({ type: 'insertEntryRows', sectionRowId: SECTION_ROW, rows: [] });
      await table.updateComplete;
      expect(editingCell()).toBeNull();
    });
  });

  // Ruling V-038, option (b): closing a pinned gallery does NOT select the run it added. Each
  // add selects its own new entry, so the last one is what stays selected, and closing changes
  // nothing. The reasons are in addGallery.test.ts ('the pin promises only what it does').
  // This passes before and after the ruling. It is here so that building the run selection
  // later is a deliberate change to this test, and not a tooltip and a behaviour that drift
  // apart again.
  describe('closing a pinned run', () => {
    const popover = () => table.shadowRoot.querySelector('dex-add-gallery') as any;
    const tileOf = (g: any, className: string) =>
      [...g.shadowRoot.querySelectorAll('.tile')].find((t: any) => t.dataset.className === className) as HTMLElement;
    const added = (name: string) => ({
      ID: `doc/design/${name}`,
      parent: SECTION_ROW,
      Name: { label: name, editable: true },
      Value: '0',
    });

    const closers: [string, (g: any) => void][] = [
      [
        'the popover’s Escape',
        (g) =>
          tileOf(g, 'Simulink.Parameter').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
          ),
      ],
      ['the Add button', () => (table.shadowRoot.querySelector('.add-button') as HTMLElement).click()],
      ['the accelerator', () => send({ type: 'openAddGallery' })],
    ];

    it.each(closers)('leaves the last entry selected, closed by %s, and opens no editor', async (_, close) => {
      await paint(true);
      table.selectedRowIds = [];
      (table.shadowRoot.querySelector('.add-button') as HTMLElement).click();
      await table.updateComplete;
      const g = popover();
      await g.updateComplete;
      const pin = g.shadowRoot.querySelector('.gallery-pin input') as HTMLInputElement;
      pin.checked = true;
      pin.dispatchEvent(new Event('change', { bubbles: true }));
      await table.updateComplete;
      try {
        // Two tile clicks, each answered as both hosts answer an add: the new entry's rows,
        // then `selectRows` naming that one entry. No `beginRename`, because a pinned add
        // asks for none.
        const run = [added('Param'), added('Param1')];
        for (const row of run) {
          tileOf(g, 'Simulink.Parameter').click();
          send({ type: 'insertEntryRows', sectionRowId: SECTION_ROW, rows: [row] });
          send({ type: 'selectRows', rowIds: [row.ID] });
          await table.updateComplete;
        }
        expect(addsOf().map((m) => m.rename)).toEqual([false, false]);
        expect(popover()).not.toBeNull();
        expect(table.selectedRowIds).toEqual(['doc/design/Param1']);

        const before = posted.length;
        close(g);
        await table.updateComplete;
        expect(popover()).toBeNull();
        // The run is not selected: only the entry the last add selected is.
        expect(table.selectedRowIds).toEqual(['doc/design/Param1']);
        expect(table._editingCell ?? null).toBeNull();
        // And the host is told of no new selection, so the Property Inspector stays put.
        expect(posted.slice(before).filter((m) => m.type === 'select')).toEqual([]);
      } finally {
        // One table serves the whole file, and the pin outlives a close by design. Leave the
        // next case an unpinned, closed gallery, even when this one failed partway.
        table._addPinned = false;
        if (popover()) table.toggleAddGallery();
        await table.updateComplete;
      }
    });
  });
});
