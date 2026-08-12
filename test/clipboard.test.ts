// Copyright 2026 The MathWorks, Inc.
// The module-level clipboard is a single shared slot (mirroring data explorer's
// one ClipboardService). These tests pin its state machine — set/get/clear, the
// cut vs copy mode, and the derived canPaste/clipboardState views the webview
// relies on to build its context menu synchronously.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setClipboard,
  getClipboard,
  clearClipboard,
  canPaste,
  clipboardState,
} from '../src/host/clipboard.js';

describe('clipboard', () => {
  // The clipboard is module-global; reset it so tests don't leak into each other.
  beforeEach(() => clearClipboard());

  it('starts empty', () => {
    expect(getClipboard()).toBeNull();
    expect(canPaste()).toBe(false);
    expect(clipboardState()).toEqual({ canPaste: false, mode: null });
  });

  it('stores a copied payload with its mode, source section, and source document', () => {
    const payload = { name: 'Kp', value: 1 };
    setClipboard(payload, 'copy', 'Design Data', 'file:///a.sldd');
    expect(getClipboard()).toEqual({
      payload,
      mode: 'copy',
      sourceSection: 'Design Data',
      sourceDocUri: 'file:///a.sldd',
    });
    expect(canPaste()).toBe(true);
    expect(clipboardState()).toEqual({ canPaste: true, mode: 'copy' });
  });

  it('records cut mode distinctly from copy', () => {
    setClipboard({ name: 'X' }, 'cut', 'Design Data', 'file:///a.sldd');
    expect(getClipboard()?.mode).toBe('cut');
    expect(clipboardState()).toEqual({ canPaste: true, mode: 'cut' });
  });

  it('remembers which document a cut came from (for the lazy source delete on paste)', () => {
    setClipboard({ name: 'X' }, 'cut', 'Design Data', 'file:///source.sldd');
    expect(getClipboard()?.sourceDocUri).toBe('file:///source.sldd');
  });

  it('overwrites the previous entry on a second set', () => {
    setClipboard({ name: 'first' }, 'copy', 'A', 'file:///a.sldd');
    setClipboard({ name: 'second' }, 'cut', 'B', 'file:///b.sldd');
    expect(getClipboard()).toEqual({
      payload: { name: 'second' },
      mode: 'cut',
      sourceSection: 'B',
      sourceDocUri: 'file:///b.sldd',
    });
  });

  it('clears back to the empty state', () => {
    setClipboard({ name: 'X' }, 'copy', 'A');
    clearClipboard();
    expect(getClipboard()).toBeNull();
    expect(canPaste()).toBe(false);
    expect(clipboardState()).toEqual({ canPaste: false, mode: null });
  });

  it('holds the payload by reference (structural snapshot is the caller\'s duty)', () => {
    // clipboard.ts stores whatever object it is given; the copy/cut caller is
    // responsible for passing an already-detached snapshot. Document that here.
    const payload = { name: 'ref' };
    setClipboard(payload, 'copy', 'A');
    expect(getClipboard()?.payload).toBe(payload);
  });
});
