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
// The replace itself is core's (`replaceFile`, over the file system it is handed): the mode,
// owner and group kept, links followed, a read-only file refused, the write in place that never
// truncates first wherever a replace cannot be made, the temporary file and its sweep, and the
// stamp read off the written file. What is left here is this host's half: which uris get the
// replace, where Node's fs comes from, and the provider's write for the rest, and for a file
// whose folder is gone, which `workspace.fs.writeFile` recreates where it was, as VS Code's own
// save does.
//
// Node's fs is imported lazily, on the save path, because the web extension host has none: its
// bundle leaves the specifier external (esbuild.mjs), and test/moduleBoundaries.test.ts pins the
// two to each other. Core's barrel imports no fs at all, so it stays loadable in a browser.
import { replaceFile, sameFile as sameFileOn, type SaveFs, type Written } from 'data-explorer-core';

export type { Written } from 'data-explorer-core';

/** Node's promise fs, or undefined where there is none (the web extension host). */
async function nodeFs(): Promise<SaveFs | undefined> {
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
  if (fs) return replaceFile(fs, uri.fsPath, bytes, writeInPlace);
  await writeInPlace();
  return { mode: 'in-place' };
}

/** What a write of the user's file asks of the provider, where Node's fs does not make it. */
export interface ProviderWrite {
  /** Write the bytes over the file: `workspace.fs.writeFile`. */
  write(): PromiseLike<void>;
  /** The file's mtime+size, as `workspace.fs.stat` reports them, or undefined. */
  stat(): PromiseLike<{ mtime: number; size: number } | undefined>;
}

/**
 * Write the user's own file through `writeFileSafely`, and answer its mtime+size as this write
 * left them: what a save records, so that the watcher's event for the save's own write, and the
 * next save's check, find the disk matching.
 *
 * Read off the written file itself wherever the write could. A stat after the write would take an
 * outside write landing in between for this one, and the next save would then write over that
 * without asking. Only a write through the provider, which reads no stamp, is stat'd after it.
 *
 * The binary .sldd editor saves through this, by way of diskFollow's `writeUserFile`; a hot-exit
 * backup is a scratch copy, not the user's file, and is written plainly.
 */
export async function writeAndStamp(
  uri: { readonly scheme: string; readonly fsPath: string },
  bytes: Uint8Array,
  provider: ProviderWrite,
): Promise<{ mtime: number; size: number } | undefined> {
  return (await writeFileSafely(uri, bytes, () => provider.write())).stamp ?? (await provider.stat());
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
  return sameFileOn(fs, a.fsPath, b.fsPath);
}
