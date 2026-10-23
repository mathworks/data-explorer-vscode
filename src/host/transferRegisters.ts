// Copyright 2026 The MathWorks, Inc.
//
// The two registers a transfer (transfer.ts) reads from: the clipboard, for a paste, and the
// drag register, for a drop. Both read as the same TransferContents, which is what lets one
// policy serve both gestures.
//
// Each one remembers the exact object it read and clears the register only while it still holds
// that object. Both setClipboard and setDrag replace the record rather than mutate it, so
// identity is the test of "nothing newer was written": a copy made while a paste was awaiting
// its write, or a drag started while a drop was finishing, is not wiped by the transfer that
// was already under way.
//
// The broadcast is injected because editorHub, which owns it, imports `vscode`; this module stays
// vscode-free so the registers are unit-testable with the real clipboard and drag singletons.
import { clearClipboard, getClipboard } from './clipboard.js';
import { clearDrag, getDrag } from './dragState.js';
import type { TransferContents, TransferRegister } from './transfer.js';

/**
 * The clipboard as a paste reads it — at the moment the paste starts, not when the message
 * arrived, so a second Paste queued behind a cut's paste finds the clipboard that cut left.
 */
export function clipboardRegister(broadcast: () => void): TransferRegister {
  let held: ReturnType<typeof getClipboard> = null;
  return {
    kind: 'clipboard',
    read(): TransferContents | null {
      held = getClipboard();
      return held && { items: held.items, sourceDocUri: held.sourceDocUri, move: held.mode === 'cut' };
    },
    clear(): void {
      if (held && getClipboard() === held) clearClipboard();
    },
    broadcast,
  };
}

/**
 * The drag register as a drop reads it — captured NOW, when the drop message arrives.
 *
 * A drop is followed at once by its source's `dragEnd`, which clears the register. A provider
 * that queues its structural edits (the JSON view does, so two of them cannot interleave around
 * one write) would otherwise run the drop after that and find nothing to drop.
 */
export function dragRegister(mode: 'copy' | 'move', broadcast: () => void): TransferRegister {
  const held = getDrag();
  return {
    kind: 'drag',
    read(): TransferContents | null {
      return held && { items: held.items, sourceDocUri: held.sourceDocUri, move: mode === 'move' };
    },
    clear(): void {
      if (held && getDrag() === held) clearDrag();
    },
    broadcast,
  };
}
