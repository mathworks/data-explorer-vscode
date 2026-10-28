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
 * nothing. Otherwise `typed` with each line break spelled as `held` spelled it, matched by the
 * lines around it rather than by its place in the list, so that a line added or removed in a text
 * mixing two kinds leaves every other break as it was: the lines `typed` begins with as `held`
 * does keep the breaks after them, and the lines it ends with as `held` does keep the breaks
 * before them. A break between edited lines is spelled as most of `held`'s are (the first such
 * kind, on a tie), and as LF, MATLAB's `newline`, where `held` has none.
 */
export function withHeldLineBreaks(typed: string, held: string): string {
  if (typed.replace(LINE_BREAK, '\n') === held.replace(LINE_BREAK, '\n')) return held;
  const heldLines = held.split(LINE_BREAK);
  const heldBreaks = held.match(LINE_BREAK) ?? [];
  const lines = typed.split(LINE_BREAK);
  const n = heldLines.length;
  const m = lines.length;
  let prefix = 0;
  while (prefix < Math.min(n, m) && lines[prefix] === heldLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(n, m) - prefix && lines[m - 1 - suffix] === heldLines[n - 1 - suffix]) suffix++;
  const usual = mostUsual(heldBreaks);
  let out = lines[0];
  for (let j = 0; j < m - 1; j++) {
    // The break after typed line j: held's after the same line where j is in the common start,
    // held's before the same line where j + 1 is in the common end, and the usual one elsewhere.
    let spelled = usual;
    if (j < prefix && j < heldBreaks.length) spelled = heldBreaks[j];
    else if (j + 1 >= m - suffix && j + 1 - (m - n) >= 1) spelled = heldBreaks[j + 1 - (m - n) - 1];
    out += spelled + lines[j + 1];
  }
  return out;
}

/** The kind of line break `breaks` holds most of, the first of them on a tie; LF for none. */
function mostUsual(breaks: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const b of breaks) counts.set(b, (counts.get(b) ?? 0) + 1);
  let best = '\n';
  let most = 0;
  for (const [b, count] of counts) {
    if (count > most) {
      best = b;
      most = count;
    }
  }
  return best;
}
