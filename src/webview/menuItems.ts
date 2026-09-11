// Copyright 2026 The MathWorks, Inc.
import type { ContextMenuItem } from './components/dex-context-menu.js';
import { rejectReason, type DragItem, type DropTarget } from './dropDecision.js';
import { resolveOperands, type OperandRow } from './operands.js';

// The subset of row data the menu builder needs. The host attaches the capability
// flags in rowBuilder.buildEntryRows; section rows lack them (all falsy), and are
// dropped during operand resolution rather than shown a menu of dead items.
export interface MenuRow extends OperandRow {
  /** The Name cell, whose `label` is the display name a label quotes. */
  Name?: { label?: string } | string;
}

export interface ClipboardState {
  canPaste: boolean;
  mode: 'cut' | 'copy' | null;
  /**
   * What the clipboard holds, payload-free — the same facts dragDescriptor() posts.
   *
   * Here so the menu can run the target's allow-check itself. Without it Paste was
   * enabled on any non-empty clipboard and the host errored at paste time; with it,
   * the menu and a dragover answer "can this land here" from one function.
   */
  items: DragItem[];
}

/** The section a paste would land in — a DropTarget minus the parts paste cannot use. */
export type PasteTarget = Pick<DropTarget, 'sectionLabel' | 'isDerived' | 'allowedTypes'>;

/**
 * Everything the menu is built from. A bag rather than positional arguments because
 * seven of them read as noise at the call site, and because both triggers (right-click
 * and keyboard) have to pass the same thing.
 */
export interface MenuInput {
  /** Every row the table holds — operand resolution walks `parent` through them. */
  rows: readonly MenuRow[];
  selectedRowIds: readonly string[];
  /** The right-clicked row (menu) or last-clicked row (keyboard); the paste target. */
  anchorRowId: string | null;
  clipboard: ClipboardState;
  editable: boolean;
  hasTextView: boolean;
  /** The anchor's section rule, or null when it cannot be resolved. */
  pasteTarget: PasteTarget | null;
}

