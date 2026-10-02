// Copyright 2026 The MathWorks, Inc.
//
// The ceiling on how many rows one table payload may carry, and the sentence that
// says a payload hit it.
//
// WHY THERE HAS TO BE ONE. A table payload crosses to the webview through
// `webview.postMessage`, which VS Code serializes with `JSON.stringify` — so the
// payload's hard limit is not the renderer's patience, it is V8's maximum string
// length (~512 MiB). Past that `JSON.stringify` throws `RangeError: Invalid string
// length`, and because `postMessage` is `async` the throw arrives as a REJECTED
// PROMISE, which no `try/catch` around the post can see. The view is left on its
// loading spinner for ever, because the message that would have ended the wait is
// the one that failed. Measured on an 8 MB `.mat` holding a struct array of MIDI
// events: 2,016,325 rows, 704 MiB of JSON, three attempts and three spinners.
//
// So the cap is not a performance tuning knob. It is what keeps the payload
// serializable at all, and it belongs in front of every row payload rather than in
// the one builder that happened to overflow first — `buildRows` is as unbounded as
// `buildMatRows`, it has just never been handed a file that proved it.
//
// Kept vscode-free so the rule is unit-testable; the providers own the postMessage.
import type { WarningBanner } from './parseWarnings.js';

/**
 * The most rows one payload may carry.
 *
 * Chosen for the WORST row shape rather than the measured one. Rows from the file
 * above average 366 bytes of JSON, which would allow ~1.4M of them under V8's
 * limit; but a row's size is the data's, not the format's — a long name, a wide
 * value, a usage cell naming a dozen blocks — and a 10x heavier row is ordinary. At
 * 100,000 even that row shape lands near 360 MiB, inside the limit; at 200,000 it
 * does not. The measured cost at this cap is 34.5 MiB and 58 ms to serialize, which
 * is a wait, not a hang.
 *
 * It is deliberately far above any table a person reads top to bottom. Anything
 * near it is a file being browsed with the search box, and the rows past it were
 * never going to be scrolled to.
 */
export const MAX_TABLE_ROWS = 100_000;

/** Rows for one payload, and how many the builder actually produced. */
export interface CappedRows {
  /** At most `max` rows, in builder order. */
  rows: any[];
  /** The pre-cap count. Equal to `rows.length` when nothing was dropped. */
  total: number;
}

/**
 * The first `max` rows, and the count there would have been.
 *
 * Truncating the TAIL rather than sampling is what keeps the tree walkable: every
 * builder here emits a parent before its children (a depth-first pre-order walk of
 * the node tree), so a prefix of the rows is a set in which every row's parent is
 * also present. The webview builds its tree from each row's `parent` id, so a cut
 * anywhere else would leave rows whose parent never arrived — orphans it cannot
 * place, under a twisty that opens onto nothing.
 *
 * A cut subtree does leave a parent row showing fewer children than it has. That is
 * what the banner is for: an incomplete table that says so beats a complete one
 * that never loads, and both beat the spinner.
 */
export function capRows(rows: any[], max: number = MAX_TABLE_ROWS): CappedRows {
  if (rows.length <= max) {
    return { rows, total: rows.length };
  }
  return { rows: rows.slice(0, max), total: rows.length };
}

/**
 * The banner for a capped payload, folding in whatever the parse already had to say.
 *
 * The cap takes the HEADLINE when it fires, and core's own headline moves down into
 * the details. Both are true, but they are not equally large: a parse that lost one
 * part of a file describes a gap in the table, while a cap describes where the table
 * stops. Which rows are missing is the one thing the user cannot work out from the
 * rows in front of them, so it is the line that goes first.
 *
 * The sentence does NOT suggest searching for a row past the cap. The search box
 * filters the payload, and the dropped rows are not in it — advice that cannot work
 * is worse than none, because it reads as the table being broken rather than short.
 *
 * `undefined` in and nothing dropped gives `undefined` out — the payload carries no
 * banner and the strip clears, exactly as before this existed.
 */
export function rowCapBanner(capped: CappedRows, parse: WarningBanner | undefined): WarningBanner | undefined {
  const dropped = capped.total - capped.rows.length;
  if (dropped <= 0) {
    return parse;
  }
  const shown = capped.rows.length.toLocaleString('en-US');
  const total = capped.total.toLocaleString('en-US');
  return {
    headline:
      `This file has more rows than one table can show: these are the first ${shown} of ${total}, ` +
      'and the rest are not in this view.',
    details: parse ? [parse.headline, ...parse.details] : [],
  };
}
