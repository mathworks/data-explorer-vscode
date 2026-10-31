// Copyright 2026 The MathWorks, Inc.
//
// What the editors still share through editorHub.ts: the keyboard's way into the Add gallery, which
// asks VS Code which panel is active. These tests pin it with fake panels, no VS Code needed (the
// hub only reads `panel.active`). The clipboard and drag broadcasts and the source-delete dispatch
// are the window's registers now (windowRegisters.ts, view's createRegisters), tested in view
// (registers.test.ts).
import { describe, it, expect } from 'vitest';
import { registerAddGalleryView, unregisterAddGalleryView, openAddGalleryInActiveView } from '../src/host/editorHub.js';

describe('editorHub — the Add gallery accelerator', () => {
  // The command (dataExplorer.addEntry) has no view of its own to act on. Each editable
  // table registers how to open its gallery, and the hub asks VS Code which panel is
  // active — `panel.active` rather than a "last focused" panel this code kept for itself,
  // because a cache of the answer is a second source of truth that can go stale behind a
  // tab drag, a split, or a panel disposed while the palette was open.
  function fakePanel(active: boolean): any {
    return { active };
  }

  it('opens the gallery in the active view only', () => {
    const a = fakePanel(false);
    const b = fakePanel(true);
    const opened: string[] = [];
    registerAddGalleryView(a, () => opened.push('a'));
    registerAddGalleryView(b, () => opened.push('b'));
    try {
      expect(openAddGalleryInActiveView()).toBe(true);
      expect(opened).toEqual(['b']);
    } finally {
      unregisterAddGalleryView(a);
      unregisterAddGalleryView(b);
    }
  });

  // Not an error, and deliberately not a notification. The keybinding is `when`-scoped to
  // the two editable views, but the Command Palette runs whatever it lists, and "no table
  // is focused" is a reason to do nothing.
  it('does nothing, and says so, when no registered view is active', () => {
    const idle = fakePanel(false);
    registerAddGalleryView(idle, () => {
      throw new Error('opened a gallery in an inactive view');
    });
    try {
      expect(openAddGalleryInActiveView()).toBe(false);
    } finally {
      unregisterAddGalleryView(idle);
    }
  });

  it('reports no view at all once every table has closed', () => {
    expect(openAddGalleryInActiveView()).toBe(false);
  });

  // A closed tab's panel is disposed, and reading `.active` on it is not something to rely
  // on — so the registration goes with the panel. Both providers unregister in onDidDispose.
  it('forgets a view that has been unregistered', () => {
    const panel = fakePanel(true);
    let opens = 0;
    registerAddGalleryView(panel, () => opens++);
    unregisterAddGalleryView(panel);
    expect(openAddGalleryInActiveView()).toBe(false);
    expect(opens).toBe(0);
  });
});
