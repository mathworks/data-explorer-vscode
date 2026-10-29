// Copyright 2026 The MathWorks, Inc.
//
// WHEN A JSON .sldd's WIDE REPAINT MAY LAND.
//
// A wide repaint reads the document, parses it, registers the tree, builds every row — and then
// WAITS, for the workspace usage graph that fills the Usage column, before it posts a byte. Warm,
// that wait is a few microtasks. Cold, it is a scan of the workspace: ~5.8 s over a folder of
// real dictionaries (measured; 4 files, 98 MB). Anything can happen to the document in that
// window, and the rows the repaint is holding say nothing about any of it.
//
// It used to say the rows were in step with the text the moment it had parsed, which is the one
// fact the narrow repaints are all built on (the provider's `modelInSync`). So an edit made in the
// window took the narrow path and painted, and the rows that landed after it were the rows from
// before it — the edit gone from the screen, and every later narrow repaint splicing into a table
// the text did not describe. And two wide repaints in flight at once landed in whatever order
// their waits ended, so the older text could be the one left on screen.
//
// So the rows are only posted if they are still the answer, which three facts decide, all of
// them read once when the repaint began and once when its rows are ready:
//
//   - it is still the NEWEST repaint: a later one read later text, and lands for both;
//   - the text has not changed since it was read (the document version);
//   - the view has not touched its rows or its tree since: no narrow repaint, nothing declared
//     out of step. An edit made in the window paints before it writes, so for the length of its
//     write the text still reads as it did — and these rows would take that paint back off the
//     screen. Counted per VIEW: two tabs of one document share the session's tree, so a test
//     of "is the registered tree still the one I built" is failed by the other tab's repaint,
//     and the two re-read each other for ever.
//
// A repaint that is not the newest is dropped; one whose text or rows moved under it reads the
// document again. Either way what lands is built from the text as it stands, which is the only
// thing a wide repaint is for. Kept VS-Code-free so the rule is testable without a window.

/** What a wide repaint read when it began, or what the view says when its rows are ready. */
export interface WideState {
  /** The view's count of wide repaints begun (SlddTextEditorProvider's `wideEpoch`). */
  epoch: number;
  /** The document's version. */
  version: number;
  /** The view's count of narrow repaints and out-of-step declarations (`rowsTouched`). */
  touched: number;
}

/**
 * What to do with a wide repaint's rows once they are built.
 *
 *   'land'        post them: nothing has happened since they were read;
 *   'superseded'  drop them: a newer repaint has begun, and its rows land instead;
 *   'reread'      read the document again: the text, or the view's rows, moved under them.
 */
export type WideLanding = 'land' | 'superseded' | 'reread';

export function wideLanding(read: WideState, now: WideState): WideLanding {
  if (read.epoch !== now.epoch) return 'superseded';
  if (read.version !== now.version || read.touched !== now.touched) return 'reread';
  return 'land';
}
