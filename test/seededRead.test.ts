// Copyright 2026 The MathWorks, Inc.
//
// A file that has already been read is not read again to open its tab.
//
// `BinaryEditorProvider.resolveCustomEditor` must read a whole `.sldd` to classify it —
// `workspace.fs` has no partial read, so an editable JSON dictionary can only be told from a
// zip, and either from one over VS Code's 50 MB sync limit, by looking at the bytes. It then
// threw those bytes away and `post` read the same file again. The files that STAY in that
// read-only view are precisely the ones the redirects rejected as too large, so the duplicate
// read was reserved for the largest files the extension opens.
//
// The seam is `seededRead`: the classification hands its bytes over for the first ask and the
// holder is empty from then on. Emptiness is the whole safety argument, and it is not
// decoration — every later ask comes from a save, a watcher event or a refresh, each of which
// is evidence the file is no longer what was read, so a holder that answered twice would leave
// a table that visibly refreshed and did not change. That is why "at most once" is asserted
// here from both directions: the seed is served, and then it is gone even when nobody took it.
//
// `BinaryEditorProvider` imports `vscode` and no vitest test can load it, so the count through
// the SHIPPED provider — a real `workspace.fs.readFile`, counted, on a real `.sldd` tab — is
// pinned in test-integration/suite/slddReadOnce.test.ts. What that one cannot say is whether
// handing over older bytes is substitutable for reading, which is the last test below.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel } from 'data-explorer-core';
import { seededRead } from '../src/host/seededRead.js';
import { getModelForBinaryTab, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** A reader that records every real read it was made to do. */
function counting<T>(value: T): { read: () => Promise<T>; reads: number } {
  const state = {
    reads: 0,
    read: async () => {
      state.reads++;
      return value;
    },
  };
  return state;
}

describe('seededRead hands over one read, then reads', () => {
  it('answers the first ask from the seed and every ask after it from disk', async () => {
    const disk = counting('from disk');
    const source = seededRead('classified', disk.read);

    expect(await source.read()).toBe('classified');
    // The claim of the whole change: the file was not touched to answer that.
    expect(disk.reads).toBe(0);

    // And the claim that makes it safe. A repost is triggered by the file having changed, so
    // the second answer must come from the file, not from the same bytes as the first.
    expect(await source.read()).toBe('from disk');
    expect(await source.read()).toBe('from disk');
    expect(disk.reads).toBe(2);
  });

  it('reads on the very first ask when there was nothing to hand over', async () => {
    // The unseeded shape is not a special case for the caller to branch on: an unreadable
    // file (the classification's `catch`) and a format that classifies by name alone both
    // arrive here, and both must behave exactly as they did before the seam existed.
    const disk = counting('from disk');
    const source = seededRead<string>(undefined, disk.read);

    expect(await source.read()).toBe('from disk');
    expect(disk.reads).toBe(1);
  });

  it('drops a seed nobody asked for, so a later ask still reads the file', async () => {
    // The case the provider owes `drop()` for: the first post threw before asking, or took
    // the `.prj` route and asked for no bytes at all. Without this the seed would survive to
    // answer a repost — which is the one ask that knows the file has changed.
    const disk = counting('from disk');
    const source = seededRead('classified', disk.read);

    source.drop();

    expect(await source.read()).toBe('from disk');
    expect(disk.reads).toBe(1);
  });

  it('is unharmed by a drop after the seed was taken, which is the normal path', async () => {
    // `post` drops in a `finally`, so the ordinary run drops a seed that is already spent.
    const disk = counting('from disk');
    const source = seededRead('classified', disk.read);

    expect(await source.read()).toBe('classified');
    source.drop();
    source.drop();

    expect(await source.read()).toBe('from disk');
    expect(disk.reads).toBe(1);
  });

  it('serves the seed to one of two overlapping asks, not to both', async () => {
    // Two posts can be in flight at once: the webview's `ready` and a watcher event that
    // fired while the first was still awaiting. Both would hold the same bytes if the holder
    // were cleared after its fallback rather than before it.
    const disk = counting('from disk');
    const source = seededRead('classified', disk.read);

    const both = await Promise.all([source.read(), source.read()]);

    expect(both.filter((v) => v === 'classified')).toHaveLength(1);
    expect(disk.reads).toBe(1);
  });
});

describe('a tab built from handed-over bytes is the tab built from a read', () => {
  // The substitutability half. The seeded bytes are microseconds older than a fresh read, and
  // what makes that trade acceptable is that the tree does not depend on WHICH of the two
  // reads produced them — asserted through the real `getModelForBinaryTab`, over real
  // dictionary bytes, because a stub would let this agree with itself about a registration
  // core does not make.
  const NAME = 'params.sldd';

  // Same srcId both times, de-registered between, exactly as parsedRegistration.test.ts does
  // it: row ids are derived from the srcId, so two ids would differ for a reason that has
  // nothing to do with where the bytes came from.
  const SRC = 'seed://params.sldd';

  async function openTab(bytes: () => Promise<ArrayBuffer>): Promise<any> {
    invalidate(SRC);
    DataModel.removeDataSource(SRC);
    return getModelForBinaryTab(SRC, NAME, {
      parsed: async () => {
        throw new Error('a dictionary tab must not ask for a model parse');
      },
      bytes,
    });
  }

  it('gives the same rows, and asks the disk for nothing to do it', async () => {
    const disk = counting(bytesOf(NAME));
    const fresh = buildRows(await openTab(disk.read));
    expect(fresh.length, 'the fixture produces rows at all').toBeGreaterThan(0);
    expect(disk.reads).toBe(1);

    const source = seededRead(bytesOf(NAME), disk.read);
    const seeded = buildRows(await openTab(source.read));

    expect(seeded).toEqual(fresh);
    // The count, at the seam the provider actually uses: opening this tab cost the disk read
    // that classified the file and nothing more.
    expect(disk.reads).toBe(1);

    // And the repost after it pays for its own read — the seed cannot serve a second tree.
    const again = buildRows(await openTab(source.read));
    expect(again).toEqual(fresh);
    expect(disk.reads).toBe(2);
  });
});
