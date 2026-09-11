// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect, afterEach } from 'vitest';
import { buildContextMenuItems, shouldShowContextMenu, shouldOpenCellEditor, resolveShortcutAction, type MenuRow, type ClipboardState, type MenuInput, type PasteTarget } from '../src/webview/menuItems.js';
import type { ContextMenuItem } from '../src/webview/components/dex-context-menu.js';

// The rows a menu is built over: one section holding an entry A with a child x, plus a
// second entry B, plus a second section holding V. Enough to state every shape the spec
// distinguishes — entry, child, mixed, cross-section, section-only.
const ROWS: MenuRow[] = [
  { ID: 'section:design', Name: { label: 'Design Data' } },
  { ID: 'u/design/A', parent: 'section:design', Name: { label: 'A' }, _canCopy: true, _canDelete: true, _canAddChild: true },
  { ID: 'u/design/A/x', parent: 'u/design/A', Name: { label: 'x' }, _canCopy: true, _canDelete: true },
  { ID: 'u/design/B', parent: 'section:design', Name: { label: 'B' }, _canCopy: true, _canDelete: true },
  { ID: 'section:arch', Name: { label: 'Architectural Data' } },
  { ID: 'u/arch/V', parent: 'section:arch', Name: { label: 'V' }, _canCopy: true, _canDelete: true },
];

const DESIGN: PasteTarget = { sectionLabel: 'Design Data', isDerived: false, allowedTypes: [] };
const EMPTY_CLIP: ClipboardState = { canPaste: false, mode: null, items: [] };
const BUS_CLIP: ClipboardState = {
  canPaste: true,
  mode: 'copy',
  items: [{ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind: 'Bus', isMatlabVariable: false, isScalarNumeric: false }],
};

function menu(over: Partial<MenuInput> = {}): ContextMenuItem[] {
  return buildContextMenuItems({
    rows: ROWS,
    selectedRowIds: ['u/design/A'],
    anchorRowId: 'u/design/A',
    clipboard: EMPTY_CLIP,
    editable: true,
    hasTextView: true,
    pasteTarget: DESIGN,
    ...over,
  });
}

const byId = (items: ContextMenuItem[], id: string) => items.find((i) => i.id === id);
const labels = (items: ContextMenuItem[]) => items.filter((i) => !i.separator).map((i) => i.label);

describe('labels name the operand', () => {
  it('names the entry on an entry row', () => {
    const items = menu();
    expect(byId(items, 'copy')!.label).toBe('Copy "A"');
    expect(byId(items, 'delete')!.label).toBe('Delete "A"');
  });

  it('names the OWNING ENTRY for copy and the CHILD for delete, on one menu', () => {
    // The seam the whole design is about: copy needs a destination so it stays
    // entry-granular; delete has none so it acts on the row. Both true at once, and
    // both said out loud.
    const items = menu({ selectedRowIds: ['u/design/A/x'], anchorRowId: 'u/design/A/x' });
    expect(byId(items, 'copy')!.label).toBe('Copy "A"');
    expect(byId(items, 'cut')!.label).toBe('Cut "A"');
    expect(byId(items, 'delete')!.label).toBe('Delete "x"');
  });

  it('counts entries for copy and ITEMS for delete, which can differ', () => {
    // A and A/x and B: two entry operands (A, B — x subsumed into A), but A/x is
    // subsumed for delete too, so two items. Selecting A/x and B instead gives one
    // entry pair and two delete items — that difference is the seam reported honestly.
    expect(byId(menu({ selectedRowIds: ['u/design/A', 'u/design/A/x', 'u/design/B'] }), 'copy')!.label)
      .toBe('Copy 2 Entries');
    const mixed = menu({ selectedRowIds: ['u/design/A/x', 'u/design/B'] });
    expect(byId(mixed, 'copy')!.label).toBe('Copy 2 Entries');
    expect(byId(mixed, 'delete')!.label).toBe('Delete 2 Items');
  });

  it('truncates a long name and keeps the whole of it in the title', () => {
    const long = 'AnExtremelyLongEntryNameThatWouldStretchTheMenu';
    const rows: MenuRow[] = [
      { ID: 'section:design', Name: { label: 'Design Data' } },
      { ID: `u/design/${long}`, parent: 'section:design', Name: { label: long }, _canCopy: true, _canDelete: true },
    ];
    const items = buildContextMenuItems({
      rows,
      selectedRowIds: [`u/design/${long}`],
      anchorRowId: `u/design/${long}`,
      clipboard: EMPTY_CLIP,
      editable: true,
      hasTextView: true,
      pasteTarget: DESIGN,
    });
    const copy = byId(items, 'copy')!;
    expect(copy.label.length).toBeLessThan(long.length + 8);
    expect(copy.label).toContain('…');
    expect(copy.title).toContain(long);
  });
});

