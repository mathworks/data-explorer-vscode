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
// as VS Code's own save would be, with that write's limit: a crash part-way through can leave
// the file short. A provider's rename has the provider's semantics, and VS Code's own disk
// provider deletes an existing target first unless both are files (as of VS Code 1.140), so a
// replace through `workspace.fs` would be no safer.
//
// What a replace by rename changes, and what is done about each:
//   - the mode, owner and group: the temporary file is given the original's. Where one of them
//     cannot be kept (an owner the user cannot give a file, a mount that takes no chmod), the
//     replace is not made, and the file is written in place instead: a save never changes who
//     may read or write a file;
//   - extended attributes, ACLs and Finder tags: a replace does not carry them over, and Node
//     can neither read nor set them, so a file that has them loses them at its first save;
//   - a symbolic link: followed, a dangling one too, and what it names replaced, so the link
//     still points at the file;
//   - a hard link: a replace would leave the other names on the old bytes, so a file with more
//     than one link is written in place;
//   - a read-only file: refused, since a rename would replace it whatever its mode says.
//
// IN PLACE never truncates first: the file is opened for update, the new bytes written over the
// old from the start, and only then cut to their length, so a full disk or a crash leaves the
// new bytes over the old ones rather than an empty file. It is the fallback wherever a replace
// cannot be made and VS Code's own save would still succeed: a hard link, a directory that takes
// no new file, a mount that takes no chmod or chown, and a rename the file system refuses
// (EPERM, EBUSY, EXDEV, EACCES, ENOTSUP: OneDrive or a virus scanner holding the file on
// Windows, a bind-mounted file in a container, some network and FUSE mounts).
//
// A temporary file a crash leaves behind (`.<name>.<random>.dex-tmp`, beside the file) is removed
// by the next save of the same file.
//
// vscode-free, so that the replace is unit-tested against a real directory (test/safeWrite.test.ts):
// the write that is not a replace is handed in.
import type * as Fs from 'node:fs/promises';

/** How the bytes got there, and the file's mtime+size as the write left them. */
export interface Written {
  mode: 'replaced' | 'in-place';
  /**
   * Read off the written file itself before it took the name (a replace) or before it was closed
   * (in place), so an outside write that lands just after cannot be taken for this one. In the
   * units `workspace.fs.stat` reports. Absent for a write through `workspace.fs`.
   */
  stamp?: { mtime: number; size: number };
}

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
): Promise<Written> {
  const fs = uri.scheme === 'file' ? await nodeFs() : undefined;
  if (fs) return replaceFile(fs, uri.fsPath, bytes);
  await writeInPlace();
  return { mode: 'in-place' };
}

/**
 * Whether two `file:` uris name one file (one path, or two hard links to it). False where it
 * cannot be told.
 */
export async function sameFile(
  a: { readonly scheme: string; readonly fsPath: string },
  b: { readonly scheme: string; readonly fsPath: string },
): Promise<boolean> {
  if (a.scheme !== 'file' || b.scheme !== 'file') return false;
  const fs = await nodeFs();
  if (!fs) return false;
  try {
    const [x, y] = await Promise.all([fs.stat(a.fsPath), fs.stat(b.fsPath)]);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

const errorCode = (err: unknown): string | undefined => (err as { code?: string } | null)?.code;

/** A temporary file cannot be made in the directory, though the file in it is writable. */
const NO_TEMP = new Set(['EACCES', 'EPERM', 'EROFS']);
/** The file system refuses the rename, though a write to the file would succeed. */
const NO_RENAME = new Set(['EPERM', 'EBUSY', 'EXDEV', 'EACCES', 'ENOTSUP']);
const TEMP_SUFFIX = '.dex-tmp';
/** How old a temporary file must be before a save takes it for one a crash left. */
const STALE_TEMP_MS = 60_000;

/** The directory part of a path, for either separator: `/` for `/x`, `C:\` for `C:\x`. */
function dirnameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (at < 0) return '.';
  const dir = path.slice(0, at);
  return dir === '' || dir.endsWith(':') ? path.slice(0, at + 1) : dir;
}

function basenameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function joinTo(dir: string, name: string): string {
  return /[\\/]$/.test(dir) ? dir + name : `${dir}/${name}`;
}

const isAbsolute = (p: string) => p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p);

/** What a symbolic link names, whether or not that is there. */
async function linkTarget(fs: typeof Fs, link: string): Promise<string> {
  try {
    return await fs.realpath(link);
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') throw err;
    const to = await fs.readlink(link);
    return isAbsolute(to) ? to : joinTo(dirnameOf(link), to);
  }
}

function tempNameFor(target: string): string {
  const random = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  return joinTo(dirnameOf(target), `.${basenameOf(target)}.${random}${TEMP_SUFFIX}`);
}

