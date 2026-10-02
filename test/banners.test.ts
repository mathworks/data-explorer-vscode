// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBanners, renderError } from '../src/webview/banners.js';

// The banner strip above the table: the persistent read-only notice (#dex-notice)
// and the parse-warning banner (#dex-warning). This drives the SHIPPING code —
// which is why renderBanners lives in its own module. It used to be setNotice
// inside table-main.ts, a module no test can import (top-level acquireVsCodeApi()),
// so the test mirrored a copy of it and would have passed unchanged had the
// original been deleted.
//
// The DOM under test is the real one: BANNERS_HTML from src/host/webviewHtml.ts,
// the string all three providers interpolate. Hand-written markup here would be a
// fifth copy of the shell, and agreement with the shells is the invariant.
const root = join(import.meta.dirname, '..');
const BANNERS_HTML = /BANNERS_HTML = `([\s\S]*?)`;/.exec(
  readFileSync(join(root, 'src/host/webviewHtml.ts'), 'utf8'),
)![1];

// happy-dom reports every offsetHeight as 0, so the real rAF deferral would make
// the offset untestable. Run the measurement synchronously and assert the contract
// (offset set / offset cleared) rather than a pixel value.
const now = (fn: () => void) => fn();

const el = (id: string) => document.getElementById(id)!;