describe('disabled reasons', () => {
  it('says nothing to paste when the clipboard is empty', () => {
    const paste = byId(menu(), 'paste')!;
    expect(paste.disabled).toBe(true);
    expect(paste.reason).toBe('Nothing to paste');
  });

  it('refuses a paste the target section’s rules reject, in dropDecision’s words', () => {
    // The bug fixed in passing: today this Paste is offered and the host errors.
    const items = menu({
      clipboard: BUS_CLIP,
      pasteTarget: { sectionLabel: 'Design Data', isDerived: false, allowedTypes: ['Simulink.Parameter'] },
    });
    const paste = byId(items, 'paste')!;
    expect(paste.disabled).toBe(true);
    expect(paste.reason).toBe('Bus cannot be in Design Data');
  });

  it('refuses pasting a MATLAB variable into Configurations', () => {
    // REGRESSION, reported: a numeric variable could be copied (and dragged) into
    // Configurations, which holds ConfigSet/ConfigSetRef objects and nothing else. A
    // variable carries no _array_class, and "no class" was read as "no restriction",
    // so this was the one payload kind the allow-list never got asked about — on all
    // three surfaces at once (this menu, the drag cursor, and the host paste).
    const items = menu({
      clipboard: {
        canPaste: true,
        mode: 'copy',
        items: [
          { className: 'double', arrayClass: '', kind: 'MATLAB Variable', isMatlabVariable: true, isScalarNumeric: true },
        ],
      },
      pasteTarget: {
        sectionLabel: 'Configurations',
        isDerived: false,
        allowedTypes: ['Simulink.ConfigSet', 'Simulink.ConfigSetRef'],
      },
    });
    const paste = byId(items, 'paste')!;
    expect(paste.disabled).toBe(true);
    expect(paste.reason).toBe('MATLAB Variable cannot be in Configurations');
  });

  it('refuses a paste whose target is ambiguous across sections', () => {
    const items = menu({ clipboard: BUS_CLIP, selectedRowIds: ['u/design/A', 'u/arch/V'] });
    const paste = byId(items, 'paste')!;
    expect(paste.disabled).toBe(true);
    expect(paste.reason).toBe('Select rows in one section to paste');
  });

  it('asks for a single row for Add Child and Location in Text', () => {
    const items = menu({ selectedRowIds: ['u/design/A', 'u/design/B'] });
    expect(byId(items, 'addChild')!.reason).toBe('Select a single item to add a child');
    expect(byId(items, 'locateInText')!.reason).toBe('Select a single item to locate it in the text');
  });

  it('explains a child its container will not give up', () => {
    const rows = ROWS.map((r) => (r.ID === 'u/design/A/x' ? { ...r, _canDelete: false } : r));
    const items = menu({ rows, selectedRowIds: ['u/design/A/x'], anchorRowId: 'u/design/A/x' });
    const del = byId(items, 'delete')!;
    expect(del.disabled).toBe(true);
    expect(del.reason).toBe("This element can't be removed from its parent");
  });

  it('keeps Cut ENABLED on that same child, because Cut reads the ENTRY’s flag', () => {
    // Invariant 7. Cut is copy plus a deferred delete of the entry it copied, so it
    // asks whether A may go — not whether x may leave its container. Collapsing the
    // two would wrongly disable Cut "A" for a struct-array field.
    const rows = ROWS.map((r) => (r.ID === 'u/design/A/x' ? { ...r, _canDelete: false } : r));
    const items = menu({ rows, selectedRowIds: ['u/design/A/x'], anchorRowId: 'u/design/A/x' });
    expect(byId(items, 'cut')!.disabled).toBeFalsy();
    expect(byId(items, 'cut')!.label).toBe('Cut "A"');
    expect(byId(items, 'delete')!.disabled).toBe(true);
  });
});

