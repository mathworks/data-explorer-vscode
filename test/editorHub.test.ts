// Copyright 2026 The MathWorks, Inc.
//
// The cross-provider hub (editorHub.ts) is what lets the JSON and binary table
// editors share one clipboard/drag broadcast fan-out and one cross-document
// source-delete dispatch. These tests pin that contract with fake webviews and
// a fake deleter — no VS Code needed (the hub only duck-types webview.postMessage).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerWebview,
  unregisterWebview,
  registerAddGalleryView,
  unregisterAddGalleryView,
  openAddGalleryInActiveView,
  registerSourceDeleter,
  unregisterSourceDeleter,
  broadcastClipboardState,
  broadcastDragState,
  deleteFromSource,
} from '../src/host/editorHub.js';
import { setClipboard, clearClipboard } from '../src/host/clipboard.js';
import { setDrag, clearDrag } from '../src/host/dragState.js';

interface FakeWebview {
  posted: any[];
  postMessage: (m: any) => void;
}
function fakeWebview(): FakeWebview {
  const posted: any[] = [];
  return { posted, postMessage: (m: any) => posted.push(m) };
}

beforeEach(() => {
  clearClipboard();
  clearDrag();
});

describe('editorHub — clipboard broadcast', () => {
  it('posts clipboardState AND repaints every registered webview', () => {
    const wvA = fakeWebview();
    const wvB = fakeWebview();
    let repaintsA = 0;
    let repaintsB = 0;
    registerWebview(wvA as any, () => repaintsA++);
    registerWebview(wvB as any, () => repaintsB++);
    try {
      setClipboard(
        [
          {
            payload: { name: 'X' },
            sourceSection: 'design',
            className: 'Simulink.Parameter',
            arrayClass: '',
            kind: 'Parameter',
            isMatlabVariable: true,
            isScalarNumeric: true,
          },
        ],
        'copy',
        'mem://a',
      );
      broadcastClipboardState();
      expect(wvA.posted.at(-1)).toMatchObject({ type: 'clipboardState', canPaste: true, mode: 'copy' });
      expect(wvB.posted.at(-1)).toMatchObject({ type: 'clipboardState', canPaste: true });
      expect(repaintsA).toBe(1);
      expect(repaintsB).toBe(1);
    } finally {
      unregisterWebview(wvA as any);
      unregisterWebview(wvB as any);
    }
  });

  it('a view whose post or repaint throws costs only that view its update', () => {
    // One table that throws — a panel disposed under the loop, a model that will not read —
    // used to stop the loop, and every table registered after it went on showing the old
    // clipboard state.
    const throwsOnPost = { postMessage: () => { throw new Error('Webview is disposed'); } };
    const rejectsPost = { postMessage: () => Promise.reject(new Error('Webview is disposed')) };
    const after = fakeWebview();
    let repaints = 0;
    registerWebview(throwsOnPost as any, () => repaints++);
    registerWebview(rejectsPost as any, () => {
      throw new Error('no model');
    });
    registerWebview(after as any, () => repaints++);
    try {
      setClipboard([{ payload: { name: 'X' }, sourceSection: 'design', className: '', arrayClass: '', kind: '', isMatlabVariable: true, isScalarNumeric: true }], 'copy', 'mem://a');
      expect(() => broadcastClipboardState()).not.toThrow();
      expect(after.posted.at(-1)).toMatchObject({ type: 'clipboardState', canPaste: true });
      expect(repaints, 'the throwing view still got its repaint, and so did the one after').toBe(2);

      setDrag('mem://a', [{ payload: { name: 'X' }, sourceSection: 'design', className: '', arrayClass: '', kind: '', isMatlabVariable: true, isScalarNumeric: true }]);
      expect(() => broadcastDragState()).not.toThrow();
      expect(after.posted.at(-1)).toMatchObject({ type: 'dragState' });
    } finally {
      unregisterWebview(throwsOnPost as any);
      unregisterWebview(rejectsPost as any);
      unregisterWebview(after as any);
    }
  });

  it('stops posting to an unregistered webview', () => {
    const wv = fakeWebview();
    registerWebview(wv as any, () => {});
    unregisterWebview(wv as any);
    broadcastClipboardState();
    expect(wv.posted.length).toBe(0);
  });
});

