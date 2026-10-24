// Copyright 2026 The MathWorks, Inc.
//
// The id a writable byte-backed view (the compressed-binary .sldd and the MAT-file) gives
// VS Code for a hot-exit backup, and how a restore reads it back.
//
// VS Code hands the id back to `openCustomDocument` when it restores the backup, after a
// restart that can be days later, and that is the only thing it hands back. So the id has to
// carry what the restored document needs besides the backup's bytes: the stamp of the file the
// backed-up edits were made over (diskConflict.ts). A restore that took the file's stamp as it
// is NOW instead would take whatever another program wrote in between for the version the
// edits were made over, and its first save would write over that, without asking. With the
// backup's stamp, that save finds the file changed and asks, as it would have in the session
// that made the edits.
//
// The id is JSON, `{ backup, stamp }`. An id that is not (a bare uri: what the binary .sldd view
// wrote before its id carried the stamp) still restores, with no stamp, which `changedOnDisk`
// takes as no answer and so as no conflict: what such a restore did before.
//
// vscode-free, so that the format is unit-tested (test/backupId.test.ts): the uris are their
// strings, which `vscode.Uri.parse` turns back into the uri.
import type { DiskStamp } from './diskConflict.js';

/**
 * A backup's id: where it is, and the stamp of the file the document was last read or saved
 * as. Read back by `backupSource`.
 */
export function backupId(destination: string, stamp: DiskStamp | undefined): string {
  return JSON.stringify({ backup: destination, stamp: stamp ? { mtime: stamp.mtime, size: stamp.size } : null });
}

/** Where a backup id points, and its stamp, or none for an id this editor did not write. */
export function backupSource(id: string): { uri: string; stamp: DiskStamp | undefined } {
  try {
    const parsed = JSON.parse(id) as { backup?: unknown; stamp?: { mtime?: unknown; size?: unknown } | null } | null;
    if (typeof parsed?.backup === 'string') {
      const s = parsed.stamp;
      const stamp = s && typeof s.mtime === 'number' && typeof s.size === 'number' ? { mtime: s.mtime, size: s.size } : undefined;
      return { uri: parsed.backup, stamp };
    }
  } catch {
    /* a bare uri */
  }
  return { uri: id, stamp: undefined };
}