describe('menu shape', () => {
  it('gives a section row the short menu', () => {
    const items = menu({ selectedRowIds: ['section:design'], anchorRowId: 'section:design' });
    expect(labels(items)).toEqual(['Paste', 'Undo', 'Redo']);
    // One separator, between the two groups — and it is not first or last.
    expect(items.filter((i) => i.separator)).toHaveLength(1);
  });

  it('gives a selection mixing a header with data rows the FULL menu', () => {
    // Headers are dropped during resolution, so they contribute nothing — the menu
    // follows the operands, not the raw selection.
    const items = menu({ selectedRowIds: ['section:design', 'u/design/A'], anchorRowId: 'u/design/A' });
    expect(labels(items)).toContain('Copy "A"');
    expect(labels(items)).toContain('Add Child');
  });

  it('never orphans a separator, whatever the inputs', () => {
    // The invariant the group-join exists to make unbreakable (spec §11.8). Every
    // combination the builder can be handed, checked for a leading, trailing, or
    // doubled separator.
    const selections = [
      ['u/design/A'],
      ['u/design/A/x'],
      ['section:design'],
      ['section:design', 'section:arch'],
      ['u/design/A', 'u/design/B'],
      ['u/design/A', 'u/arch/V'],
      [],
    ];
    for (const selectedRowIds of selections) {
      for (const editable of [true, false]) {
        for (const hasTextView of [true, false]) {
          for (const clipboard of [EMPTY_CLIP, BUS_CLIP]) {
            const items = menu({ selectedRowIds, editable, hasTextView, clipboard, anchorRowId: selectedRowIds[0] ?? null });
            const where = JSON.stringify({ selectedRowIds, editable, hasTextView, canPaste: clipboard.canPaste });
            expect(items[0]?.separator, `no leading separator: ${where}`).toBeFalsy();
            expect(items[items.length - 1]?.separator, `no trailing separator: ${where}`).toBeFalsy();
            for (let i = 1; i < items.length; i++) {
              expect(
                items[i].separator && items[i - 1].separator,
                `no doubled separator: ${where}`,
              ).toBeFalsy();
            }
          }
        }
      }
    }
  });

  it('includes three separators between the four action groups', () => {
    expect(menu().filter((i) => i.separator)).toHaveLength(3);
  });

  it('omits Location in Text entirely when the document has no text view (binary .sldd)', () => {
    // A compressed-binary .sldd has no plain-text view, so the action is dropped
    // rather than shown disabled — and, groups being joined, its separator goes too.
    const items = menu({ clipboard: BUS_CLIP, hasTextView: false });
    expect(byId(items, 'locateInText')).toBeUndefined();
    expect(items.filter((i) => i.separator)).toHaveLength(2);
    // The rest of the editable menu is unaffected.
    expect(byId(items, 'copy')!.disabled).toBe(false);
    expect(byId(items, 'paste')!.disabled).toBeFalsy();
    expect(byId(items, 'undo')!.disabled).toBe(false);
  });
});

