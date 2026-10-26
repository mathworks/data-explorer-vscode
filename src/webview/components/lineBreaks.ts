// Copyright 2026 The MathWorks, Inc.
// The line breaks of a text edited in the table's <textarea>, kept as the cell held them.
//
// Two things in the browser change line breaks behind the user's back, and either one turned an
// untouched editor into an edit. An <input> drops every line break from the value it is given,
// so a two-line Description opened in one and clicked away from was written back as one line:
// which is why a text holding a line break is edited in a textarea (dex-tree-table's
// `_onCellDblClick`). And a textarea reads every line break it holds back as LF — HTML normalizes
// a CRLF pair and a lone CR in `.value` — so a Description held with CRLF breaks would read back
// different from what it was seeded with, and the difference would be posted as an edit the
// user never made. So a textarea's commit is posted through `withHeldLineBreaks`.

const LINE_BREAK = /\r\n|\r|\n/g;

/** Whether `text` holds a line break of any kind (LF, CRLF or a lone CR). */
export function hasLineBreak(text: string): boolean {
  return /[\r\n]/.test(text);
}

/**
 * What to post for `typed`, read back from a textarea seeded with `held`. `held` itself where the
 * two differ only in how their line breaks are spelled: nothing was edited, so the caller posts
 * nothing. Otherwise `typed` with each line break spelled as the one `held` had at the same place
 * (its i-th as `held`'s i-th; past the last of them, as the last), and as LF, MATLAB's `newline`,
 * where `held` had none.
 */
export function withHeldLineBreaks(typed: string, held: string): string {
  if (typed.replace(LINE_BREAK, '\n') === held.replace(LINE_BREAK, '\n')) return held;
  const breaks = held.match(LINE_BREAK) ?? ['\n'];
  let i = 0;
  return typed.replace(LINE_BREAK, () => breaks[Math.min(i++, breaks.length - 1)]);
}
