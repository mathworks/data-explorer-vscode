// Copyright 2026 The MathWorks, Inc.
// A save's write over the user's file (src/host/safeWrite.ts): a temporary file beside it,
// flushed and renamed over it, against a real directory, with the cases where a replace would
// change something the user owns.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { linkSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { replaceFile, writeFileSafely } from '../src/host/safeWrite.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const posix = process.platform !== 'win32';

describe('replaceFile', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-safewrite-'));
    path = join(dir, 'data.mat');
    writeFileSync(path, 'old');
  });

  afterEach(() => {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the file whole and leaves nothing beside it', async () => {
    expect(await replaceFile(fs, path, bytes('new'))).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it.runIf(posix)('keeps the mode of the file it replaces', async () => {
    chmodSync(path, 0o640);
    await replaceFile(fs, path, bytes('new'));
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  it.runIf(posix)('replaces what a symbolic link names, and the link stays a link', async () => {
    const link = join(dir, 'link.mat');
    symlinkSync(path, link);
    expect(await replaceFile(fs, link, bytes('new'))).toBe('replaced');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it.runIf(posix)('writes a file with another hard link in place, so both names see the save', async () => {
    const other = join(dir, 'other.mat');
    linkSync(path, other);
    expect(await replaceFile(fs, path, bytes('new'))).toBe('in-place');
    expect(readFileSync(other, 'utf8')).toBe('new');
  });

  it.runIf(posix && process.getuid?.() !== 0)('refuses a read-only file, which a rename would replace anyway', async () => {
    chmodSync(path, 0o444);
    await expect(replaceFile(fs, path, bytes('new'))).rejects.toThrow(/read-only/);
    expect(readFileSync(path, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it.runIf(posix && process.getuid?.() !== 0)('writes in place where the directory takes no new file', async () => {
    chmodSync(dir, 0o555);
    expect(await replaceFile(fs, path, bytes('new'))).toBe('in-place');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it('a failed rename leaves the original as it was and removes the temporary file', async () => {
    const failing = { ...fs, rename: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } } as typeof fs;
    await expect(replaceFile(failing, path, bytes('new'))).rejects.toThrow('busy');
    expect(readFileSync(path, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });

  it('creates a file that is no longer there', async () => {
    rmSync(path);
    expect(await replaceFile(fs, path, bytes('new'))).toBe('replaced');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it('writes through the caller for a uri that is not a file on this disk', async () => {
    let wrote = 0;
    const mode = await writeFileSafely({ scheme: 'vscode-vfs', fsPath: path }, bytes('new'), async () => {
      wrote++;
    });
    expect(mode).toBe('in-place');
    expect(wrote).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('old');
  });
});