describe('enablement', () => {
  it('enables Copy/Cut/Delete for an editable entry, Add Child off for a scalar', () => {
    const items = menu({ selectedRowIds: ['u/design/B'], anchorRowId: 'u/design/B' });
    expect(byId(items, 'copy')!.disabled).toBe(false);
    expect(byId(items, 'cut')!.disabled).toBe(false);
    expect(byId(items, 'delete')!.disabled).toBe(false);
    // B takes no children.
    expect(byId(items, 'addChild')!.disabled).toBe(true);
    expect(byId(items, 'paste')!.disabled).toBe(true); // empty clipboard
  });

  it('enables Add Child for a struct/bus entry, and gives it nothing to explain', () => {
    const addChild = byId(menu(), 'addChild')!;
    expect(addChild.disabled).toBe(false);
    expect(addChild.reason, 'an available item has no reason to give').toBeUndefined();
  });

  it('says which kind of unavailable Add Child is', () => {
    // The two ways it can be off want different sentences, and only one of them is the
    // user's to fix. Both are tooltips now, so saying so costs the row nothing — and
    // "greyed out" with no sentence at all reads as the SELECTION being wrong, which for
    // a leaf row it is not.
    const tooMany = menu({
      selectedRowIds: ['u/design/A', 'u/design/B'],
      anchorRowId: 'u/design/A',
    });
    expect(byId(tooMany, 'addChild')!.reason).toBe('Select a single item to add a child');

    // B is a scalar: one row, and nothing about the selection to change.
    const leaf = menu({ selectedRowIds: ['u/design/B'], anchorRowId: 'u/design/B' });
    expect(byId(leaf, 'addChild')!.disabled).toBe(true);
    expect(byId(leaf, 'addChild')!.reason).toBe('This item takes no children');
  });

  it('Paste tracks clipboard state (and requires editable)', () => {
    expect(byId(menu({ clipboard: BUS_CLIP }), 'paste')!.disabled).toBeFalsy();
    expect(byId(menu({ clipboard: BUS_CLIP, editable: false }), 'paste')!.disabled).toBe(true);
    expect(byId(menu(), 'paste')!.disabled).toBe(true);
  });

  it('read-only doc: only Copy enabled, all mutating + undo/redo disabled', () => {
    const items = menu({ clipboard: BUS_CLIP, editable: false });
    expect(byId(items, 'copy')!.disabled).toBe(false);
    for (const id of ['cut', 'paste', 'addChild', 'delete', 'undo', 'redo']) {
      expect(byId(items, id)!.disabled, id).toBe(true);
    }
  });

  it('Location in Text is enabled for any data row (entry or nested child)', () => {
    // A nested child resolves to its owning entry's span, so it is locatable too.
    const locate = byId(menu(), 'locateInText')!;
    expect(locate.disabled).toBe(false);
    // Carries a Cmd/Ctrl+L shortcut (wired in table-main.ts).
    expect(locate.shortcut).toMatch(/L$/);
    const child = menu({ selectedRowIds: ['u/design/A/x'], anchorRowId: 'u/design/A/x' });
    expect(byId(child, 'locateInText')!.disabled).toBe(false);
  });

  it('omits every row action for a selection with no data rows', () => {
    // A section header, and an empty selection, both resolve to no operands — so the
    // items that would name nothing are absent rather than disabled.
    for (const selectedRowIds of [['section:design'], []]) {
      const items = menu({ selectedRowIds, anchorRowId: selectedRowIds[0] ?? null });
      for (const id of ['copy', 'cut', 'addChild', 'delete', 'locateInText']) {
        expect(byId(items, id), `${id} for ${JSON.stringify(selectedRowIds)}`).toBeUndefined();
      }
    }
  });

  // The Delete shortcut label is the one item resolved per call rather than at
  // import time, so it tracks the platform the webview is actually running on.
  // It matters because the key is different, not just the glyph: on Windows/Linux
  // the row-delete key is Del, and labeling it "⌫" there tells the user to press
  // Backspace — which resolveShortcutAction does accept, but which in a text-edit
  // context is the browser's "go back". Restore the global afterwards so the rest
  // of the suite still sees the real platform.
  describe('platform-specific Delete label', () => {
    const realNavigator = globalThis.navigator;
    const asPlatform = (platform: string) =>
      Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true });
    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', { value: realNavigator, configurable: true });
    });

    it('labels row delete ⌫ on a Mac', () => {
      asPlatform('MacIntel');
      expect(byId(menu(), 'delete')!.shortcut).toBe('⌫');
    });

    it('labels row delete Del on Windows/Linux', () => {
      asPlatform('Win32');
      expect(byId(menu(), 'delete')!.shortcut).toBe('Del');
    });

    it('falls back to Del when the platform string is empty', () => {
      // Chromium is deprecating navigator.platform; an empty value must not read
      // as "Mac" (the check would then fall through to a Mac-only label on Linux).
      asPlatform('');
      expect(byId(menu(), 'delete')!.shortcut).toBe('Del');
    });
  });
});

