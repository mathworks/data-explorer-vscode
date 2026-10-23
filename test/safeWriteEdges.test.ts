// Copyright 2026 The MathWorks, Inc.
// The edges of a save's write over the user's file (src/host/safeWrite.ts) that
// test/safeWrite.test.ts beside this does not reach: the entry point a provider calls, the
// same-file question a Save As asks, where the temporary file is made for a path of either
// platform, and what each failure the replace can meet leaves behind.
//
// The rule every case here holds the write to: a failure leaves the user's file as it was and
// nothing beside it, and a fallback to the write in place happens only where a file was there to
// write over.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { replaceFile, sameFile, writeFileSafely } from '../src/host/safeWrite.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const bytes = (s: string) => new TextEncoder().encode(s);
const posix = process.platform !== 'win32';
const notRoot = posix && process.getuid?.() !== 0;
const fail = (code: string) => Object.assign(new Error(code), { code });
const withFs = (over: Partial<typeof fs>) => ({ ...fs, ...over }) as typeof fs;
const file = (fsPath: string) => ({ scheme: 'file', fsPath });

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dex-safewrite-edges-'));
  path = join(dir, 'data.mat');
  writeFileSync(path, 'old bytes');
  chmodSync(path, 0o644);
});

afterEach(() => {
  chmodSync(dir, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

describe('writeFileSafely', () => {
  it('replaces a file: uri through Node’s fs, and never calls the write it was handed', async () => {
    let handed = 0;
    const written = await writeFileSafely(file(path), bytes('new'), async () => {
      handed++;
    });
    expect(handed).toBe(0);
    expect(written.mode).toBe('replaced');
    const st = statSync(path);
    expect(written.stamp).toEqual({ mtime: st.mtime.getTime(), size: st.size });
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it.runIf(notRoot)('passes a refusal of the replace on, rather than falling back to the write it was handed', async () => {
    // A read-only file is refused by the replace; the provider's workspace.fs write would
    // succeed over it, which is exactly what must not happen.
    chmodSync(path, 0o444);
    let handed = 0;
    await expect(
      writeFileSafely(file(path), bytes('new'), async () => {
        handed++;
      }),
    ).rejects.toThrow(/read-only/);
    expect(handed).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });
});

describe('sameFile', () => {
  it('is true for one path, and for a hard link or a symbolic link to the same file', async () => {
    expect(await sameFile(file(path), file(path))).toBe(true);
    const hard = join(dir, 'hard.mat');
    linkSync(path, hard);
    expect(await sameFile(file(path), file(hard))).toBe(true);
    if (posix) {
      const soft = join(dir, 'soft.mat');
      symlinkSync(path, soft);
      expect(await sameFile(file(soft), file(path))).toBe(true);
    }
  });

  it('is false for two files, even with the same bytes', async () => {
    const other = join(dir, 'other.mat');
    writeFileSync(other, 'old bytes');
    expect(await sameFile(file(path), file(other))).toBe(false);
  });

  it('is false where it cannot be told: another scheme, or a file that is not there', async () => {
    expect(await sameFile({ scheme: 'vscode-vfs', fsPath: path }, file(path))).toBe(false);
    expect(await sameFile(file(path), { scheme: 'untitled', fsPath: path })).toBe(false);
    expect(await sameFile(file(path), file(join(dir, 'missing.mat')))).toBe(false);
  });
});

/**
 * A file system that records the paths it is asked about, with one existing file of `mode`,
 * owned by `uid`/`gid`, at whatever path it is asked about first. For the path arithmetic of a
 * platform this test may not run on.
 */
function recordingFs() {
  const calls: [string, string][] = [];
  const original = { mode: 0o100644, uid: 501, gid: 20, nlink: 1, mtime: new Date(1_000), size: 3 };
  const handle = {
    writeFile: async () => undefined,
    chmod: async () => undefined,
    chown: async () => undefined,
    sync: async () => undefined,
    close: async () => undefined,
    stat: async () => ({ ...original, mtime: new Date(2_000) }),
  };
  const fake = {
    constants: fs.constants,
    lstat: async (p: string) => (calls.push(['lstat', p]), { isSymbolicLink: () => false }),
    stat: async (p: string) => (calls.push(['stat', p]), original),
    access: async (p: string) => void calls.push(['access', p]),
    readdir: async (p: string) => (calls.push(['readdir', p]), []),
    open: async (p: string, flags: string) => (calls.push(['open:' + flags, p]), handle),
    rename: async (from: string, to: string) => void calls.push(['rename', `${from} -> ${to}`]),
    unlink: async (p: string) => void calls.push(['unlink', p]),
  };
  return { fs: fake as unknown as typeof fs, calls };
}

describe('the temporary file is made beside the file, on either platform', () => {
  const HEX = '[0-9a-f]{16}';
  // [the file, its directory]. A name is joined to a directory with `/` unless the directory
  // already ends in a separator (a root): Windows takes either separator, so the temporary file
  // is in the file's own directory either way, which is what makes the rename one step.
  const cases: [string, string][] = [
    ['C:\\Users\\me\\data.mat', 'C:\\Users\\me'],
    ['C:\\data.mat', 'C:\\'],
    ['\\\\server\\share\\data.mat', '\\\\server\\share'],
    ['C:/Users/me\\data.mat', 'C:/Users/me'],
    ['/home/me/data.mat', '/home/me'],
    ['/data.mat', '/'],
    ['data.mat', '.'],
  ];
  const escape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

  for (const [target, directory] of cases) {
    it(`${target}`, async () => {
      const { fs: fake, calls } = recordingFs();
      expect((await replaceFile(fake, target, bytes('new'))).mode).toBe('replaced');
      const temp = calls.find(([op]) => op === 'open:wx')![1];
      const sep = /[\\/]$/.test(directory) ? '' : '[\\\\/]';
      expect(temp).toMatch(new RegExp(`^${escape(directory)}${sep}\\.data\\.mat\\.${HEX}\\.dex-tmp$`));
      expect(calls).toContainEqual(['rename', `${temp} -> ${target}`]);
      // The crashed saves it sweeps up, and the directory it flushes, are that directory.
      expect(calls).toContainEqual(['readdir', directory]);
      expect(calls).toContainEqual(['open:r', directory]);
    });
  }
});

describe('replaceFile — what each failure leaves', () => {
  it.runIf(posix)('writes through an absolute link to nothing, and the link stays a link', async () => {
    const link = join(dir, 'link.mat');
    const made = join(dir, 'made.mat');
    symlinkSync(made, link);
    expect((await replaceFile(fs, link, bytes('new'))).mode).toBe('replaced');
    expect(readFileSync(made, 'utf8')).toBe('new');
    expect(readFileSync(link, 'utf8')).toBe('new');
  });

  it.runIf(posix)('refuses a link it cannot follow (a loop), and writes nothing', async () => {
    const loop = join(dir, 'loop.mat');
    symlinkSync('loop.mat', loop);
    await expect(replaceFile(fs, loop, bytes('new'))).rejects.toThrow(/ELOOP/);
    expect(readdirSync(dir).sort()).toEqual(['data.mat', 'loop.mat']);
  });

  it('a file it cannot even look at is refused, not created over', async () => {
    const blind = withFs({ lstat: async () => Promise.reject(fail('EACCES')) });
    await expect(replaceFile(blind, path, bytes('new'))).rejects.toThrow('EACCES');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it('a temporary file that fails to be written is removed, and the original is untouched', async () => {
    const real = fs.open;
    const fullDisk = withFs({
      open: (async (...args: Parameters<typeof fs.open>) => {
        const h = await real(...args);
        if (args[1] !== 'wx') return h;
        return Object.assign(Object.create(h), {
          writeFile: async () => Promise.reject(fail('ENOSPC')),
          close: () => h.close(),
        });
      }) as typeof fs.open,
    });
    await expect(replaceFile(fullDisk, path, bytes('new'))).rejects.toThrow('ENOSPC');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it('a temporary file the directory refuses for another reason is an error, not a write in place', async () => {
    const real = fs.open;
    const broken = withFs({
      open: (async (...args: Parameters<typeof fs.open>) =>
        args[1] === 'wx' ? Promise.reject(fail('EIO')) : real(...args)) as typeof fs.open,
    });
    await expect(replaceFile(broken, path, bytes('new'))).rejects.toThrow('EIO');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });

  it.runIf(notRoot)('a new file in a directory that takes none is an error: there is nothing to write in place', async () => {
    rmSync(path);
    chmodSync(dir, 0o555);
    await expect(replaceFile(fs, path, bytes('new'))).rejects.toThrow(/EACCES|EPERM/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a rename refused for a new file is an error, not a write in place', async () => {
    rmSync(path);
    const noRename = withFs({ rename: async () => Promise.reject(fail('EXDEV')) });
    await expect(replaceFile(noRename, path, bytes('new'))).rejects.toThrow('EXDEV');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a file deleted while the save falls back to writing in place is created again', async () => {
    // The rename is refused (EXDEV), and by then the file is gone: the write in place opens it
    // for update, finds nothing, and makes it, as VS Code's own save would.
    const goneThenRefused = withFs({
      rename: async () => {
        rmSync(path);
        return Promise.reject(fail('EXDEV'));
      },
    });
    expect((await replaceFile(goneThenRefused, path, bytes('new'))).mode).toBe('in-place');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it('a write in place that cannot open the file is an error, and the file keeps its bytes', async () => {
    linkSync(path, join(dir, 'other.mat'));
    const real = fs.open;
    const locked = withFs({
      open: (async (...args: Parameters<typeof fs.open>) =>
        args[1] === 'r+' ? Promise.reject(fail('EBUSY')) : real(...args)) as typeof fs.open,
    });
    await expect(replaceFile(locked, path, bytes('new'))).rejects.toThrow('EBUSY');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });

  it('a temporary file that cannot be removed does not hide the error that stopped the save', async () => {
    const stuck = withFs({
      rename: async () => Promise.reject(fail('EIO')),
      unlink: async () => Promise.reject(fail('EPERM')),
    });
    await expect(replaceFile(stuck, path, bytes('new'))).rejects.toThrow('EIO');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });

  it('a directory that cannot be flushed does not fail a save that has replaced the file', async () => {
    const real = fs.open;
    const noDirSync = withFs({
      open: (async (...args: Parameters<typeof fs.open>) =>
        args[1] === 'r' ? Promise.reject(fail('EISDIR')) : real(...args)) as typeof fs.open,
    });
    expect((await replaceFile(noDirSync, path, bytes('new'))).mode).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it('sweeps only temporary files of its own naming for this file', async () => {
    const old = new Date(Date.now() - 5 * 60_000);
    const names = [
      '.data.mat.0123456789abcdef.dex-tmp', // ours, stale: removed
      '.data.mat.backup.dex-tmp', // not a name this makes
      '.data.mat.FEDCBA9876543210.dex-tmp', // not lower-case hex (and not the first on a case-blind disk)
      '.other.mat.0123456789abcdef.dex-tmp', // another file's
      '.data.mat.0123456789abcdef.tmp', // another suffix
    ];
    for (const name of names) {
      writeFileSync(join(dir, name), 'x');
      utimesSync(join(dir, name), old, old);
    }
    await replaceFile(fs, path, bytes('new'));
    expect(readdirSync(dir).sort()).toEqual([...names.slice(1), 'data.mat'].sort());
  });

  it('an error with no code is never taken for a refusal the write in place stands in for', async () => {
    const real = fs.open;
    const noTemp = withFs({
      open: (async (...args: Parameters<typeof fs.open>) =>
        args[1] === 'wx' ? Promise.reject(new Error('odd')) : real(...args)) as typeof fs.open,
    });
    await expect(replaceFile(noTemp, path, bytes('new'))).rejects.toThrow('odd');
    const noRename = withFs({ rename: async () => Promise.reject(new Error('odd')) });
    await expect(replaceFile(noRename, path, bytes('new'))).rejects.toThrow('odd');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it('a sweep that cannot read the directory does not stop the save', async () => {
    const unreadable = withFs({ readdir: (async () => Promise.reject(fail('EACCES'))) as any });
    expect((await replaceFile(unreadable, path, bytes('new'))).mode).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });
});