describe('renderBanners', () => {
  let table: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = BANNERS_HTML + '<div id="table" style="position:absolute;inset:0;"></div>';
    table = el('table');
  });

  it('shows the notice and offsets the table', () => {
    renderBanners(table, { notice: 'Read-only: this dictionary is 138 MB, above VS Code’s 50 MB editing limit.' }, now);
    expect(el('dex-notice').style.display).toBe('block');
    expect(el('dex-notice').textContent).toContain('138 MB');
    // Pushed down, not left underneath the banner it would otherwise hide.
    expect(table.style.top).not.toBe('');
  });

  it('shows the warning headline and each detail as its own line', () => {
    renderBanners(
      table,
      {
        warnings: {
          headline: '2 parts of this file could not be read.',
          details: ['Skipped variable "alpha".', 'Skipped variable "beta".'],
        },
      },
      now,
    );
    expect(el('dex-warning').style.display).toBe('block');
    expect(el('dex-warning-headline').textContent).toBe('2 parts of this file could not be read.');
    const items = [...el('dex-warning-details').children].map((c) => c.textContent);
    expect(items).toEqual(['Skipped variable "alpha".', 'Skipped variable "beta".']);
  });

  it('renders messages as text, never as markup', () => {
    // Every string here is core's own message, and core builds them by interpolating
    // names out of the FILE — an entry name, a part path, a thrown error's text. The
    // webview's CSP blocks inline script, so this is about the table not being
    // rearranged by a dictionary that happens to contain angle brackets.
    renderBanners(table, { warnings: { headline: '<img src=x>', details: ['<b>bold</b>'] } }, now);
    expect(el('dex-warning-headline').children).toHaveLength(0);
    expect(el('dex-warning-details').firstElementChild!.innerHTML).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('hides the empty detail list when there is only a headline', () => {
    // A source-level warning is a headline with no details, and an empty <ul> still
    // occupies its margins — a stripe of blank banner under the one line.
    renderBanners(table, { warnings: { headline: 'This project reads as empty.', details: [] } }, now);
    expect(el('dex-warning').style.display).toBe('block');
    expect(el('dex-warning-details').style.display).toBe('none');
  });

  it('shows both at once, because a file can be both read-only and short', () => {
    // The reason the payload carries two fields rather than one string: a JSON .sldd
    // over the sync limit that ALSO lost a part has two independent things to say,
    // and folding them together would force a choice between them.
    renderBanners(table, { notice: 'Read-only.', warnings: { headline: 'Incomplete.', details: [] } }, now);
    expect(el('dex-notice').style.display).toBe('block');
    expect(el('dex-warning').style.display).toBe('block');
  });

  it('clears both and the offset for a payload carrying neither', () => {
    // Every repaint goes through here, so this is what makes a warning go away: the
    // editable table view reposts on every keystroke, and a dictionary the user has
    // just finished fixing must stop warning without a reload.
    renderBanners(table, { notice: 'Read-only.', warnings: { headline: 'Incomplete.', details: ['x'] } }, now);
    renderBanners(table, {}, now);
    expect(el('dex-notice').style.display).toBe('none');
    expect(el('dex-notice').textContent).toBe('');
    expect(el('dex-warning').style.display).toBe('none');
    expect(el('dex-warning-details').children).toHaveLength(0);
    expect(table.style.top).toBe('');
  });

  it('replaces the previous details rather than appending to them', () => {
    renderBanners(table, { warnings: { headline: 'a', details: ['one', 'two'] } }, now);
    renderBanners(table, { warnings: { headline: 'b', details: ['three'] } }, now);
    expect([...el('dex-warning-details').children].map((c) => c.textContent)).toEqual(['three']);
  });

  it('is a no-op when the strip is absent from the shell', () => {
    // Defensive only: the strip is now in all four shells and webviewOverlays.test.ts
    // pins that. But this module is loaded by whichever shell VS Code built, and a
    // throw here would blank the table for every file — the exact failure that
    // shipped when <dex-variable-editor> existed in one shell alone.
    document.body.innerHTML = '<div id="table"></div>';
    const t = el('table');
    expect(() => renderBanners(t, { notice: 'x' }, now)).not.toThrow();
    expect(t.style.top).toBe('');
  });

  it('offsets the table for an error banner too, since it is in the same strip', () => {
    // The banner that reaches a user only on the worst path: the host could not
    // deliver a payload at all, and this message is the only thing that ends the
    // table's loading spinner. It used to be painted from table-main.ts into markup
    // OUTSIDE the strip — normal flow, ahead of a table pinned at inset:0 — so the
    // table painted over it, measured in a real browser as a cleared spinner above
    // the words "No data".
    renderError(table, 'Failed to show allMidi.mat: Invalid string length', now);
    expect(el('dex-error').style.display).toBe('block');
    expect(el('dex-error').textContent).toContain('Invalid string length');
    expect(table.style.top).not.toBe('');
  });

  it('clears the error and the offset when passed nothing', () => {
    renderError(table, 'gone wrong', now);
    renderError(table, undefined, now);
    expect(el('dex-error').style.display).toBe('none');
    expect(el('dex-error').textContent).toBe('');
    expect(table.style.top).toBe('');
  });

  it('renders an error as text, never as markup', () => {
    // The message interpolates a thrown error's text and a file name, neither of
    // which this module chose.
    renderError(table, '<img src=x onerror=1>', now);
    expect(el('dex-error').children).toHaveLength(0);
    expect(el('dex-error').textContent).toBe('<img src=x onerror=1>');
  });

  it('leaves a showing error alone when a repaint carries no banners', () => {
    // The three banners arrive on different messages, so each paint has to decide
    // the offset from what is SHOWING rather than from its own argument. Before
    // that, an `updateEntryRows` with nothing to say would have dropped the table
    // back to the top of the panel and slid it under the error still above it.
    renderError(table, 'Failed to show allMidi.mat: Invalid string length', now);
    renderBanners(table, {}, now);
    expect(el('dex-error').style.display).toBe('block');
    expect(table.style.top).not.toBe('');
  });

  it('keeps the offset when the error clears but a notice is still up', () => {
    // The other direction of the same rule, and the common one: a read-only view
    // whose failed save has been superseded still has a banner above the table.
    renderBanners(table, { notice: 'Read-only.' }, now);
    renderError(table, 'a failure', now);
    renderError(table, undefined, now);
    expect(el('dex-notice').style.display).toBe('block');
    expect(table.style.top).not.toBe('');
  });

  it('defers the measurement to the next frame by default', () => {
    // The default scheduler is requestAnimationFrame because offsetHeight has to be
    // read after layout: the message wraps at narrow widths, and a height measured
    // before the browser has laid it out is the one-line height of a three-line
    // banner. Only the tests pass a synchronous scheduler.
    renderBanners(table, { notice: 'measured after layout' });
    expect(el('dex-notice').style.display).toBe('block'); // painted synchronously
    expect(table.style.top).toBe(''); // offset is not
  });
});
