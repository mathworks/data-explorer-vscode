// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

// The read-only binary view shows a PERSISTENT informational banner (#dex-notice)
// when a JSON .sldd is too large to edit, and offsets the full-bleed table below
// it. table-main.ts can't be imported in isolation (top-level acquireVsCodeApi()
// + DOM wiring), so — as with readonlyEditorGate.test.ts — we mirror setNotice's
// contract against the same DOM shape the host's getHtml() renders.

function setNotice(table: HTMLElement, message: string | undefined): void {
  const el = document.getElementById('dex-notice');
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.style.display = 'block';
    // Real code defers the offset to rAF so offsetHeight reflects wrapping;
    // happy-dom reports 0 height, so set it synchronously here — the assertions
    // below check the show/hide + offset-cleared contract, not the pixel value.
    table.style.top = el.offsetHeight + 'px';
  } else {
    el.textContent = '';
    el.style.display = 'none';
    table.style.top = '';
  }
}

describe('read-only notice banner (#dex-notice)', () => {
  let table: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="dex-notice" style="display:none;"></div>' +
      '<div id="table" style="position:absolute;inset:0;"></div>';
    table = document.getElementById('table')!;
  });

  it('shows the banner and offsets the table when a notice is present', () => {
    setNotice(table, 'Read-only: this dictionary is 138 MB, above VS Code’s 50 MB editing limit.');
    const el = document.getElementById('dex-notice')!;
    expect(el.style.display).toBe('block');
    expect(el.textContent).toContain('138 MB');
    // The table is pushed down (top set), not left overlapping the banner.
    expect(table.style.top).not.toBe('');
  });

  it('hides the banner and clears the offset when there is no notice', () => {
    setNotice(table, 'something'); // show first
    setNotice(table, undefined); // then clear
    const el = document.getElementById('dex-notice')!;
    expect(el.style.display).toBe('none');
    expect(el.textContent).toBe('');
    expect(table.style.top).toBe('');
  });

  it('is a no-op when the notice element is absent (editable table view)', () => {
    document.body.innerHTML = '<div id="table"></div>'; // no #dex-notice
    const t = document.getElementById('table')!;
    expect(() => setNotice(t, 'x')).not.toThrow();
    expect(t.style.top).toBe('');
  });
});
