// Copyright 2026 The MathWorks, Inc.
//
// The copy-vs-move drag modifier is PLATFORM-specific, and it must match the OS
// convention exactly: the browser derives the native dropEffect from the OS
// modifier, so requesting an effect the OS modifier doesn't grant makes the
// drop silently fail (dropEffect forced to 'none', no drop event). These tests
// pin the convention for every platform — including the ones we can't run
// interactively — so the mapping can't regress unnoticed.
import { describe, it, expect } from 'vitest';
import { isMacPlatform, dragModeFromModifiers } from '../src/webview/dragMode.js';

describe('isMacPlatform — recognizes Apple platform strings', () => {
  it('is true for the desktop navigator.platform value', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
  });
  it('is true for the userAgentData platform value', () => {
    expect(isMacPlatform('macOS')).toBe(true);
  });
  it('is true for iPad/iPhone', () => {
    expect(isMacPlatform('iPad')).toBe(true);
    expect(isMacPlatform('iPhone')).toBe(true);
  });
  it('is false for Windows and Linux', () => {
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
  });
  it('is false for an empty/unknown platform', () => {
    expect(isMacPlatform('')).toBe(false);
  });
});

describe('dragModeFromModifiers — macOS uses Option (Alt) for copy', () => {
  it('Option held = copy', () => {
    expect(dragModeFromModifiers('MacIntel', { altKey: true, ctrlKey: false })).toBe('copy');
  });
  it('no modifier = move', () => {
    expect(dragModeFromModifiers('MacIntel', { altKey: false, ctrlKey: false })).toBe('move');
  });
  it('Ctrl does NOT copy on macOS (a plain move; Cmd/Ctrl are not the copy key)', () => {
    expect(dragModeFromModifiers('MacIntel', { altKey: false, ctrlKey: true })).toBe('move');
  });
});

describe('dragModeFromModifiers — Windows/Linux use Ctrl for copy', () => {
  it('Ctrl held = copy on Windows', () => {
    expect(dragModeFromModifiers('Win32', { altKey: false, ctrlKey: true })).toBe('copy');
  });
  it('Ctrl held = copy on Linux', () => {
    expect(dragModeFromModifiers('Linux x86_64', { altKey: false, ctrlKey: true })).toBe('copy');
  });
  it('no modifier = move on Windows', () => {
    expect(dragModeFromModifiers('Win32', { altKey: false, ctrlKey: false })).toBe('move');
  });
  it('Alt does NOT copy on Windows (it is not the copy modifier there)', () => {
    expect(dragModeFromModifiers('Win32', { altKey: true, ctrlKey: false })).toBe('move');
  });
});