/** Remove the temporary files a crashed save of `target` left beside it. Best effort. */
async function removeStaleTemps(fs: typeof Fs, target: string): Promise<void> {
  const dir = dirnameOf(target);
  const prefix = `.${basenameOf(target)}.`;
  try {
    for (const name of await fs.readdir(dir)) {
      if (!name.startsWith(prefix) || !name.endsWith(TEMP_SUFFIX)) continue;
      if (!/^[0-9a-f]{16}$/.test(name.slice(prefix.length, -TEMP_SUFFIX.length))) continue;
      const path = joinTo(dir, name);
      // Not one another window is writing right now.
      if (Date.now() - (await fs.stat(path)).mtimeMs < STALE_TEMP_MS) continue;
      await fs.unlink(path);
    }
  } catch {
    /* best effort */
  }
}

const stampOf = (st: { mtime: Date; size: number }) => ({ mtime: st.mtime.getTime(), size: st.size });

/**
 * The write in place: over the old bytes from the start, then cut to the new length, never
 * truncated first. Creates the file where it is not there.
 */
async function writeInPlace(fs: typeof Fs, target: string, bytes: Uint8Array): Promise<Written> {
  let handle: Fs.FileHandle;
  try {
    handle = await fs.open(target, 'r+');
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') throw err;
    handle = await fs.open(target, 'wx');
  }
  try {
    for (let at = 0; at < bytes.byteLength; ) {
      const { bytesWritten } = await handle.write(bytes, at, bytes.byteLength - at, at);
      at += bytesWritten;
    }
    await handle.truncate(bytes.byteLength);
    await handle.sync();
    return { mode: 'in-place', stamp: stampOf(await handle.stat()) };
  } finally {
    await handle.close();
  }
}

/**
 * Give the temporary file the original's mode, owner and group, each best effort, and answer
 * whether it now has all three. The mode again because `open` applied the process umask.
 */
async function keepsAccess(handle: Fs.FileHandle, original: { mode: number; uid: number; gid: number }): Promise<boolean> {
  const mode = original.mode & 0o7777;
  await handle.chmod(mode).catch(() => undefined);
  let now = await handle.stat();
  if (now.uid !== original.uid || now.gid !== original.gid) {
    await handle.chown(original.uid, original.gid).catch(() => undefined);
    now = await handle.stat();
  }
  return (now.mode & 0o7777) === mode && now.uid === original.uid && now.gid === original.gid;
}

/**
 * The replace itself, on Node's fs: exported for the unit tests, which run it against a real
 * temporary directory.
 */
export async function replaceFile(fs: typeof Fs, path: string, bytes: Uint8Array): Promise<Written> {
  let target = path;
  // What of the original the replace carries over (and whether it has other names).
  let stat: { mode: number; uid: number; gid: number; nlink: number } | undefined;
  try {
    // Through a link to what it names: the link is the user's, and it stays.
    if ((await fs.lstat(path)).isSymbolicLink()) target = await linkTarget(fs, path);
    stat = await fs.stat(target);
  } catch (err) {
    // Not there (deleted since it was opened, or a link to nothing yet): a save creates it,
    // as VS Code's does.
    if (errorCode(err) !== 'ENOENT') throw err;
  }
  if (stat) {
    try {
      await fs.access(target, fs.constants.W_OK);
    } catch {
      throw new Error(`Cannot save "${basenameOf(path)}": the file is read-only. Nothing was written.`);
    }
    if (stat.nlink > 1) return writeInPlace(fs, target, bytes);
  }
  await removeStaleTemps(fs, target);
  const temp = tempNameFor(target);
  let handle: Fs.FileHandle;
  try {
    handle = await fs.open(temp, 'wx', stat ? stat.mode & 0o7777 : 0o666);
  } catch (err) {
    if (stat && NO_TEMP.has(errorCode(err) ?? '')) return writeInPlace(fs, target, bytes);
    throw err;
  }
  let written: Written['stamp'];
  let kept = true;
  try {
    try {
      await handle.writeFile(bytes);
      if (stat) kept = await keepsAccess(handle, stat);
      if (kept) {
        // On disk before the rename, or a crash after it could leave the new name on no data.
        await handle.sync();
        written = stampOf(await handle.stat());
      }
    } finally {
      await handle.close();
    }
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    throw err;
  }
  if (!kept) {
    await fs.unlink(temp).catch(() => undefined);
    return writeInPlace(fs, target, bytes);
  }
  try {
    await fs.rename(temp, target);
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    if (stat && NO_RENAME.has(errorCode(err) ?? '')) return writeInPlace(fs, target, bytes);
    throw err;
  }
  // And the rename itself, where the platform lets a directory be flushed (not Windows).
  try {
    const dirHandle = await fs.open(dirnameOf(target), 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    /* best effort */
  }
  return { mode: 'replaced', stamp: written };
}
