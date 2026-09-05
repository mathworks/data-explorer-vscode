// Copyright 2026 The MathWorks, Inc.
// Paints the banner strip above the table: the persistent read-only notice and
// the parse-warning banner (see BANNERS_HTML in src/host/webviewHtml.ts for the
// markup all four table shells declare).
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
// message wraps at narrow widths, and both banners can be showing at once. The
// measurement is deferred through `schedule` so it happens after layout; tests
// pass a synchronous scheduler because happy-dom reports every height as 0.
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

export function renderBanners(
  table: HTMLElement,
  payload: BannerPayload,
  schedule: (fn: () => void) => void = (fn) => requestAnimationFrame(fn),
): void {
  // Both are painted unconditionally, so a repaint that no longer carries one
  // clears it: a dictionary the user just finished fixing stops warning.
  const hasNotice = paintNotice(payload.notice);
  const hasWarning = paintWarning(payload.warnings);
  if (!hasNotice && !hasWarning) {
    table.style.top = '';
    return;
  }
  const strip = document.getElementById('dex-banners');
  if (!strip) return;
  schedule(() => {
    table.style.top = strip.offsetHeight + 'px';
  });
}
