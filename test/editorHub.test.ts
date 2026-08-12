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
      setClipboard({ name: 'X' }, 'copy', 'design', 'mem://a');
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
      setDrag('mem://a', 'design', 'Design Data', false, [
        { payload: { name: 'X' }, className: 'Simulink.Parameter', arrayClass: '', kind: 'Parameter', isMatlabVariable: true, isScalarNumeric: true },
      ]);
      broadcastDragState();
      expect(wv.posted.at(-1)).toMatchObject({ type: 'dragState' });
      expect(wv.posted.at(-1).descriptor).toMatchObject({ docUri: 'mem://a', sectionName: 'design' });

      clearDrag();
      broadcastDragState();
      expect(wv.posted.at(-1)).toEqual({ type: 'dragState', descriptor: null });
    } finally {
      unregisterWebview(wv as any);
    }
  });
});

describe('editorHub — cross-document source delete dispatch', () => {
  it('dispatches to the deleter registered for the source URI', async () => {
    const seen: string[][] = [];
    registerSourceDeleter('mem://src', (names) => {
      seen.push(names);
    });
    try {
      await deleteFromSource('mem://src', ['A', 'B']);
      expect(seen).toEqual([['A', 'B']]);
    } finally {
      unregisterSourceDeleter('mem://src');
    }
  });

  it('is a no-op when no deleter is registered for the URI (source left intact)', async () => {
    // Must not throw — a missing deleter leaves the source untouched rather than
    // risking a wrong-format edit.
    await expect(deleteFromSource('mem://unknown', ['A'])).resolves.toBeUndefined();
  });

  it('awaits an async deleter before resolving', async () => {
    let done = false;
    registerSourceDeleter('mem://async', async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    try {
      await deleteFromSource('mem://async', ['A']);
      expect(done).toBe(true);
    } finally {
      unregisterSourceDeleter('mem://async');
    }
  });
});
