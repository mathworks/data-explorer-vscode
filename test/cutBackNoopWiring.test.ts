// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// Review #7, through the webview entry point as it ships (table-main.ts): a cut pasted back
// into the section every item came from is a no-op — the host clears the cut and edits
// nothing — so the menu disables Paste and says why, and Cmd+V sends nothing, exactly as a
// drag of the same rows onto that section is refused (dropDecision). menuItems.test.ts pins
// the builder; this pins that the editing half table-main wires up (view's connectTable) hands
// it the facts (the broadcast's `sourceDocUri` and per-item `sectionName`, this document's uri,
// the target's section name).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SLDD = 'file:///fx/d.sldd';
const MAT = 'file:///fx/gains.mat';
const BUS = { className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false };

const posted: any[] = [];
let table: any;
let contextMenu: any;

const send = (data: any) => window.dispatchEvent(new MessageEvent('message', { data }));
const pastes = () => posted.filter((m) => m.type === 'paste');

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) });
  document.body.innerHTML = '<dex-tree-table></dex-tree-table>';
  await import('../src/webview/table-main.js');
  table = document.querySelector('dex-tree-table');
  contextMenu = document.querySelector('dex-context-menu');
}, 60_000);

afterEach(() => contextMenu.close());

async function paintDictionary(): Promise<void> {
  send({
    type: 'setRows',
    docUri: SLDD,
    rows: [
      { ID: 'section:design', parent: null, Name: { label: 'Design Data' } },
      { ID: 'd/design/A', parent: 'section:design', Name: { label: 'A' }, _canCopy: true, _canDelete: true },
      { ID: 'section:arch', parent: null, Name: { label: 'Architectural Data' } },
      { ID: 'd/arch/V', parent: 'section:arch', Name: { label: 'V' }, _canCopy: true, _canDelete: true },
    ],
    columns: ['Name'],
    columnLabels: { Name: 'Name' },
    editable: true,
  });
  send({
    type: 'sectionRules',
    docUri: SLDD,
    rules: [
      { sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] },
      { sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, allowedTypes: [] },
    ],
  });
  await table.updateComplete;
}

const cutFrom = (sourceDocUri: string, sectionName: string) =>
  send({ type: 'clipboardState', canPaste: true, mode: 'cut', sourceDocUri, items: [{ ...BUS, sectionName }] });

async function pressPasteOn(rowId: string | null): Promise<void> {
  table.selectedRowIds = rowId ? [rowId] : [];
  await table.updateComplete;
  posted.length = 0;
  table.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true, composed: true }));
}

/** The Paste item of the menu a right-click on `rowId` opens, as it renders. */
async function pasteItemOn(rowId: string | null): Promise<{ disabled: boolean; reason: string | null } | undefined> {
  table.dispatchEvent(new CustomEvent('dex-table-context-menu', { detail: { rowId, x: 1, y: 1 } }));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await contextMenu.updateComplete;
  const item = [...contextMenu.shadowRoot.querySelectorAll('.item')].find(
    (el: any) => el.querySelector('.item-label')?.textContent === 'Paste',
  ) as HTMLElement | undefined;
  // A disabled item's reason is its title (dex-context-menu's _tooltipFor).
  return item && { disabled: item.getAttribute('aria-disabled') === 'true', reason: item.getAttribute('title') };
}

describe('a dictionary', () => {
  it('a cut from Design Data offers no Paste back into Design Data, and Cmd+V sends nothing', async () => {
    await paintDictionary();
    cutFrom(SLDD, 'design');
    table.selectedRowIds = ['d/design/A'];
    expect(await pasteItemOn('d/design/A')).toMatchObject({ disabled: true, reason: 'Already in Design Data' });
    await pressPasteOn('d/design/A');
    expect(pastes()).toEqual([]);
  });

  it('still pastes it into another section, or into another document’s same section', async () => {
    await paintDictionary();
    cutFrom(SLDD, 'design');
    await pressPasteOn('d/arch/V');
    expect(pastes()).toEqual([{ type: 'paste', rowId: 'd/arch/V' }]);
    cutFrom('file:///fx/other.sldd', 'design');
    await pressPasteOn('d/design/A');
    expect(pastes()).toEqual([{ type: 'paste', rowId: 'd/design/A' }]);
  });
});

describe('a MAT-file', () => {
  it("a cut of its own variable offers no Paste back into it, from a row or the body", async () => {
    send({ type: 'setRows', docUri: MAT, rows: [{ ID: 'm/x', parent: null, Name: { label: 'x' }, _canCopy: true, _canDelete: true }], columns: ['Name'], columnLabels: {}, editable: true });
    send({ type: 'sectionRules', docUri: MAT, rules: [{ sectionName: '', sectionLabel: 'gains.mat', isDerived: false, allowedTypes: [] }] });
    await table.updateComplete;
    cutFrom(MAT, '');
    table.selectedRowIds = ['m/x'];
    expect(await pasteItemOn('m/x')).toMatchObject({ disabled: true, reason: 'Already in gains.mat' });
    contextMenu.close();
    expect(await pasteItemOn(null)).toMatchObject({ disabled: true, reason: 'Already in gains.mat' });
    await pressPasteOn(null);
    expect(pastes()).toEqual([]);
    // From another file it lands.
    cutFrom('file:///fx/other.mat', '');
    await pressPasteOn(null);
    expect(pastes()).toEqual([{ type: 'paste', rowId: '' }]);
  });
});
