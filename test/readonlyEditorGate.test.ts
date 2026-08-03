// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { shouldOpenCellEditor } from '../src/webview/menuItems.js';

// The vendored dex-tree-table opens its inline cell editor from handlers bound
// INSIDE its shadow DOM (on the <td> cells) for both double-click and Enter.
// The webview blocks that for read-only documents with a CAPTURE-phase listener
// on the host element that calls stopPropagation before the event descends into
// the shadow tree. These tests lock down that mechanism: capture-phase
// stopPropagation on the host must prevent a shadow-internal listener from
// firing, and must do so exactly when the document is read-only.
//
// This mirrors the component's event contract without depending on the vendored
// component (which we must not edit) or on table-main.ts (which runs top-level
// acquireVsCodeApi()/DOM wiring that can't be imported in isolation).

describe('read-only cell-editor gate (capture-phase interception)', () => {
  let host: HTMLElement;
  let shadowCell: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="host"></div>';
    host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const td = document.createElement('td');
    td.id = 'cell';
    shadow.appendChild(td);
    shadowCell = td;
  });

  // Install the same guards table-main.ts installs, parameterized by editable.
  function installGuards(editable: boolean): void {
    host.addEventListener(
      'dblclick',
      (e) => {
        if (!shouldOpenCellEditor(editable)) e.stopPropagation();
      },
      true,
    );
    host.addEventListener(
      'keydown',
      (e) => {
        if ((e as KeyboardEvent).key === 'Enter' && !shouldOpenCellEditor(editable)) {
          e.stopPropagation();
        }
      },
      true,
    );
  }

  it('read-only: a double-click never reaches the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('dblclick', () => opened++);
    installGuards(false);
    shadowCell.dispatchEvent(new Event('dblclick', { bubbles: true, composed: true }));
    expect(opened).toBe(0);
  });

  it('read-only: an Enter keydown never reaches the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') opened++;
    });
    installGuards(false);
    shadowCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(opened).toBe(0);
  });

  it('editable: a double-click DOES reach the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('dblclick', () => opened++);
    installGuards(true);
    shadowCell.dispatchEvent(new Event('dblclick', { bubbles: true, composed: true }));
    expect(opened).toBe(1);
  });

  it('editable: an Enter keydown DOES reach the shadow-internal editor handler', () => {
    let opened = 0;
    shadowCell.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') opened++;
    });
    installGuards(true);
    shadowCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(opened).toBe(1);
  });

  it('read-only: a non-Enter key (e.g. ArrowDown) is NOT swallowed — only Enter is blocked', () => {
    let navigated = 0;
    shadowCell.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'ArrowDown') navigated++;
    });
    installGuards(false);
    shadowCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
    expect(navigated).toBe(1);
  });
});
