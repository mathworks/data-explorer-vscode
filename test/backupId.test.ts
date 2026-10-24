// Copyright 2026 The MathWorks, Inc.
//
// The hot-exit backup id of the two writable byte-backed views (src/host/backupId.ts): where the
// backup is, and the stamp of the file its edits were made over, which a restore's first save
// compares the file with. What a restore then does with them is exercised in real VS Code
// (test-integration/suite/binarySlddSaveSafety.test.ts, matEdit.test.ts).
import { describe, it, expect } from 'vitest';
import { backupId, backupSource } from '../src/host/backupId.js';

const where = 'file:///Users/me/Library/Application%20Support/Code/Backups/abc/custom/1a2b';
const stamp = { mtime: 1_700_000_000_123, size: 4096 };

describe('backupId / backupSource', () => {
  it('reads back where the backup is and the stamp it was written with', () => {
    expect(backupSource(backupId(where, stamp))).toEqual({ uri: where, stamp });
  });

  it('carries no stamp for a document that never read one (a file it could not stat)', () => {
    expect(backupSource(backupId(where, undefined))).toEqual({ uri: where, stamp: undefined });
  });

  it('keeps only the two numbers of the stamp', () => {
    const extra = { ...stamp, ctime: 1 } as typeof stamp;
    expect(JSON.parse(backupId(where, extra))).toEqual({ backup: where, stamp });
  });

  it('is the MAT-file editor’s format, so a backup either view wrote restores through either', () => {
    // The shape that editor's own copy writes: JSON.stringify({ backup, stamp: stamp ?? null }).
    expect(backupId(where, stamp)).toBe(JSON.stringify({ backup: where, stamp }));
    expect(backupId(where, undefined)).toBe(JSON.stringify({ backup: where, stamp: null }));
  });

  it('reads a bare uri, the id the binary .sldd view wrote before, as that uri with no stamp', () => {
    expect(backupSource(where)).toEqual({ uri: where, stamp: undefined });
  });

  it('reads JSON that is not one of its ids as a bare id, whole', () => {
    for (const id of ['null', '42', '"file:///x.sldd"', '{"stamp":{"mtime":1,"size":2}}', '{"backup":7}']) {
      expect(backupSource(id), id).toEqual({ uri: id, stamp: undefined });
    }
  });

  it('drops a stamp it cannot read rather than guess at one', () => {
    for (const s of [{ mtime: '1', size: 2 }, { mtime: 1 }, { size: 2 }, 'stamp', 0]) {
      const id = JSON.stringify({ backup: where, stamp: s });
      expect(backupSource(id), id).toEqual({ uri: where, stamp: undefined });
    }
  });
});
