// Copyright 2026 The MathWorks, Inc.
// How a WORKSPACE-WIDE SCAN reads files — which is not how a TAB reads one.
//
// Three scans span the whole folder: the sections tree's reference graph, the usage
// graph, and the name index. None of them was asked for by name: opening a folder
// (or restoring a tab in one) starts them, over whatever files happen to be there.
// A tab is the opposite — the user named one file and is waiting for it — so a tab
// reads whole files eagerly and a scan must not.
//
// Both rules here exist because a scan over a folder of large dictionaries took the
// extension host to ~2 GB in under two seconds and killed it, closing the window with
// no error anywhere: 122 files were read concurrently and held at once, one of them
// 826 MB, for a pass that only wanted names and reference lists.
//
// The cap is not a heuristic about what is "too big to bother with". A textual `.sldd`
// above V8's maximum string length cannot be turned into a string at all, so no
// scan can read one byte of meaning out of it however long it waits — the read, the
// copy, and the decode attempt are pure cost. Files above the cap therefore still
// appear (the tree lists them, they open in their own tab, where the editor routes an
// undecodable dictionary to VS Code's own text editor); they just contribute no
// relationships, which is the same thing they contributed before, at ~2 GB less.
import * as vscode from 'vscode';

// The batching half, kept vscode-free so vitest can pin its order contract. Re-exported
// because a caller wants ONE import for "how a scan reads": the cap and the batch size
// are one policy, and splitting the import would let a new scan adopt half of it.
export { mapLimited, SCAN_READ_CONCURRENCY } from './mapLimited.js';

/**
 * The largest file any workspace-wide scan will read.
 *
 * V8's maximum string length (`0x1fffffe8`) — the point past which a textual
 * dictionary cannot be decoded, so scanning it cannot succeed no matter what the
 * scan does with the bytes.
 */
export const MAX_SCAN_BYTES = 0x1fffffe8;

/**
 * Read a file for a scan, or `null` if it should not be scanned at all — too large
 * (see `MAX_SCAN_BYTES`) or unreadable.
 *
 * The size is taken from `stat` rather than from the bytes, so an oversized file is
 * never read: checking after the read is checking after the cost.
 */
export async function readForScan(uri: vscode.Uri): Promise<Uint8Array | null> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_SCAN_BYTES) return null;
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    // Unreadable (permissions, deleted mid-scan) — the caller treats it the same as
    // oversized: the file is still a node, it just has nothing to say.
    return null;
  }
}
