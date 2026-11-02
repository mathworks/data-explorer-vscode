// Copyright 2026 The MathWorks, Inc.
// The edges of a save's write over the user's file (src/host/safeWrite.ts) that
// test/safeWrite.test.ts beside this does not reach: the entry point a provider calls, and the
// same-file question a Save As asks, both through this host's uris. Where the temporary file is
// made for a path of either platform, what each failure the replace can meet leaves behind, and
// which paths are one file (a hard or a symbolic link, a file that is not there), are core's, and
// pinned there (test/safeReplaceEdges.test.ts in data-explorer-core).
//
// The rule every case here holds the write to: a failure leaves the user's file as it was, and a
// refusal of the replace is never handed on to the provider's write.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sameFile, writeFileSafely } from '../src/host/safeWrite.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const posix = process.platform !== 'win32';
const notRoot = posix && process.getuid?.() !== 0;
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

// What is left here is the wrapper's: it answers for file: uris, by their paths, and for no other
// scheme.
describe('sameFile', () => {
  it('is true for one file named by two file: uris', async () => {
    expect(await sameFile(file(path), file(path))).toBe(true);
  });

  it('is false for a uri of another scheme, which it cannot tell', async () => {
    expect(await sameFile({ scheme: 'vscode-vfs', fsPath: path }, file(path))).toBe(false);
    expect(await sameFile(file(path), { scheme: 'untitled', fsPath: path })).toBe(false);
  });
});