describe('editorHub — drag broadcast', () => {
  it('posts the current drag descriptor, then null when the drag clears', () => {
    const wv = fakeWebview();
    registerWebview(wv as any, () => {});
    try {
      setDrag('mem://a', [
        { payload: { name: 'X' }, sourceSection: 'design', className: 'Simulink.Parameter', arrayClass: '', kind: 'Parameter', isMatlabVariable: true, isScalarNumeric: true },
      ]);
      broadcastDragState();
      expect(wv.posted.at(-1)).toMatchObject({ type: 'dragState' });
      expect(wv.posted.at(-1).descriptor).toMatchObject({ docUri: 'mem://a', items: [{ sectionName: 'design' }] });

      clearDrag();
      broadcastDragState();
      expect(wv.posted.at(-1)).toEqual({ type: 'dragState', descriptor: null });
    } finally {
      unregisterWebview(wv as any);
    }
  });
});

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

describe('editorHub — cross-document source delete dispatch', () => {
  it('dispatches to the deleter registered for the source URI, and answers what it did', async () => {
    const seen: unknown[][] = [];
    registerSourceDeleter('mem://src', (names) => {
      seen.push(names);
      return { removed: true };
    });
    try {
      await expect(deleteFromSource('mem://src', ['A', 'B'])).resolves.toEqual({ removed: true });
      expect(seen).toEqual([['A', 'B']]);
    } finally {
      unregisterSourceDeleter('mem://src');
    }
  });

  it('says the original was NOT removed when no deleter is registered (a cut whose tab was closed)', async () => {
    // Still no throw, and still no wrong-format edit on the file — but no longer silent: a
    // lazy cut's source can be closed before its paste, and then the move leaves the original
    // behind, which the user has to be told.
    await expect(deleteFromSource('mem://unknown', ['A'])).resolves.toEqual({
      removed: false,
      reason: 'its table is no longer open',
    });
  });

  it('passes a deleter’s "not removed" through to the caller', async () => {
    registerSourceDeleter('mem://refused', () => ({ removed: false, reason: 'the file has invalid JSON' }));
    try {
      await expect(deleteFromSource('mem://refused', ['A'])).resolves.toEqual({
        removed: false,
        reason: 'the file has invalid JSON',
      });
    } finally {
      unregisterSourceDeleter('mem://refused');
    }
  });

  it('does not read a deleter that answers nothing as a delete that happened', async () => {
    registerSourceDeleter('mem://mute', (() => undefined) as any);
    try {
      const result = await deleteFromSource('mem://mute', ['A']);
      expect(result.removed).toBe(false);
    } finally {
      unregisterSourceDeleter('mem://mute');
    }
  });

  it('awaits an async deleter before resolving', async () => {
    let done = false;
    registerSourceDeleter('mem://async', async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
      return { removed: true };
    });
    try {
      await deleteFromSource('mem://async', ['A']);
      expect(done).toBe(true);
    } finally {
      unregisterSourceDeleter('mem://async');
    }
  });

  it('propagates a deleter that rejects rather than swallowing it', async () => {
    // A source-delete CAN fail: it opens another document and applies a
    // WorkspaceEdit, either of which can reject (the file was deleted or is
    // locked). The hub deliberately does not catch — the caller must decide, and
    // both providers do: they clear the cut in a `finally`, because the paste half
    // already succeeded, so a surviving cut would duplicate the entry on the next
    // paste. Swallowing here would silently report a completed move.
    registerSourceDeleter('mem://boom', () => {
      throw new Error('source vanished');
    });
    try {
      await expect(deleteFromSource('mem://boom', ['A'])).rejects.toThrow('source vanished');
    } finally {
      unregisterSourceDeleter('mem://boom');
    }
  });

  it('propagates an async deleter that rejects', async () => {
    // The realistic shape: applyEdit returns a rejected promise rather than
    // throwing synchronously.
    registerSourceDeleter('mem://boom-async', async () => {
      await new Promise((r) => setTimeout(r, 1));
      throw new Error('applyEdit failed');
    });
    try {
      await expect(deleteFromSource('mem://boom-async', ['A'])).rejects.toThrow('applyEdit failed');
    } finally {
      unregisterSourceDeleter('mem://boom-async');
    }
  });
});
