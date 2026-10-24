// Copyright 2026 The MathWorks, Inc.
//
// Search reads a file's names one of two ways (nameScan.namesOfFile): from the unsaved buffer of
// an open document, scanned on the spot, or from the disk bytes through the shared cheap tier.
// Its header promises that the two are the same scanners, "so a buffer and a saved file yield
// the same records". That is a rule with two paths, so it is asked of both here, on every kind of
// data file search reads: a buffer holding exactly the bytes on disk must give exactly the
// records the disk gives. And a file of a kind search has no reader for gives nothing either
// way, without its bytes being read.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { namesOfFile, type NameReader } from '../src/host/nameScan.js';
import { newSourceCache, type SourceFile } from '../src/host/sourceCache.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });

let reads: string[];
let buffers: Map<string, ArrayBuffer>;
let disk: Map<string, ArrayBuffer>;

const reader: NameReader = {
  version: async (f) => `v1:${f.path}`,
  bytes: async (f) => {
    reads.push(f.path);
    return disk.get(f.path) ?? bytesOf(f.path.slice('/fx/'.length));
  },
  dirtyBytes: (f) => buffers.get(f.uriString) ?? null,
};

beforeEach(() => {
  reads = [];
  buffers = new Map();
  disk = new Map();
});

describe('a buffer holding the disk bytes gives the records the disk gives', () => {
  // A textual and a compressed dictionary, one with nested data, and MAT-files.
  for (const name of ['params.sldd', 'chain_top.sldd', 'nested_objects.sldd', 'arch.sldd', 'nd_numeric.mat', 'mcos/Param.mat']) {
    it(name, async () => {
      const f = file(name);
      const fromDisk = await namesOfFile(newSourceCache(), reader, f);
      expect(reads).toEqual([f.path]);
      buffers.set(f.uriString, bytesOf(name));
      reads = [];
      const fromBuffer = await namesOfFile(newSourceCache(), reader, f);
      expect(reads, 'the buffer is read instead of the disk').toEqual([]);
      expect(fromBuffer).toEqual(fromDisk);
    });
  }

  it('(control) the fixtures do hold names, so the agreement is about something', async () => {
    for (const name of ['params.sldd', 'nd_numeric.mat']) {
      expect((await namesOfFile(newSourceCache(), reader, file(name))).length, name).toBeGreaterThan(0);
    }
  });
});

describe('a file of a kind search has no reader for gives nothing, and is not read', () => {
  for (const name of ['project.prj', 'notes.txt', 'script.m']) {
    it(`${name}, saved or with an unsaved buffer`, async () => {
      const f = file(name);
      disk.set(f.path, new TextEncoder().encode('Kp = 1;').buffer as ArrayBuffer);
      expect(await namesOfFile(newSourceCache(), reader, f)).toEqual([]);
      buffers.set(f.uriString, new TextEncoder().encode('Kp = 2;').buffer as ArrayBuffer);
      expect(await namesOfFile(newSourceCache(), reader, f)).toEqual([]);
      expect(reads).toEqual([]);
    });
  }
});
