// Copyright 2026 The MathWorks, Inc.
//
// The one thing the table editors (SlddTextEditorProvider, BinarySlddEditorProvider and
// MatEditorProvider) still share here: the keyboard's way into the Add gallery, which is VS Code's
// own question (which panel is the user looking at). The clipboard, the drag register, the source
// deleters a cross-document move asks, and the broadcasts that reach every open table are the
// window's registers (windowRegisters.ts, data-explorer-view's createRegisters), which every
// editor's engine is given.
import * as vscode from 'vscode';

// Every open EDITABLE table view → how to open its Add gallery. Keyed by the panel
// rather than the webview because the key is also the question a keybinding asks:
// `panel.active` is VS Code's own answer to which view the user is looking at, so
// the command needs nothing cached and cannot go stale. The read-only .slx/.mat view
// registers nothing, which is what makes `Add an Entry` a no-op there instead of an
// error.
const addGalleryViews = new Map<vscode.WebviewPanel, () => void>();

export function registerAddGalleryView(panel: vscode.WebviewPanel, open: () => void): void {
  addGalleryViews.set(panel, open);
}

export function unregisterAddGalleryView(panel: vscode.WebviewPanel): void {
  addGalleryViews.delete(panel);
}

/**
 * Open the Add gallery in whichever table view has focus, and say whether one did.
 *
 * At most one panel is `active` at a time, so this opens one gallery or none. None is
 * the ordinary outcome, not a failure: the keybinding is `when`-scoped to the editable
 * views, but the Command Palette offers no such guarantee, and a command that is merely
 * unavailable should do nothing rather than complain.
 */
export function openAddGalleryInActiveView(): boolean {
  for (const [panel, open] of addGalleryViews) {
    if (!panel.active) continue;
    open();
    return true;
  }
  return false;
}
