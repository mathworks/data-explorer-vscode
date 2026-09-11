// Copyright 2026 The MathWorks, Inc.
//
// What an entry looks like to a drop target: the payload-free facts dropDecision
// reasons over ("may a Simulink.Bus land in Design Data", "is this variable
// scalar-numeric enough to become a Constant").
//
// It is its own module because TWO registers can be pasted from — the drag register
// (dragState.ts) and the clipboard (clipboard.ts) — and `dropDecision.ts` states the
// invariant they must both satisfy: "drag-drop matches cut/copy-paste — if you can
// cut/copy you can drag, and if you can paste you can drop." These facts were
// computed inline inside buildDragSnapshot, so the clipboard growing its own copy
// would break that invariant quietly, in the direction the user notices least: a
// Paste offered in a place the host will refuse.
//
// Deliberately holds no payload. The webview needs these to predict a drop and must
// never be shipped the entry records — on a 47.8 MB dictionary that is the difference
// between a small message and a 67 MB one.

/** The payload-free facts a drop target judges an entry by. */
export interface DropFacts {
  className: string;
  arrayClass: string;
  kind: string;
  isMatlabVariable: boolean;
  /**
   * Whether the entry's value is scalar-numeric. Only meaningful for a MATLAB
   * variable; it is what decides whether the variable may CONVERT to a Constant when
   * it lands in Architectural Data (a Constant must be scalar-numeric).
   */
  isScalarNumeric: boolean;
}

/**
 * The drop facts of one live entry.
 *
 * Tolerates a null/degenerate node rather than throwing: callers reach here while
 * walking a multi-selection, where a row may resolve to a section header or to
 * nothing at all, and one such row must not abort the whole gesture.
 *
 * `serialized` lets a caller hand in the record it already has. Both registers keep the
 * payload alongside these facts, and `serialize()` deep-copies a whole subtree — doing
 * it twice per row would double the cost of a gesture the user waits on (dragstart on a
 * multi-selection of large buses).
 */
export function dropFactsOf(entry: any, serialized?: Record<string, unknown>): DropFacts {
  const value = (serialized ?? entry?.serialize?.())?.value as Record<string, unknown> | undefined;
  // An empty `_array_class` means "not an object array", i.e. a plain MATLAB
  // variable — the same falsy-is-absent rule the parser's envelope uses.
  const arrayClass = (value && typeof value === 'object' && (value._array_class as string)) || '';
  return {
    className: entry?.className ?? '',
    arrayClass,
    kind: entry?.kind ?? '',
    isMatlabVariable: !arrayClass,
    isScalarNumeric: entry?.isScalarNumeric === true,
  };
}
