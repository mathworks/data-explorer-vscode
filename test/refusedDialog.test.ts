// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// A refused Add Child, Delete or Add (`refused`, view's refusal.ts), through the webview entry point
// as it ships (table-main.ts): shown in the dialog a refused cell edit is shown in, titled by the
// gesture, with the host's reason and nothing else, and still there after the repaint that may
// follow it. Each editor said one in the banner, which every repaint clears, so a refusal followed
// by one was gone before it could be read; and the three editors said three different things.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const REASON = 'This item takes no children.';

describe('a refused gesture, through the webview entry point', () => {
  let dialog: any;

  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({ postMessage: () => {} });
    document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
    await import('../src/webview/table-main.js');
    dialog = document.querySelector('dex-error-dialog');
  }, 60_000);

  beforeEach(async () => {
    if (dialog.hasAttribute('open')) dialog.close();
    await dialog.updateComplete;
  });

  const post = async (data: any) => {
    window.dispatchEvent(new MessageEvent('message', { data }));
    await dialog.updateComplete;
  };

  const setRows = () =>
    post({
      type: 'setRows',
      docUri: 'file:///fx/d.sldd',
      rows: [{ ID: 'd/x', parent: null, Name: { label: 'x' }, Value: '1' }],
      columns: ['Name', 'Value'],
      columnLabels: { Name: 'Name', Value: 'Value' },
      editable: true,
    });

  const banner = () => document.getElementById('dex-error');

  it('opens the dialog, titled by the gesture, with the reason and no Entered or Previous', async () => {
    await setRows();
    await post({ type: 'refused', title: 'Cannot Add Child', reason: REASON });
    expect(dialog.hasAttribute('open')).toBe(true);
    const text = dialog.shadowRoot.textContent as string;
    expect(text).toContain('Cannot Add Child');
    expect(text).toContain(REASON);
    expect(text).not.toContain('Entered');
    expect(text).not.toContain('Previous');
  });

  it('stays open through the repaint that follows it', async () => {
    await post({ type: 'refused', title: 'Cannot Delete', reason: "This element can't be removed from its parent." });
    await setRows();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.shadowRoot.textContent).toContain('Cannot Delete');
  });

  it('where a failure in the banner is cleared by it, which is why a refusal is not said there', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="dex-error" style="display:none"></div>');
    await post({ type: 'error', message: 'Failed to apply edit: boom' });
    expect(banner()?.style.display).toBe('block');
    await setRows();
    expect(banner()?.style.display).toBe('none');
    banner()?.remove();
  });
});
