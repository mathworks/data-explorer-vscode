// Copyright 2026 The MathWorks, Inc.
//
// The copy-vs-move modifier for a drag follows the PLATFORM convention, because
// the browser derives the native dropEffect from the OS modifier: requesting an
// effect the OS modifier doesn't grant makes the browser force dropEffect='none'
// and cancel the drop before it fires. So we must read the SAME key the OS uses:
//   • macOS: a plain drag moves; Option (Alt) requests a copy. Cmd means move
//     (the Finder convention), so it is NOT the copy key.
//   • Windows / Linux: a plain drag moves; Ctrl requests a copy.
// Kept pure (a platform string in, a mode out) so the convention is unit-tested
// on every platform, including ones we can't launch interactively.

export type DragMode = 'copy' | 'move';

/** True for macOS/iOS platform strings (navigator.platform or userAgentData). */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

/** The drag mode for the given platform and the modifier keys currently held. */
export function dragModeFromModifiers(
  platform: string,
  mods: { altKey: boolean; ctrlKey: boolean },
): DragMode {
  const wantsCopy = isMacPlatform(platform) ? mods.altKey : mods.ctrlKey;
  return wantsCopy ? 'copy' : 'move';
}
