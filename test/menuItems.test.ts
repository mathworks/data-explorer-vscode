// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { buildContextMenuItems, shouldShowContextMenu, shouldOpenCellEditor, type MenuRow, type ClipboardState } from '../src/webview/menuItems.js';

const NO_CLIP: ClipboardState = { canPaste: false, mode: null };
const HAS_CLIP: ClipboardState = { canPaste: true, mode: 'copy' };

function byId(items: ReturnType<typeof buildContextMenuItems>) {
  const map = new Map(items.map((i) => [i.id, i]));
  return (id: string) => map.get(id)!;
}

const ENTRY: MenuRow = { ID: 'section:design/E', _isEntry: true, _canCopy: true, _canDelete: true, _canAddChild: false };
const STRUCT: MenuRow = { ID: 'section:design/S', _isEntry: true, _canCopy: true, _canDelete: true, _canAddChild: true };
const LOCKED_CHILD: MenuRow = { ID: 'section:design/S/f', _canCopy: true, _canDelete: false, _canAddChild: false };

describe('buildContextMenuItems', () => {
  it('enables Copy/Cut/Delete for an editable entry, Add Child off for a scalar', () => {
    const get = byId(buildContextMenuItems(ENTRY, NO_CLIP, true));
    expect(get('copy').disabled).toBe(false);
    expect(get('cut').disabled).toBe(false);
    expect(get('delete').disabled).toBe(false);
    expect(get('addChild').disabled).toBe(true);
    expect(get('paste').disabled).toBe(true); // empty clipboard
  });

  it('enables Add Child for a struct/bus entry', () => {
    const get = byId(buildContextMenuItems(STRUCT, NO_CLIP, true));
    expect(get('addChild').disabled).toBe(false);
  });

  it('Paste tracks clipboard state (and requires editable)', () => {
    expect(byId(buildContextMenuItems(ENTRY, HAS_CLIP, true))('paste').disabled).toBe(false);
    expect(byId(buildContextMenuItems(ENTRY, HAS_CLIP, false))('paste').disabled).toBe(true);
    expect(byId(buildContextMenuItems(ENTRY, NO_CLIP, true))('paste').disabled).toBe(true);
  });

  it('a locked nested child cannot be cut or deleted, but can be copied', () => {
    const get = byId(buildContextMenuItems(LOCKED_CHILD, HAS_CLIP, true));
    expect(get('copy').disabled).toBe(false);
    expect(get('cut').disabled).toBe(true);
    expect(get('delete').disabled).toBe(true);
  });

  it('read-only doc: only Copy enabled, all mutating + undo/redo disabled', () => {
    const get = byId(buildContextMenuItems(ENTRY, HAS_CLIP, false));
    expect(get('copy').disabled).toBe(false);
    for (const id of ['cut', 'paste', 'addChild', 'delete', 'undo', 'redo']) {
      expect(get(id).disabled).toBe(true);
    }
  });

  it('Location in Text is enabled for any data row (entry or nested child), off for a section', () => {
    // Every data row carries _canCopy; a nested child resolves to its owning
    // entry's span, so it is locatable too.
    const get = byId(buildContextMenuItems(ENTRY, NO_CLIP, true));
    expect(get('locateInText').disabled).toBe(false);
    // Carries a Cmd/Ctrl+L shortcut (wired in table-main.ts).
    expect(get('locateInText').shortcut).toMatch(/L$/);
    expect(byId(buildContextMenuItems(LOCKED_CHILD, NO_CLIP, true))('locateInText').disabled).toBe(false);
    // Section headers (null capability flags) can't be located.
    expect(byId(buildContextMenuItems(null, NO_CLIP, true))('locateInText').disabled).toBe(true);
  });

  it('a null row (right-click empty area) disables everything mutating', () => {
    const get = byId(buildContextMenuItems(null, NO_CLIP, true));
    expect(get('copy').disabled).toBe(true);
    expect(get('delete').disabled).toBe(true);
    expect(get('addChild').disabled).toBe(true);
  });

  it('includes three separators between the action groups', () => {
    const seps = buildContextMenuItems(ENTRY, NO_CLIP, true).filter((i) => i.separator);
    expect(seps).toHaveLength(3);
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
