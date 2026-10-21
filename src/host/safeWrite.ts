// Copyright 2026 The MathWorks, Inc.
//
// Writing a file over the user's own so that a crash part-way through cannot cost them it.
//
// VS Code's `workspace.fs.writeFile` truncates the file and then writes it, so a crash, a full
// disk or a killed extension host between the two leaves a file that is neither the old one nor
// the new one. For a text file VS Code accepts that; for a MAT-file, which nothing can repair by
// hand, it is the one way a save could break the file, so the save does what careful editors do:
// write the new bytes to a temporary file beside the old one, flush it, and rename it over the
// old one. A rename within one directory replaces the file in one step on every local file
// system, so the name holds the old file or the new one, whole, and nothing in between.
//
// Only where Node's fs is there and the uri is a `file:` one: the desktop extension host, and
// the remote side of a Remote window, where the file is on that machine's disk. Anywhere else
// (another file system provider, the web extension host) the write is `workspace.fs.writeFile`,
// as VS Code's own save would be: a provider's rename has the provider's semantics, and VS
// Code's own `rename` over an existing file deletes it first unless both are files.
//
// What a replace by rename changes, and what is done about each:
//   - the mode: the temporary file is created with the original's, so a file only its owner
//     could read stays so;
//   - the owner and group: set to the original's where the user may (best effort);
//   - a symbolic link: followed, and its target replaced, so the link still points at the file;
//   - a hard link: a replace would leave the other names on the old bytes, so a file with more
//     than one link is written in place, as is one whose directory takes no new file;
//   - a read-only file: refused, since a rename would replace it whatever its mode says.
//
// vscode-free, so that the replace is unit-tested against a real directory (test/safeWrite.test.ts):
// the write that is not a replace is handed in.
import type * as Fs from 'node:fs/promises';

/** How the bytes got there, for the caller and the tests. */
export type WriteMode = 'replaced' | 'in-place';

/** Node's promise fs, or undefined where there is none (the web extension host). */
async function nodeFs(): Promise<typeof Fs | undefined> {
  try {
    return await import('node:fs/promises');
  } catch {
    return undefined;
  }
}

/**
 * Write `bytes` as the file `uri` names, replacing it whole where the file system lets us, and
 * through `writeInPlace` (the provider's `workspace.fs.writeFile`) where it does not.
 */
export async function writeFileSafely(
  uri: { readonly scheme: string; readonly fsPath: string },
  bytes: Uint8Array,
  writeInPlace: () => PromiseLike<void>,
): Promise<WriteMode> {
  const fs = uri.scheme === 'file' ? await nodeFs() : undefined;
  if (fs) return replaceFile(fs, uri.fsPath, bytes);
  await writeInPlace();
  return 'in-place';
}

const errorCode = (err: unknown): string | undefined => (err as { code?: string } | null)?.code;

/** The directory part of a path, for either separator. */
function dirnameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at <= 0 ? path.slice(0, at + 1) || '.' : path.slice(0, at);
}

function basenameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/**
 * The replace itself, on Node's fs: exported for the unit tests, which run it against a real
 * temporary directory.
 */
export async function replaceFile(fs: typeof Fs, path: string, bytes: Uint8Array): Promise<WriteMode> {
  let target = path;
  // What of the original the replace carries over (and whether it has other names).
  let stat: { mode: number; uid: number; gid: number; nlink: number } | undefined;
  try {
    // Through a link to what it names: the link is the user's, and it stays.
    if ((await fs.lstat(path)).isSymbolicLink()) target = await fs.realpath(path);
    stat = await fs.stat(target);
  } catch (err) {
    // Not there (deleted since it was opened): a save recreates it, as VS Code's does.
    if (errorCode(err) !== 'ENOENT') throw err;
  }
  if (stat) {
    try {
      await fs.access(target, fs.constants.W_OK);
    } catch {
      throw new Error(`Cannot save "${basenameOf(path)}": the file is read-only. Nothing was written.`);
    }
    if (stat.nlink > 1) {
      await fs.writeFile(target, bytes);
      return 'in-place';
    }
  }
  const dir = dirnameOf(target);
  const temp = `${dir}/.${basenameOf(target)}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  let handle: Fs.FileHandle;
  try {
    handle = await fs.open(temp, 'wx', stat ? stat.mode & 0o7777 : 0o666);
  } catch (err) {
    // A directory that takes no new file, though the file in it is writable: the only write
    // there is is in place.
    const code = errorCode(err);
    if (stat && (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')) {
      await fs.writeFile(target, bytes);
      return 'in-place';
    }
    throw err;
  }
  try {
    try {
      await handle.writeFile(bytes);
      // The mode again: `open` applied the process umask to it.
      if (stat) await handle.chmod(stat.mode & 0o7777);
      if (stat) await handle.chown(stat.uid, stat.gid).catch(() => undefined);
      // On disk before the rename, or a crash after it could leave the new name on no data.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, target);
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    throw err;
  }
  // And the rename itself, where the platform lets a directory be flushed (not Windows).
  try {
    const dirHandle = await fs.open(dir, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    /* best effort */
  }
  return 'replaced';
}