// A display name short enough to keep the menu narrow. The whole name goes in the
// item's `title`, which is reachable because an item that names an operand is enabled.
const NAME_MAX = 24;
function shortName(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

function displayName(row: MenuRow | undefined): string {
  const name = typeof row?.Name === 'object' ? row.Name?.label : row?.Name;
  return typeof name === 'string' && name ? name : (row?.ID ?? '');
}

/**
 * `Verb "A"` for one operand, `Verb N Things` for more.
 *
 * Copy/Cut count ENTRIES and Delete counts ITEMS, and for the same selection those
 * counts legitimately differ — copying a child copies its whole entry while deleting
 * it deletes only the child. Saying both numbers is how the seam becomes visible
 * instead of surprising.
 */
function operandLabel(verb: string, plural: string, names: string[]): { label: string; title?: string } {
  if (names.length === 1) {
    return { label: `${verb} "${shortName(names[0])}"`, title: names[0] };
  }
  return { label: `${verb} ${names.length} ${plural}` };
}

const MOD = navigatorIsMac() ? '⌘' : 'Ctrl+';
const SHIFT = navigatorIsMac() ? '⇧' : 'Shift+';

function navigatorIsMac(): boolean {
  // PRECONDITION (untested) for this first guard only: the webview always has a
  // `navigator`. It exists because the module is also imported by node-side unit
  // tests, where Node < 21 had no global navigator — deleting it would break them
  // on an LTS downgrade. The platform test below IS live per call (see the Delete
  // label in buildContextMenuItems) and is covered for both platforms.
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

// Map a keydown to the context-menu action it should trigger, or null if the
// chord isn't a recognized shortcut. Mirrors the shortcuts the menu advertises:
//   Cmd/Ctrl+C -> copy, Cmd/Ctrl+X -> cut, Cmd/Ctrl+V -> paste (no Shift/Alt),
//   Delete / Backspace -> delete (no modifier). This ONLY classifies the gesture:
//   the caller enables it by building the menu for the current selection and reading
//   the matching item, so a chord and its menu item cannot disagree. Pure, so it's
//   unit-testable without a DOM.
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
// otherwise). Read-only documents — .mat/.slx/.prj, and a JSON .sldd too large
// for VS Code to mirror as a TextDocument — have no write-back path, so both
// interactions below are suppressed. Per-row coloring must stay intact, so we
// never touch the row-level flags.
//
// BOTH .sldd formats are editable and send `editable: true`: JSON via the
// text-backed provider, compressed-binary via its own writable custom editor.
// What separates them is `hasTextView`, not editability.

/**
 * Whether a right-click should open the context menu at all. Read-only
 * documents get NO menu — the read-only byte-backed view has no copy/paste/
 * mutation handlers, so an all-disabled menu would be dead UI.
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
 * Build the right-click context menu for the CURRENT SELECTION.
 *
 * Pure and synchronous: enablement comes from the host-computed row flags, the cached
 * clipboard state, the target section's rules, and whether the document is editable —
 * no round-trip. Two things it deliberately does NOT decide: which rows are operands
 * (resolveOperands does, so the keyboard cannot diverge) and whether a payload may land
 * in a section (dropDecision.rejectReason does, so a Paste offered here is a drop the
 * hover feedback would allow).
 *
 * GROUPS, THEN JOIN. The items are built as groups and the separators are put between
 * whatever groups survive. A section header's menu — Paste, then Undo/Redo — then falls
 * out of dropping the two empty groups, with no case of its own; so does the binary
 * format's missing "Location in Text". Managing separators by hand is how a menu ends
 * up with two in a row or one at the bottom, and that is exactly what this shape makes
 * impossible.
 */
export function buildContextMenuItems(input: MenuInput): ContextMenuItem[] {
  const { rows, selectedRowIds, clipboard, editable, hasTextView, pasteTarget } = input;
  const byId = new Map(rows.map((r) => [r.ID, r]));
  const ops = resolveOperands(selectedRowIds, rows);
  const entryNames = ops.entryIds.map((id) => displayName(byId.get(id)));
  const deleteNames = ops.deleteIds.map((id) => displayName(byId.get(id)));
  const n = ops.deleteIds.length;

  // --- Paste, the one item on every menu ------------------------------------------
  // Its target is the anchor's section, which is why it survives on a header: a header
  // is the only target an empty section has.
  const pasteItem = (): ContextMenuItem => {
    const count = clipboard.items.length;
    const label = count > 1 ? `Paste ${count} Entries` : 'Paste';
    const base = { id: 'paste', label, icon: 'paste', shortcut: `${MOD}V` };
    if (!editable) return { ...base, disabled: true };
    if (!clipboard.canPaste || count === 0) {
      return { ...base, disabled: true, reason: 'Nothing to paste' };
    }
    // More than one section among the operands and the target would be a guess. The
    // anchor cannot resolve it: the ambiguity is in what the user selected.
    if (ops.sections.length > 1) {
      return { ...base, disabled: true, reason: 'Select rows in one section to paste' };
    }
    if (!pasteTarget) return { ...base, disabled: true };
    for (const item of clipboard.items) {
      const reason = rejectReason({ docUri: '', sectionName: '', ...pasteTarget }, item);
      if (reason) return { ...base, disabled: true, reason };
    }
    return base;
  };

  const undoRedo: ContextMenuItem[] = [
    { id: 'undo', label: 'Undo', shortcut: `${MOD}Z`, disabled: !editable },
    { id: 'redo', label: 'Redo', shortcut: `${SHIFT}${MOD}Z`, disabled: !editable },
  ];

  // A selection with no data-row operands is a header selection (or nothing at all).
  // Row actions are OMITTED rather than disabled: a section can never be copied, so a
  // reason there would name nothing the user could change. See the spec's §4.3.
  if (n === 0) return joinGroups([[pasteItem()], undoRedo]);

  // --- The row actions -------------------------------------------------------------
  const entryRows = ops.entryIds.map((id) => byId.get(id));
  const undeletableEntry = ops.entryIds.find((id) => !byId.get(id)?._canDelete);
  const undeletableRow = ops.deleteIds.find((id) => !byId.get(id)?._canDelete);
  const soleRow = n === 1 ? byId.get(ops.deleteIds[0]) : undefined;

  const copy: ContextMenuItem = {
    id: 'copy',
    icon: 'copy',
    shortcut: `${MOD}C`,
    disabled: !entryRows.every((r) => !!r?._canCopy),
    ...operandLabel('Copy', 'Entries', entryNames),
  };

  // Cut reads the ENTRY's flag, not the clicked row's: it is a copy plus a deferred
  // delete of the entry it copied, so "may this child leave its container" is a
  // different question and answering Cut with it would wrongly disable Cut "A" for a
  // struct-array field. Delete below is the item that correctly reads the row's flag.
  const cut: ContextMenuItem = {
    id: 'cut',
    icon: 'cut',
    shortcut: `${MOD}X`,
    disabled: !editable || !!undeletableEntry,
    ...operandLabel('Cut', 'Entries', entryNames),
    ...(undeletableEntry
      ? { reason: `"${shortName(displayName(byId.get(undeletableEntry)))}" can't be cut` }
      : {}),
  };

  const addChild: ContextMenuItem = {
    id: 'addChild',
    label: 'Add Child',
    icon: 'addChild',
    disabled: !editable || n > 1 || !soleRow?._canAddChild,
    ...(n > 1 ? { reason: 'Select a single item to add a child' } : {}),
  };

  const del: ContextMenuItem = {
    id: 'delete',
    icon: 'delete',
    shortcut: navigatorIsMac() ? '⌫' : 'Del',
    disabled: !editable || !!undeletableRow,
    ...operandLabel('Delete', 'Items', deleteNames),
    ...(undeletableRow ? { reason: "This element can't be removed from its parent" } : {}),
  };

  // "Location in Text" reveals the row in the plain-text view. A compressed-binary
  // .sldd has no such view, so the item is omitted there rather than shown as
  // permanently dead UI — and, now that groups are joined, its separator goes with it
  // for free.
  const locate: ContextMenuItem[] = hasTextView
    ? [
        {
          id: 'locateInText',
          label: 'Location in Text',
          icon: 'locate',
          shortcut: `${MOD}L`,
          disabled: n > 1,
          ...(n > 1 ? { reason: 'Select a single item to locate it in the text' } : {}),
        },
      ]
    : [];

  return joinGroups([[copy, cut, pasteItem()], [addChild, del], locate, undoRedo]);
}

// One separator between the groups that have anything in them — never a leading, a
// trailing, or a doubled one. The whole reason the builder returns groups.
function joinGroups(groups: ContextMenuItem[][]): ContextMenuItem[] {
  const kept = groups.filter((g) => g.length > 0);
  const out: ContextMenuItem[] = [];
  kept.forEach((group, i) => {
    if (i > 0) out.push({ id: `_sep${i}`, label: '', separator: true });
    out.push(...group);
  });
  return out;
}
