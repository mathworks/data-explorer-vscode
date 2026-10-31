// Copyright 2026 The MathWorks, Inc.
//
// The registers of this window: one clipboard, one drag, the source deleters every editor's move
// asks, and the broadcasts that reach every open table (data-explorer-view's createRegisters). ONE
// per extension host, made here once and imported by every document (matDocument.ts,
// binaryDocument.ts, jsonDocument.ts): a register made per document would give each its own
// clipboard, and a cut in one document would find nothing to paste in another. VS Code runs one
// extension host per window, which makes this one per window, as the editors' shared clipboard
// always was.
import { createRegisters } from 'data-explorer-view/model';

/** The window's registers, which every editor's engine is given. */
export const registers = createRegisters();
