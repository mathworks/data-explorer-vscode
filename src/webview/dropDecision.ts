// Copyright 2026 The MathWorks, Inc.
//
// dropDecision is the PURE predictor behind drag-and-drop feedback: given the
// dragged rows (source) and the section under the cursor (target), it returns
// whether a drop is allowed, which cursor to show, and the hover tooltip.
//
// It exists so the webview can render live drag feedback WITHOUT a round-trip to
// the host on every dragover. It must mirror the host exactly:
//   • accept/reject mirrors pasteEntry's allow-check — a payload's array-class
//     must be in the target section's allowed types (an empty array-class, i.e.
//     a plain MATLAB variable, is never rejected, just like pasteEntry).
//   • the tooltip's Kind labels mirror the Kind an entry shows AFTER the paste:
//     a pasted entry loses its SystemComposer classification (its new name isn't
//     in the catalog), so its Kind comes from class + the target's derived flag.
//     kindForClass with NO classification reproduces that post-paste Kind.
//
// The bottom line it enforces: drag-drop matches cut/copy-paste — if you can
// cut/copy you can drag, and if you can paste you can drop.
import { kindForClass } from '../dex/datamodel/kindMap.js';

export type DragMode = 'copy' | 'move';
export type DropCursor = 'copy' | 'move' | 'no-drop';

// One dragged row, as the webview knows it (no live model). `arrayClass` is the
// serialized entry's _array_class ('' for a MATLAB variable); `className` is the
// raw class shown in the Class column; `kind` is the Kind currently displayed.
export interface DragItem {
  className: string;
  arrayClass: string;
  kind: string;
  isMatlabVariable: boolean;
}

export interface DragSource {
  docUri: string;
  sectionName: string;
  sectionLabel: string;
  isDerived: boolean;
  items: DragItem[];
}

export interface DropTarget {
  docUri: string;
  sectionName: string;
  sectionLabel: string;
  isDerived: boolean;
  allowedTypes: string[];
}

export interface DropDecision {
  canDrop: boolean;
  cursor: DropCursor;
  tooltip: string;
  noop: boolean;
}

// Mirror SectionNode.allowsType: an empty array-class (MATLAB variable) is
// always accepted; otherwise the class must be in the allow-list. An empty
// allow-list means "no restriction".
function targetAllows(target: DropTarget, item: DragItem): boolean {
  if (!item.arrayClass) return true;
  if (target.allowedTypes.length === 0) return true;
  return target.allowedTypes.indexOf(item.arrayClass) !== -1;
}

// The Kind an item WILL show once dropped into `target`: class + the target's
// derived flag, with NO classification (a pasted entry's new name isn't in the
// SystemComposer catalog, so it never keeps a classification-derived Kind).
function kindInTarget(item: DragItem, target: DropTarget): string {
  return kindForClass(item.className, {
    isDerived: target.isDerived,
    isMatlabVariable: item.isMatlabVariable,
  });
}

function reject(tooltip: string): DropDecision {
  return { canDrop: false, cursor: 'no-drop', tooltip, noop: false };
}

export function dropDecision(source: DragSource, target: DropTarget, mode: DragMode): DropDecision {
  const items = source.items ?? [];
  if (items.length === 0) return reject('Nothing to drop');

  // Same document + same section + move = reorder within one section, which we
  // treat as a no-op (a move here would delete and re-add the same entry). A
  // COPY into the same section is a genuine duplicate, so it is allowed.
  const sameSection = source.docUri === target.docUri && source.sectionName === target.sectionName;
  if (sameSection && mode === 'move') {
    return { canDrop: false, cursor: 'no-drop', tooltip: '', noop: true };
  }

  // Any single rejected item rejects the whole drop (mirrors a multi-select
  // paste, which is all-or-nothing).
  const rejected = items.find((it) => !targetAllows(target, it));
  if (rejected) {
    return reject(`${rejected.kind} cannot be in ${target.sectionLabel}`);
  }

  const cursor: DropCursor = mode === 'copy' ? 'copy' : 'move';
  return { canDrop: true, cursor, tooltip: dropTooltip(items, target, mode), noop: false };
}

// The hover label for an allowed drop. The verb reflects the LIVE drag mode —
// "Copy" while Ctrl/Cmd is held, "Move" otherwise — so it matches the action the
// drop will actually perform. Single item: name the Kind and, when the drop
// changes it (design↔arch), phrase it as a conversion. Multiple items: a count
// label, still distinguishing a same-Kind move/copy from a conversion.
function dropTooltip(items: DragItem[], target: DropTarget, mode: DragMode): string {
  const verb = mode === 'copy' ? 'Copy' : 'Move';
  if (items.length === 1) {
    const it = items[0];
    const from = it.kind;
    const to = kindInTarget(it, target);
    return from === to ? `${verb} ${from}` : `Convert ${from} to ${to}`;
  }
  const converts = items.some((it) => it.kind !== kindInTarget(it, target));
  if (converts) return `Convert ${items.length} items to ${target.sectionLabel}`;
  return `${verb} ${items.length} items`;
}
