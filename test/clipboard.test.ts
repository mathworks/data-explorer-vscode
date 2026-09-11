// Copyright 2026 The MathWorks, Inc.
// The module-level clipboard is a single shared register (mirroring data explorer's
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
  type ClipboardItem,
} from '../src/host/clipboard.js';

// The facts a drop target judges an item by (dropFacts.ts). Spelled out once here so
// each test reads as "this payload, from this section".
function item(name: string, sourceSection: string): ClipboardItem {
  return {
    payload: { name },
    sourceSection,
    className: 'Simulink.Parameter',
    arrayClass: '',
    kind: 'Parameter',
    isMatlabVariable: true,
    isScalarNumeric: true,
  };
}

describe('clipboard', () => {
  // The clipboard is module-global; reset it so tests don't leak into each other.
  beforeEach(() => clearClipboard());

  it('starts empty', () => {
    expect(getClipboard()).toBeNull();
    expect(canPaste()).toBe(false);
    expect(clipboardState()).toEqual({ canPaste: false, mode: null, items: [] });
  });

  it('stores copied items with their mode and source document', () => {
    const items = [item('Kp', 'design')];
    setClipboard(items, 'copy', 'file:///a.sldd');
    expect(getClipboard()).toEqual({ items, mode: 'copy', sourceDocUri: 'file:///a.sldd' });
    expect(canPaste()).toBe(true);
  });

  it('keeps each item’s OWN source section', () => {
    // Copy operands can span sections (a Bus in Architectural Data and a parameter in
    // Design Data selected together), and a lazy cut deletes each source from where it
    // actually came from. One shared sourceSection would delete from the wrong place.
    setClipboard([item('Bus1', 'arch'), item('Kp', 'design')], 'cut', 'file:///a.sldd');
    expect(getClipboard()!.items.map((i) => i.sourceSection)).toEqual(['arch', 'design']);
  });

  it('records cut mode distinctly from copy', () => {
    setClipboard([item('X', 'design')], 'cut', 'file:///a.sldd');
    expect(getClipboard()?.mode).toBe('cut');
    expect(clipboardState()).toMatchObject({ canPaste: true, mode: 'cut' });
  });

  it('remembers which document a cut came from (for the lazy source delete on paste)', () => {
    setClipboard([item('X', 'design')], 'cut', 'file:///source.sldd');
    expect(getClipboard()?.sourceDocUri).toBe('file:///source.sldd');
  });

  it('overwrites the previous entry on a second set', () => {
    setClipboard([item('first', 'A')], 'copy', 'file:///a.sldd');
    setClipboard([item('second', 'B')], 'cut', 'file:///b.sldd');
    expect(getClipboard()).toEqual({
      items: [item('second', 'B')],
      mode: 'cut',
      sourceDocUri: 'file:///b.sldd',
    });
  });

  it('an empty item list is nothing to paste', () => {
    // A copy that resolved no entries must not leave a clipboard that offers Paste and
    // then pastes nothing.
    setClipboard([], 'copy', 'file:///a.sldd');
    expect(getClipboard()).toBeNull();
    expect(canPaste()).toBe(false);
  });

  it('clears back to the empty state', () => {
    setClipboard([item('X', 'A')], 'copy');
    clearClipboard();
    expect(getClipboard()).toBeNull();
    expect(canPaste()).toBe(false);
    expect(clipboardState()).toEqual({ canPaste: false, mode: null, items: [] });
  });

  it('ships the webview payload-free drop facts, one per item', () => {
    // The webview predicts a paste with dropDecision, exactly as it predicts a drag —
    // but it must never receive the entry records: on a 47.8 MB dictionary that is the
    // difference between a small message and a 67 MB one.
    setClipboard([item('Kp', 'design'), item('Ki', 'design')], 'copy', 'file:///a.sldd');
    const state = clipboardState();
    expect(state).toMatchObject({ canPaste: true, mode: 'copy' });
    expect(state.items).toEqual([
      { className: 'Simulink.Parameter', arrayClass: '', kind: 'Parameter', isMatlabVariable: true, isScalarNumeric: true },
      { className: 'Simulink.Parameter', arrayClass: '', kind: 'Parameter', isMatlabVariable: true, isScalarNumeric: true },
    ]);
    expect(JSON.stringify(state)).not.toContain('Kp');
  });

  it('holds the payloads by reference (structural snapshot is the caller\'s duty)', () => {
    // clipboard.ts stores whatever objects it is given; the copy/cut caller is
    // responsible for passing already-detached snapshots. Document that here.
    const one = item('ref', 'A');
    setClipboard([one], 'copy');
    expect(getClipboard()?.items[0]).toBe(one);
  });
});
