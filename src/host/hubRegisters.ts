// Copyright 2026 The MathWorks, Inc.
//
// The registers one of view's editing engines is given (data-explorer-view's `Registers`), made of
// this extension's own: the clipboard (clipboard.ts), the drag register (dragState.ts), the
// registers a paste and a drop read (transferRegisters.ts), and the hub's source deleters and
// broadcasts (editorHub.ts). So an engine's table and every editor still on this extension's copies
// share one clipboard, one drag and one set of deleters, and a broadcast reaches them all in the
// order they were opened. Until every editor is on view's engines, and they share view's own
// (createRegisters, one per window).
import type { Registers } from 'data-explorer-view/model';
import { canPaste, clearClipboard, clipboardState, getClipboard, setClipboard } from './clipboard.js';
import { clearDrag, dragDescriptor, getDrag, setDrag } from './dragState.js';
import {
  broadcastClipboardState,
  broadcastDragState,
  deleteFromSource,
  registerSourceDeleter,
  registerTableListener,
  unregisterSourceDeleter,
} from './editorHub.js';
import { clipboardRegister, dragRegister } from './transferRegisters.js';

/** This extension's registers, as view's engines take them. */
export function hubRegisters(): Registers {
  return {
    setClipboard,
    getClipboard,
    clearClipboard,
    canPaste,
    clipboardState,
    setDrag,
    getDrag,
    clearDrag,
    dragDescriptor,
    clipboardRegister: (broadcast = broadcastClipboardState) => clipboardRegister(broadcast),
    dragRegister: (mode, broadcast = broadcastDragState) => dragRegister(mode, broadcast),
    registerSourceDeleter,
    unregisterSourceDeleter,
    deleteFromSource,
    listen: registerTableListener,
    broadcastClipboardState,
    broadcastDragState,
  };
}
