// Copyright 2026 The MathWorks, Inc.
//
// Which rows of a document carry the clipboard's mark, and which of them a clipboard broadcast
// moves — said once for every editable table.
//
// A cut or a copy makes no document edit, yet its source rows must gain the cut (dimmed) or
// copied (dashed) affordance, and lose it when the clipboard moves on. So every open table is
// asked to repaint on every clipboard broadcast (editorHub), and each repaints only the entries
// the mark it last painted and the mark the clipboard holds now name between them; a broadcast
// that changes neither — the usual case, the mark belonging to another document — costs it
// nothing. The JSON and binary dictionary views each spelled that out in full, and the MAT-file
// view would have been a third copy: the recurring "one rule, several paths" defect in the shape
// where a drifted copy shows as an affordance that appears in one format and not another. Each
// view keeps only what is its own: how to find an entry by (section, name), and what a repaint
// of it is.
//
// Kept vscode-free, so it is unit-testable with the real clipboard (test/clipMarks.test.ts).
import { getClipboard } from './clipboard.js';
import { clipMarkKey, splitClipMarkKey, type ClipMark } from '../view/model/rows/rowStamp.js';

/**
 * The mark the rows of `docUri` should carry: every entry the clipboard holds from that
 * document, each keyed by its OWN source section (a multi-row cut can span sections, so one
 * shared section would dim the wrong rows; a MAT-file's variables carry '', its one section).
 * Undefined when the clipboard is empty or its entries came from another document.
 *
 * A view asks it for its whole paint and for every entry-scoped repaint alike, so a cut
 * affordance renders the same way whichever one painted it: one that appeared or vanished
 * depending on which repaint the user happened to trigger would be a bug visible only after an
 * edit.
 */
export function clipMarkOfDoc(docUri: string): ClipMark | undefined {
  const clip = getClipboard();
  if (!clip || clip.sourceDocUri !== docUri) return undefined;
  const keys = new Set<string>();
  for (const it of clip.items) {
    const name = it.payload.name;
    if (typeof name === 'string' && name) keys.add(clipMarkKey(it.sourceSection, name));
  }
  return keys.size ? { keys, mode: clip.mode } : undefined;
}

// Order-independent: the same entries marked in a different order is the SAME mark, and
// repainting for it would be a repaint the user's rows do not need.
function markKey(mark?: ClipMark): string {
  return mark ? JSON.stringify([mark.mode, [...mark.keys].sort()]) : '';
}

/** Whether two marks dim and dash exactly the same entries the same way. */
export function sameClipMark(a: ClipMark | undefined, b: ClipMark | undefined): boolean {
  return markKey(a) === markKey(b);
}

/** One entry a mark names: the half-keys of rowStamp's clipMarkKey. */
export interface MarkedEntry {
  section: string;
  name: string;
}

/**
 * The entries whose rows a move from the `painted` mark to the `next` one repaints, or null
 * when the two are the same mark and nothing need be repainted.
 *
 * Every entry either mark names: the ones losing the affordance and the ones gaining it. A key
 * in both is listed once, as is an entry a copy re-takes as a cut. An entry that is no longer in
 * the document is the caller's to skip: its rows are already gone (a cut+paste moves the very
 * entry that held the mark), so there is nothing left to un-dim.
 */
export function clipMarkChange(painted: ClipMark | undefined, next: ClipMark | undefined): MarkedEntry[] | null {
  if (sameClipMark(painted, next)) return null;
  const keys = new Set<string>([...(painted?.keys ?? []), ...(next?.keys ?? [])]);
  return [...keys].map(splitClipMarkKey);
}
