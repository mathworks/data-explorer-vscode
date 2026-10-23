// Copyright 2026 The MathWorks, Inc.
// Where there is no Node fs (the web extension host), a save of a `file:` uri is the write the
// provider hands in, as VS Code's own save would be, and a Save As cannot tell two names for one
// file apart, so it treats them as two (src/host/safeWrite.ts). Its own file, because the only
// way to take `node:fs/promises` away is to mock it for the whole module graph.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:fs/promises', () => {
  throw new Error('no Node fs here');
});

const { sameFile, writeFileSafely } = await import('../src/host/safeWrite.js');

describe('safeWrite without Node’s fs', () => {
  it('writes a file: uri through the write it was handed, and touches the disk no other way', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dex-safewrite-nofs-'));
    const path = join(dir, 'data.mat');
    writeFileSync(path, 'old bytes');
    try {
      let handed = 0;
      const written = await writeFileSafely({ scheme: 'file', fsPath: path }, new Uint8Array([1]), async () => {
        handed++;
      });
      expect(written).toEqual({ mode: 'in-place' });
      expect(handed).toBe(1);
      expect(readFileSync(path, 'utf8')).toBe('old bytes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cannot tell that two file: uris name one file, so says they do not', async () => {
    expect(await sameFile({ scheme: 'file', fsPath: '/x' }, { scheme: 'file', fsPath: '/x' })).toBe(false);
  });
});
