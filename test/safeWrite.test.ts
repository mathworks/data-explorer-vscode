// Copyright 2026 The MathWorks, Inc.
// A save's write over the user's file (src/host/safeWrite.ts): a temporary file beside it,
// flushed and renamed over it, against a real directory, with the cases where a replace would
// change something the user owns, and the write in place that stands in where a replace cannot
// be made.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  chmodSync,
  linkSync,
  lstatSync,
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
import { replaceFile, writeFileSafely } from '../src/host/safeWrite.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const posix = process.platform !== 'win32';
const notRoot = posix && process.getuid?.() !== 0;
const fail = (code: string) => Object.assign(new Error(code), { code });

/** `fs` with one of its functions replaced. */
const withFs = (over: Partial<typeof fs>) => ({ ...fs, ...over }) as typeof fs;

/** `fs` whose file handles have some of their methods replaced. */
function withHandles(over: (h: fs.FileHandle) => Partial<fs.FileHandle>): typeof fs {
  return withFs({
    open: (async (...args: Parameters<typeof fs.open>) => {
      const h = await fs.open(...args);
      return new Proxy(h, {
        get(target, key) {
          const replaced = (over(target) as any)[key];
          if (replaced) return replaced;
          const value = (target as any)[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }) as typeof fs.open,
  });
}

describe('replaceFile', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-safewrite-'));
    path = join(dir, 'data.mat');
    writeFileSync(path, 'old bytes');
    chmodSync(path, 0o644);
  });

  afterEach(() => {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the file whole and leaves nothing beside it', async () => {
    expect((await replaceFile(fs, path, bytes('new'))).mode).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it('answers the stamp the written file has, as workspace.fs.stat reports it', async () => {
    const { stamp } = await replaceFile(fs, path, bytes('new'));
    const st = statSync(path);
    expect(stamp).toEqual({ mtime: st.mtime.getTime(), size: st.size });
  });

  it.runIf(posix)('keeps the mode of the file it replaces', async () => {
    chmodSync(path, 0o640);
    await replaceFile(fs, path, bytes('new'));
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  it.runIf(posix)('a chmod the mount refuses does not stop the save', async () => {
    // As SMB, exFAT and some FUSE mounts refuse it. The temporary file was made with the mode
    // already, so the replace still keeps it.
    const noChmod = withHandles(() => ({ chmod: async () => Promise.reject(fail('EPERM')) }));
    chmodSync(path, 0o600);
    expect((await replaceFile(noChmod, path, bytes('new'))).mode).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.runIf(posix)('a mode it cannot give the replacement is kept by writing in place', async () => {
    // The umask took a bit off the new file's mode, and the chmod that would put it back is refused.
    const noChmod = withHandles((h) => ({
      chmod: async () => Promise.reject(fail('EPERM')),
      stat: (async () => {
        const st = await h.stat();
        return Object.assign(st, { mode: st.mode & ~0o020 });
      }) as any,
    }));
    chmodSync(path, 0o664);
    const ino = statSync(path).ino;
    expect((await replaceFile(noChmod, path, bytes('new'))).mode).toBe('in-place');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(statSync(path).ino).toBe(ino);
    expect(statSync(path).mode & 0o777).toBe(0o664);
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it('an owner or group it cannot give the replacement is kept by writing in place', async () => {
    // A setgid or shared directory: the new file would belong to another group, and the chown
    // that would fix it is refused.
    const st = statSync(path);
    const otherGroup = withHandles((h) => ({
      stat: (async () => Object.assign(await h.stat(), { gid: st.gid + 1 })) as any,
      chown: async () => Promise.reject(fail('EPERM')),
    }));
    expect((await replaceFile(otherGroup, path, bytes('new'))).mode).toBe('in-place');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(statSync(path).ino).toBe(st.ino);
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it.runIf(posix)('replaces what a symbolic link names, and the link stays a link', async () => {
    const link = join(dir, 'link.mat');
    symlinkSync(path, link);
    expect((await replaceFile(fs, link, bytes('new'))).mode).toBe('replaced');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it.runIf(posix)('writes through a link to nothing, and the link stays a link', async () => {
    const link = join(dir, 'link.mat');
    symlinkSync('made.mat', link);
    await replaceFile(fs, link, bytes('new'));
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dir, 'made.mat'), 'utf8')).toBe('new');
  });

  it.runIf(posix)('writes a file with another hard link in place, so both names see the save', async () => {
    const other = join(dir, 'other.mat');
    linkSync(path, other);
    expect((await replaceFile(fs, path, bytes('new'))).mode).toBe('in-place');
    expect(readFileSync(other, 'utf8')).toBe('new');
  });

  it.runIf(notRoot)('refuses a read-only file, which a rename would replace anyway', async () => {
    chmodSync(path, 0o444);
    await expect(replaceFile(fs, path, bytes('new'))).rejects.toThrow(/read-only/);
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it.runIf(notRoot)('writes in place where the directory takes no new file', async () => {
    chmodSync(dir, 0o555);
    expect((await replaceFile(fs, path, bytes('new'))).mode).toBe('in-place');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  for (const code of ['EPERM', 'EBUSY', 'EXDEV', 'EACCES', 'ENOTSUP']) {
    it(`a rename the file system refuses (${code}) is written in place instead`, async () => {
      const noRename = withFs({ rename: async () => Promise.reject(fail(code)) });
      expect((await replaceFile(noRename, path, bytes('new'))).mode).toBe('in-place');
      expect(readFileSync(path, 'utf8')).toBe('new');
      expect(readdirSync(dir)).toEqual(['data.mat']);
    });
  }

  it('a rename that fails otherwise leaves the original as it was and removes the temporary file', async () => {
    const noRename = withFs({ rename: async () => Promise.reject(fail('EIO')) });
    await expect(replaceFile(noRename, path, bytes('new'))).rejects.toThrow('EIO');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it.runIf(posix)('in place never truncates first: a write that fails leaves the old bytes', async () => {
    const other = join(dir, 'other.mat');
    linkSync(path, other);
    const fullDisk = withHandles(() => ({ write: async () => Promise.reject(fail('ENOSPC')) }) as any);
    await expect(replaceFile(fullDisk, path, bytes('new'))).rejects.toThrow('ENOSPC');
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });

  it.runIf(posix)('in place cuts a longer file to the new length', async () => {
    linkSync(path, join(dir, 'other.mat'));
    await replaceFile(fs, path, bytes('ab'));
    expect(readFileSync(path, 'utf8')).toBe('ab');
  });

  it('creates a file that is no longer there', async () => {
    rmSync(path);
    expect((await replaceFile(fs, path, bytes('new'))).mode).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it('removes the temporary file a crashed save left, and not one another save is writing', async () => {
    const stale = join(dir, '.data.mat.0123456789abcdef.dex-tmp');
    const fresh = join(dir, '.data.mat.fedcba9876543210.dex-tmp');
    writeFileSync(stale, 'x');
    writeFileSync(fresh, 'x');
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(stale, old, old);
    await replaceFile(fs, path, bytes('new'));
    expect(readdirSync(dir).sort()).toEqual(['.data.mat.fedcba9876543210.dex-tmp', 'data.mat']);
  });

  it('writes through the caller for a uri that is not a file on this disk', async () => {
    let wrote = 0;
    const written = await writeFileSafely({ scheme: 'vscode-vfs', fsPath: path }, bytes('new'), async () => {
      wrote++;
    });
    expect(written).toEqual({ mode: 'in-place' });
    expect(wrote).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });
});
