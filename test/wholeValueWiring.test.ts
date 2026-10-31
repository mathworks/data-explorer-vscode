// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The whole text of a Value shown as a summary, through the webview entry point as it ships
// (table-main.ts): opening the Value editor asks the host for it (`requestEditText`), the host's
// `editText` answer opens the editor on it, and an answer with none opens nothing, saying core's
// reason where it gives one. A read-only view asks for nothing. The host's half is
// test/editTextRequest.test.ts, and the round trip is view's editors/longValueEdit.test.ts.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LONG = '[' + Array.from({ length: 500 }, (_, i) => i + 1).join(' ') + ']';
const ROW = { ID: 'm/v', parent: null, Name: { label: 'v' }, Value: '<1x500 double>', _valueEditable: true, _hasEditText: true, DataType: 'double' };

describe('the whole text of a summary Value, through the webview entry point', () => {
  let table: any;
  let dialog: any;
  let posted: any[];

  beforeAll(async () => {
    localStorage.clear();
    posted = [];
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    table = document.querySelector('dex-tree-table');
    dialog = document.querySelector('dex-error-dialog');
  }, 60_000);

  const show = async (editable: boolean) => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'setRows', docUri: 'file:///fx/m.mat', rows: [ROW], columns: ['Name', 'Value', 'DataType'], editable } }),
    );
    table._editingCell = null;
    if (dialog.hasAttribute('open')) dialog.close();
    await table.updateComplete;
    posted.length = 0;
  };
  beforeEach(() => show(true));

  const host = async (data: any) => {
    window.dispatchEvent(new MessageEvent('message', { data }));
    await table.updateComplete;
    await dialog.updateComplete;
  };
  const dblclick = async () => {
    table.shadowRoot.querySelector('tr[data-row-id="m/v"] td.col-Value').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await table.updateComplete;
  };
  const editor = () => table.shadowRoot.querySelector('.edit-input') as HTMLTextAreaElement | null;

  it('asks the host for the text, and opens the editor on its answer', async () => {
    await dblclick();
    expect(posted).toEqual([{ type: 'requestEditText', rowId: 'm/v' }]);
    expect(editor()).toBeNull();
    await host({ type: 'editText', rowId: 'm/v', text: LONG });
    expect(editor()?.tagName).toBe('TEXTAREA');
    expect(editor()?.value).toBe(LONG);
  });

  it('posts nothing for the text set back unchanged, and the whole text for an edit', async () => {
    await dblclick();
    await host({ type: 'editText', rowId: 'm/v', text: LONG });
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(posted.filter((m) => m.type === 'edit')).toEqual([]);
    await table.updateComplete;
    await dblclick();
    await host({ type: 'editText', rowId: 'm/v', text: LONG });
    editor()!.value = LONG.replace('[1 2 ', '[7 2 ');
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(posted.filter((m) => m.type === 'edit')).toEqual([
      { type: 'edit', rowId: 'm/v', columnId: 'Value', oldValue: LONG, newValue: LONG.replace('[1 2 ', '[7 2 ') },
    ]);
  });

  it("opens nothing for an answer with no text, and says core's reason where it gives one", async () => {
    await dblclick();
    await host({ type: 'editText', rowId: 'm/v', text: null, reason: 'Cannot edit the Value of "v": it changed.' });
    expect(editor()).toBeNull();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.shadowRoot.textContent).toContain('Cannot edit the Value of "v": it changed.');
    dialog.close();
    await dblclick();
    await host({ type: 'editText', rowId: 'm/v', text: null });
    expect(editor()).toBeNull();
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('a read-only view asks for nothing', async () => {
    await show(false);
    await dblclick();
    expect(posted).toEqual([]);
  });
});