// The context menu advertises shortcuts (⌘C/⌘X/⌘V/⌫); resolveShortcutAction maps
// a keydown to the matching action id so the webview can dispatch it — the labels
// would be dead UI otherwise.
describe('resolveShortcutAction', () => {
  const key = (o: Partial<KeyboardEvent>): KeyboardEvent => o as KeyboardEvent;

  it('maps Cmd/Ctrl+C/X/V to copy/cut/paste', () => {
    expect(resolveShortcutAction(key({ key: 'c', metaKey: true }))).toBe('copy');
    expect(resolveShortcutAction(key({ key: 'x', ctrlKey: true }))).toBe('cut');
    expect(resolveShortcutAction(key({ key: 'v', metaKey: true }))).toBe('paste');
    // Uppercase (caps lock / shift-less report) still resolves.
    expect(resolveShortcutAction(key({ key: 'C', metaKey: true }))).toBe('copy');
  });

  it('maps Delete and Backspace to delete (no modifier)', () => {
    expect(resolveShortcutAction(key({ key: 'Delete' }))).toBe('delete');
    expect(resolveShortcutAction(key({ key: 'Backspace' }))).toBe('delete');
  });

  it('ignores plain letters and modified Delete', () => {
    expect(resolveShortcutAction(key({ key: 'c' }))).toBeNull();
    expect(resolveShortcutAction(key({ key: 'v' }))).toBeNull();
    // A modified Delete/Backspace is a text-editing gesture, not a row delete.
    expect(resolveShortcutAction(key({ key: 'Delete', metaKey: true }))).toBeNull();
    expect(resolveShortcutAction(key({ key: 'Backspace', ctrlKey: true }))).toBeNull();
  });

  it('ignores clipboard chords with extra modifiers (Shift/Alt)', () => {
    expect(resolveShortcutAction(key({ key: 'c', metaKey: true, shiftKey: true }))).toBeNull();
    expect(resolveShortcutAction(key({ key: 'v', ctrlKey: true, altKey: true }))).toBeNull();
  });
});

// Document-level (table) readonly gates BOTH the editor and the context menu.
// This is distinct from the row-level `Name.editable` coloring flag, which
// these predicates deliberately ignore.
describe('document-level readonly gates (shouldShowContextMenu / shouldOpenCellEditor)', () => {
  it('shows the menu and opens the editor only for an editable document', () => {
    expect(shouldShowContextMenu(true)).toBe(true);
    expect(shouldOpenCellEditor(true)).toBe(true);
  });

  it('suppresses both for a read-only document (.mat/.slx/.prj, binary .sldd)', () => {
    // Read-only docs get no menu and no cell editor — the binary view has no
    // write-back/copy/paste/mutation handlers, so both would be dead UI.
    expect(shouldShowContextMenu(false)).toBe(false);
    expect(shouldOpenCellEditor(false)).toBe(false);
  });
});
