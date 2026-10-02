// Copyright 2026 The MathWorks, Inc.
// Paints the banner strip above the table: the error banner, the persistent
// read-only notice and the parse-warning banner (see BANNERS_HTML in
// src/host/webviewHtml.ts for the markup all four table shells declare).
//
// A module of its own, rather than two functions inside table-main.ts, for one
// reason: table-main.ts cannot be imported by a unit test (top-level
// acquireVsCodeApi() + DOM wiring), so anything living there is testable only by
// a copy of itself — and test/readonlyNotice.test.ts was exactly that copy,
// asserting a mirror of setNotice that no longer had to match the original. This
// file is DOM-only and import-safe, so the test drives the shipping code.
//
// The table is full-bleed (position:absolute;inset:0), so showing a banner means
// offsetting the table's top by the strip's MEASURED height — measured because a
// message wraps at narrow widths, and any two of the three can be showing at
// once. The measurement is deferred through `schedule` so it happens after
// layout; tests pass a synchronous scheduler because happy-dom reports every
// height as 0.
//
// The error banner is painted from here, by its own function, for the same reason
// the other two are: it is in the strip, so it changes the strip's height, and
// whoever moves the table has to know about all three. It arrived through a
// separate message and was painted in table-main.ts from markup that sat OUTSIDE
// the strip — in <body>'s normal flow, ahead of the absolutely-positioned table,
// which therefore painted over it. The message was in the DOM and on screen
// nowhere.
import type { WarningBanner } from '../host/parseWarnings.js';

/** What a setRows payload can say about the strip. Both parts are optional. */
export interface BannerPayload {
  /** Why this view is read-only, when that is surprising. */
  notice?: string;
  /** What the parse could not read. */
  warnings?: WarningBanner;
}

function paintNotice(message: string | undefined): boolean {
  const el = document.getElementById('dex-notice');
  if (!el) return false;
  el.textContent = message ?? '';
  el.style.display = message ? 'block' : 'none';
  return !!message;
}

function paintWarning(banner: WarningBanner | undefined): boolean {
  const el = document.getElementById('dex-warning');
  const headline = document.getElementById('dex-warning-headline');
  const details = document.getElementById('dex-warning-details');
  if (!el || !headline || !details) return false;
  headline.textContent = banner?.headline ?? '';
  details.replaceChildren();
  for (const line of banner?.details ?? []) {
    const li = document.createElement('li');
    li.textContent = line;
    details.appendChild(li);
  }
  // An empty <ul> still occupies its margins, so hide it when core gave us a
  // headline but no per-part messages.
  details.style.display = banner?.details.length ? 'block' : 'none';
  el.style.display = banner ? 'block' : 'none';
  return !!banner;
}

/** Whether one of the strip's banners is currently showing. */
function showing(id: string): boolean {
  return document.getElementById(id)?.style.display === 'block';
}

/**
 * Offset the full-bleed table by the whole strip's height, or clear the offset
 * when nothing is showing.
 *
 * Reads which banners are up out of the DOM rather than from an argument, because
 * the three arrive on different messages: a `setRows` that carries no warning must
 * not drop the table back under an error banner it knows nothing about.
 *
 * Whether to offset is decided by what is showing, and only the pixel value is
 * measured. Deciding on the measurement instead would mean no offset wherever
 * offsetHeight reads 0 — which is every headless DOM, and so every test.
 */
function layoutStrip(table: HTMLElement, schedule: (fn: () => void) => void): void {
  if (!showing('dex-error') && !showing('dex-notice') && !showing('dex-warning')) {
    table.style.top = '';
    return;
  }
  const strip = document.getElementById('dex-banners');
  if (!strip) return;
  schedule(() => {
    table.style.top = strip.offsetHeight + 'px';
  });
}

export function renderBanners(
  table: HTMLElement,
  payload: BannerPayload,
  schedule: (fn: () => void) => void = (fn) => requestAnimationFrame(fn),
): void {
  // Both are painted unconditionally, so a repaint that no longer carries one
  // clears it: a dictionary the user just finished fixing stops warning.
  paintNotice(payload.notice);
  paintWarning(payload.warnings);
  layoutStrip(table, schedule);
}

/**
 * Paint the error banner, or clear it when passed nothing.
 *
 * The host's last word when a view cannot be shown at all — including the payload
 * it could not deliver (see src/host/postPayload.ts), which is the only message
 * that ends the table's loading spinner on that path. So it has to be legible:
 * the same strip, the same measured offset, above the table rather than beneath it.
 */
export function renderError(
  table: HTMLElement,
  message: string | undefined,
  schedule: (fn: () => void) => void = (fn) => requestAnimationFrame(fn),
): void {
  const el = document.getElementById('dex-error');
  if (el) {
    el.textContent = message ?? '';
    el.style.display = message ? 'block' : 'none';
  }
  layoutStrip(table, schedule);
}
