// Copyright 2026 The MathWorks, Inc.
import type { ContextMenuItem } from '../dex/components/dex-context-menu.js';

// The subset of row data the menu builder needs. The host attaches these
// capability flags in rowBuilder.buildEntryRows; section rows lack them (all
// falsy), which correctly disables mutating actions on a section header.
export interface MenuRow {
  ID: string;
  _isEntry?: boolean;
  _canCopy?: boolean;
  _canDelete?: boolean;
  _canAddChild?: boolean;
}

export interface ClipboardState {
  canPaste: boolean;
  mode: 'cut' | 'copy' | null;
}

const MOD = navigatorIsMac() ? '⌘' : 'Ctrl+';
const SHIFT = navigatorIsMac() ? '⇧' : 'Shift+';

function navigatorIsMac(): boolean {
  // Guarded for the node test env where navigator is absent.
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

// Map a keydown to the context-menu action it should trigger, or null if the
// chord isn't a recognized shortcut. Mirrors the shortcuts the menu advertises:
//   Cmd/Ctrl+C -> copy, Cmd/Ctrl+X -> cut, Cmd/Ctrl+V -> paste (no Shift/Alt),
//   Delete / Backspace -> delete (no modifier). Enablement (editable, clipboard
//   state, per-row flags) is enforced by the caller before dispatch — this only
//   classifies the gesture. Pure, so it's unit-testable without a DOM.
export type ShortcutAction = 'copy' | 'cut' | 'paste' | 'delete';
export function resolveShortcutAction(e: KeyboardEvent): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey) {
    switch (e.key.toLowerCase()) {
      case 'c':
        return 'copy';
      case 'x':
        return 'cut';
      case 'v':
        return 'paste';
    }
  }
  // A bare Delete/Backspace deletes the row; a modified one is a text gesture.
  if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.shiftKey && !e.altKey) {
    return 'delete';
  }
  return null;
}

// Document-level (table) readonly controls the editor and the context menu.
// It is DISTINCT from the row-level `Name.editable` flag, which only controls
// cell text color (gray for derived array-child names like `Var(1)`, normal
// otherwise). Read-only documents (.mat/.slx/.prj, binary/zip .sldd) have no
// write-back path, so both interactions below are suppressed — but per-row
// coloring must stay intact, so we never touch the row-level flags.

/**
 * Whether a right-click should open the context menu at all. Read-only
 * documents get NO menu — the binary view has no copy/paste/mutation handlers,
 * so an all-disabled menu would be dead UI. Only editable JSON .sldd shows one.
 */
export function shouldShowContextMenu(editable: boolean): boolean {
  return editable;
}

/**
 * Whether a double-click / Enter should open the inline cell editor. Gated on
 * the document-level flag only: read-only documents never open the editor,
 * regardless of any per-row `editable` flag (which is a coloring signal).
 */
export function shouldOpenCellEditor(editable: boolean): boolean {
  return editable;
}

/**
 * Build the right-click context-menu items for a row. Pure and synchronous:
 * enablement comes entirely from the host-computed row flags, the cached
 * clipboard state, and whether the document is editable — no round-trip.
 *
 * Only ever called for editable documents (shouldShowContextMenu gates the
 * call site); the `editable` guards below are kept as defensive belt-and-
 * suspenders.
 */

export function buildContextMenuItems(
  row: MenuRow | null,
  clipboard: ClipboardState,
  editable: boolean,
  hasTextView: boolean,
): ContextMenuItem[] {
  const canCopy = !!row?._canCopy;
  const canDelete = editable && !!row?._canDelete;
  const canAddChild = editable && !!row?._canAddChild;
  const canPaste = editable && clipboard.canPaste;
  // Any data row resolves to an owning top-level entry whose JSON span we can
  // locate; section headers carry no capability flags, so `_canCopy` (set on
  // every data row) cleanly gates the action off for them.
  const canLocate = !!row?._canCopy;

  return [
    { id: 'copy', label: 'Copy', icon: 'copy', shortcut: `${MOD}C`, disabled: !canCopy },
    { id: 'cut', label: 'Cut', icon: 'cut', shortcut: `${MOD}X`, disabled: !canDelete },
    { id: 'paste', label: 'Paste', icon: 'paste', shortcut: `${MOD}V`, disabled: !canPaste },
    { id: '_sep1', label: '', separator: true },
    { id: 'addChild', label: 'Add Child', icon: 'addChild', disabled: !canAddChild },
    { id: 'delete', label: 'Delete', icon: 'delete', shortcut: navigatorIsMac() ? '⌫' : 'Del', disabled: !canDelete },
    // "Location in Text" reveals the row in the plain-text view. A compressed-
    // binary .sldd has no such view, so the action is omitted there (with its
    // trailing separator) rather than shown as permanently dead UI.
    ...(hasTextView
      ? ([
          { id: '_sep2', label: '', separator: true },
          { id: 'locateInText', label: 'Location in Text', icon: 'locate', shortcut: `${MOD}L`, disabled: !canLocate },
        ] as ContextMenuItem[])
      : []),
    { id: '_sep3', label: '', separator: true },
    { id: 'undo', label: 'Undo', shortcut: `${MOD}Z`, disabled: !editable },
    { id: 'redo', label: 'Redo', shortcut: `${SHIFT}${MOD}Z`, disabled: !editable },
  ];
}
