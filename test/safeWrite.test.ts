// Copyright 2026 The MathWorks, Inc.
// A save's write over the user's file (src/host/safeWrite.ts), as this host routes it: a `file:`
// uri is replaced through Node's fs by core's `replaceFile`, anything else is written by the
// provider, and the stamp a save records is read off the written file wherever it could be. The
// replace's own rules (the temporary file, what a rename would change, the write in place) are
// core's, and pinned there against a real directory (test/safeReplace.test.ts and
// test/safeReplaceEdges.test.ts in data-explorer-core).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAndStamp, writeFileSafely } from '../src/host/safeWrite.js';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('writeFileSafely', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-safewrite-'));
    path = join(dir, 'data.mat');
    writeFileSync(path, 'old bytes');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

describe('writeAndStamp', () => {
  // The stamp a save records for its own write (the binary .sldd editor's, through diskFollow's
  // writeUserFile): the watcher ignores an event that leaves the disk matching it, and the next
  // save asks before writing over a disk that does not.
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dex-safewrite-'));
    path = join(dir, 'params.sldd');
    writeFileSync(path, 'old bytes');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('answers the stamp read off the written file, and never stats the file after the write', async () => {
    // What a stat after the write would answer had another program written the file in between:
    // a stamp that is not this write's, which the next save would take for its own.
    let stats = 0;
    const stamp = await writeAndStamp({ scheme: 'file', fsPath: path }, bytes('new'), {
      write: async () => {
        throw new Error('a file on this disk is written by Node’s fs, not the provider');
      },
      stat: async () => {
        stats++;
        return { mtime: 1, size: 1 };
      },
    });
    const st = statSync(path);
    expect(stamp).toEqual({ mtime: st.mtime.getTime(), size: st.size });
    expect(stats).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it('a file written in place answers its stamp too', async () => {
    linkSync(path, join(dir, 'alias.sldd'));
    const stamp = await writeAndStamp({ scheme: 'file', fsPath: path }, bytes('newer'), {
      write: async () => undefined,
      stat: async () => ({ mtime: 1, size: 1 }),
    });
    const st = statSync(path);
    expect(stamp).toEqual({ mtime: st.mtime.getTime(), size: st.size });
  });

  it('writes a uri that is not a file on this disk through the provider, and stats it after, the one stamp there is', async () => {
    const calls: string[] = [];
    const stamp = await writeAndStamp({ scheme: 'vscode-vfs', fsPath: path }, bytes('new'), {
      write: async () => void calls.push('write'),
      stat: async () => (calls.push('stat'), { mtime: 7, size: 3 }),
    });
    expect(calls).toEqual(['write', 'stat']);
    expect(stamp).toEqual({ mtime: 7, size: 3 });
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });

  it('stats a file whose folder was gone, which the provider wrote', async () => {
    const at = join(dir, 'sub', 'params.sldd');
    const calls: string[] = [];
    const stamp = await writeAndStamp({ scheme: 'file', fsPath: at }, bytes('new'), {
      write: async () => {
        calls.push('write');
        mkdirSync(join(dir, 'sub'));
        writeFileSync(at, 'new');
      },
      stat: async () => (calls.push('stat'), { mtime: 7, size: 3 }),
    });
    expect(calls).toEqual(['write', 'stat']);
    expect(stamp).toEqual({ mtime: 7, size: 3 });
  });

  it('a write that fails answers nothing and stats nothing', async () => {
    let stats = 0;
    await expect(
      writeAndStamp({ scheme: 'vscode-vfs', fsPath: path }, bytes('new'), {
        write: async () => Promise.reject(new Error('disk full')),
        stat: async () => (stats++, undefined),
      }),
    ).rejects.toThrow('disk full');
    expect(stats).toBe(0);
  });
});
