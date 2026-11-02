// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The host's selectByName, through the webview entry point as it ships (table-main.ts). A click on
// a Usage link such as `blocks:65@<model>` in a dictionary opens the model and asks its table to
// select that block, by the name the link carries, which for a block is its SID: nothing in the
// table is labelled `65`. selectByName is not on the table's wire, so the shell takes it off the
// message itself and hands it to view's connectTable (handle.selectByName), whose matcher finds the
// block by its key (view's blockSidIdentity.test.ts). What this holds is the shell's half: the
// name handed over, and the selection told back to the host for the Property Inspector.
import { describe, it, expect, beforeAll } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODEL = 'file:///fx/sid_blocks.slx';
const posted: any[] = [];
let table: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// Two blocks named `Gain` in two systems and a nameless Constant, as core's rows for the model
// view give them: the label is the name, or `<SID: n>`, and the key is the SID.
const block = (sid: string, label: string) => ({
  ID: `${MODEL}/blocks/${sid}`,
  parent: 'section:blocks',
  Name: { label },
  _isBlockRow: true,
  _blockKey: sid,
});

describe('selectByName, through the webview entry point', () => {
  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => void posted.push(JSON.parse(JSON.stringify(m))) });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
  }, 60_000);

  it("hands the host's name to the table, which selects the block whose key it is, and tells the host", async () => {
    send({
      type: 'setRows',
      docUri: MODEL,
      rows: [{ ID: 'section:blocks', parent: null, Name: { label: 'Blocks' } }, block('15', 'Gain'), block('24', 'Gain'), block('65', '<SID: 65>')],
      columns: ['Name'],
      columnLabels: { Name: 'Name' },
      editable: false,
    });
    await settle();
    await table.updateComplete;
    posted.length = 0;

    send({ type: 'selectByName', name: '65' });
    await settle();
    expect(table.selectedRowIds).toEqual([`${MODEL}/blocks/65`]);
    expect(posted.filter((m) => m.type === 'select')).toEqual([{ type: 'select', rowIds: [`${MODEL}/blocks/65`] }]);
  });
});
