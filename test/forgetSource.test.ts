// Copyright 2026 The MathWorks, Inc.
//
// The one write this cache cannot see, and the one caller allowed to tell it.
//
// Every entry here is keyed by `mtime:size`, which is why nothing else needs an invalidation
// protocol: a file whose bytes moved is re-read on the next pass and one that did not is not. The
// key is wrong in the UNSAFE direction for exactly one class of write — one that preserves both.
// `tar -xp` and `unzip -o` restore a file with its recorded mtime, and restoring the same revision
// preserves its size too; a mount with 1-2 s mtime granularity cannot separate two equal-size
// writes inside one tick. Such a write leaves every tier believing what it already holds, and no
// later `stat` can talk it out of that — so before phase 2 it left the Usage column stale, and once
// a model tab's ROWS came off the shared parse it left the whole table stale, for the life of the
// window.
//
// So the tests come in pairs: the first of each pair is the exposure (same version, changed bytes,
// nothing said so — the answer stays old, deliberately), and the second is the same sequence with
// the watcher's hook called. Without the first the second could pass vacuously, on a cache that
// simply re-read everything.
//
// The version token is this test's own, held constant across a content change, which is what makes
// the scenario reachable at all in a unit test — a real `stat` cannot be asked to repeat itself. The
// byte-for-byte version of it, on a real disk with `utimesSync` and an assertion that the stat
// really did not move, is in the integration suite (forgetOnDiskChange.test.ts), which is also the
// only place the WIRING can be pinned: `BinaryEditorProvider` imports `vscode`.
//
// Over real fixture bytes, like every other test of this cache: the artifacts are core's parsers'
// output, and a stub would let this agree with the cache about a shape core does not produce.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cheapAll,
  clearSourceCache,
  fillModelSummaries,
  forgetSource,
  newSourceCache,
  parsedBudgetedBytes,
  parsedModelForOpenTab,
  parsedModelOf,
  parsedRetainedBytes,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from '../src/host/sourceCache.js';
import { getModelForBinaryTab, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });

// The file the write lands on. Its PATH is fixed and its CONTENT is not: `onDisk` says which
// fixture's bytes it currently holds, so a test can rewrite it without touching `stamp`.
const RESTORED = file('restored.slx');
// A second model, for the tests about the pin ring and the byte accounting — a forget has to leave
// everything it was not told about alone.
const OTHER = file('other.slx');

// Two models that differ in what any tier can be asked about: the linked dictionary the cheap tier
// extracts, the block the rows and the summary name.
const OLD = 'chain_model.slx'; // links chain_top.sldd, one Gain block named ChainGain
const NEW = 'shared_gain.slx'; // links Params.SLDD, blocks PlantGain and Trim

let reads: string[] = [];
let onDisk: Map<string, string>;
let stamp: Map<string, string>;

const reader: SourceReader = {
  version: async (f) => stamp.get(f.path) ?? null,
  bytes: async (f) => {
    reads.push(f.path);
    return bytesOf(onDisk.get(f.path) ?? '');
  },
};

/**
 * A reader whose FIRST read hangs until it is released, having already taken the bytes.
 *
 * That is the shape of the case a delete alone cannot cover: a derivation whose read happened
 * BEFORE the write and which resolves after it. The bytes are captured before the wait on purpose —
 * releasing it later must not hand it the new content by accident, or the test would be asserting
 * about a reader rather than about the cache.
 */
function gatedReader(): { reader: SourceReader; started: Promise<void>; release: () => void } {
  let open = (): void => {};
  const gate = new Promise<void>((r) => (open = r));
  let began = (): void => {};
  // `started` is not ceremony: a pass that goes through `mapLimited` has awaited something before it
  // reaches the read, so "in flight" has to be waited FOR rather than assumed from the call. Without
  // it the write could land before the old bytes were ever taken, and the test would be about a
  // different sequence than the one it names (or, as it happens, deadlock on its own gate).
  const started = new Promise<void>((r) => (began = r));
  let held = false;
  return {
    started,
    release: () => open(),
    reader: {
      version: async (f) => stamp.get(f.path) ?? null,
      bytes: async (f) => {
        reads.push(f.path);
        const bytes = bytesOf(onDisk.get(f.path) ?? '');
        if (!held) {
          held = true;
          began();
          await gate;
        }
        return bytes;
      },
    },
  };
}

/**
 * What `BinaryEditorProvider.post` does for a model — the same two real calls parseOnce.test.ts
 * makes, for the same reason: the branch and the pin are production's own here, not a copy.
 */
async function openTab(cache: SourceCache, f: SourceFile, r: SourceReader = reader): Promise<any> {
  invalidate(f.uriString);
  return getModelForBinaryTab(f.uriString, f.path.slice('/fx/'.length), {
    parsed: () => parsedModelForOpenTab(cache, f, stamp.get(f.path) ?? null, () => r.bytes(f)),
    bytes: () => r.bytes(f) as Promise<ArrayBuffer>,
  });
}

/** The names a tab's table shows — what the user would be looking at. */
const labels = (node: any): string[] => buildRows(node).map((row: any) => String(row?.Name?.label ?? ''));

/** Which dictionary the cheap tier says a model links. */
const linkedDict = (cache: SourceCache, f: SourceFile): string | null => {
  const cheap = cache.cheap.get(f.uriString)?.cheap;
  return cheap && cheap.kind === 'model' ? cheap.structure.dataDictionary : null;
};

/** The blocks a model's Usage summary names. */
const summaryBlocks = (cache: SourceCache, f: SourceFile): string[] =>
  (cache.models.get(f.uriString)?.summary.models ?? []).flatMap((m) => m.blockParams.map((p) => p.blockName));

beforeEach(() => {
  reads = [];
  onDisk = new Map([
    [RESTORED.path, OLD],
    [OTHER.path, 'model_with_refs.slx'],
  ]);
  stamp = new Map([RESTORED, OTHER].map((f) => [f.path, `v1:${f.path}`]));
});

describe('bytes that changed under a stat that did not', () => {
  it('leaves a model tab showing the OLD rows while nothing has said the file changed', async () => {
    // The exposure, stated as the behaviour it is. Not a bug being pinned in place: it is the price
    // of a cache with no invalidation protocol, and it is invisible to every later `stat`, which is
    // why the hook below exists and why nothing weaker than a hook would do.
    const cache = newSourceCache();
    expect(labels(await openTab(cache, RESTORED))).toContain('ChainGain');

    onDisk.set(RESTORED.path, NEW);
    reads = [];
    const after = await openTab(cache, RESTORED);

    // No read at all, so no chance of noticing: the version key says this is the file already held.
    expect(reads).toEqual([]);
    expect(labels(after)).toContain('ChainGain');
    expect(labels(after)).not.toContain('PlantGain');
  });

  it('shows the NEW rows once the watcher hook has dropped what the version key still believed', async () => {
    const cache = newSourceCache();
    expect(labels(await openTab(cache, RESTORED))).toContain('ChainGain');

    // The write, and then the one event that knows better than `mtime:size` —
    // `sourceReads.forgetChangedSource`, which is this call plus a uri, reached from
    // `BinaryEditorProvider`'s watcher and from nowhere else.
    onDisk.set(RESTORED.path, NEW);
    forgetSource(cache, RESTORED.uriString);
    reads = [];
    const after = await openTab(cache, RESTORED);

    // Re-read, re-parsed, and the table is the file as it is now.
    expect(reads).toEqual([RESTORED.path]);
    expect(labels(after)).toContain('PlantGain');
    expect(labels(after)).not.toContain('ChainGain');
  });

  it('drops the cheap artifact too, so the tree is not left drawing an edge to the old dictionary', async () => {
    const cache = newSourceCache();
    await cheapAll(cache, reader, [RESTORED]);
    expect(linkedDict(cache, RESTORED)).toBe('chain_top.sldd');

    onDisk.set(RESTORED.path, NEW);
    await cheapAll(cache, reader, [RESTORED]);
    // Same exposure one tier down, and the same reason: a pass over a folder it has already paid
    // for is a folder of `stat`s.
    expect(linkedDict(cache, RESTORED)).toBe('chain_top.sldd');

    forgetSource(cache, RESTORED.uriString);
    await cheapAll(cache, reader, [RESTORED]);
    // All three tiers or none: dropping the parse alone would leave the table fresh and the tree's
    // edges stale, which is half a fix and harder to reason about than either whole.
    expect(linkedDict(cache, RESTORED)).toBe('Params.SLDD');
  });

  it('drops the model summary too, which is the Usage column this bug used to be confined to', async () => {
    const cache = newSourceCache();
    const wanted = new Set([RESTORED.uriString]);
    await fillModelSummaries(cache, reader, [RESTORED], wanted, await cheapAll(cache, reader, [RESTORED]));
    expect(summaryBlocks(cache, RESTORED)).toContain('ChainGain');

    onDisk.set(RESTORED.path, NEW);
    forgetSource(cache, RESTORED.uriString);
    await fillModelSummaries(cache, reader, [RESTORED], wanted, await cheapAll(cache, reader, [RESTORED]));

    expect(summaryBlocks(cache, RESTORED)).toContain('PlantGain');
    expect(summaryBlocks(cache, RESTORED)).not.toContain('ChainGain');
  });

  it('releases the pin with the entry, and uncharges its bytes, leaving the other tab alone', async () => {
    const cache = newSourceCache();
    await openTab(cache, RESTORED);
    await openTab(cache, OTHER);

    // Two tabs, `PINNED_PARSES` is two, so both are pinned and nothing is charged.
    expect(cache.pinnedParses).toEqual([RESTORED.uriString, OTHER.uriString]);
    expect(parsedBudgetedBytes(cache)).toBe(0);
    const retained = parsedRetainedBytes(cache);
    const forgotten = cache.parsed.get(RESTORED.uriString)?.estimated ?? 0;
    expect(forgotten).toBeGreaterThan(0);

    forgetSource(cache, RESTORED.uriString);

    // The pin goes with the entry it was a claim about. A pin left behind would spend a slot of a
    // two-slot ring on a file no tab is holding, so the next model the user opens would displace
    // the tab they still have open instead of the phantom.
    expect(cache.pinnedParses).toEqual([OTHER.uriString]);
    expect(cache.parsed.has(RESTORED.uriString)).toBe(false);
    // The accounting needs no adjustment of its own: both totals are sums over the map, so deleting
    // the entry uncharges it by construction. Asserted rather than assumed, because a cache that
    // kept charging for a dropped entry would evict live parses to make room for nothing.
    expect(parsedRetainedBytes(cache)).toBe(retained - forgotten);
    expect(parsedBudgetedBytes(cache)).toBe(0);
    // And the file nobody said anything about is untouched, tier by tier.
    expect(cache.parsed.has(OTHER.uriString)).toBe(true);
  });

  it('will not let a caller that arrives after the write JOIN the read that predates it', async () => {
    // The half a delete cannot cover. A derivation already running read the OLD bytes, and it is
    // still going to answer its own caller — nothing can cancel it. What must not happen is anyone
    // ELSE being handed that answer, or the answer being STORED under a version the write did not
    // move, which would be the same permanent hit a few hundred milliseconds later with the watcher
    // event already spent.
    const cache = newSourceCache();
    const { reader: gated, release } = gatedReader();
    const version = stamp.get(RESTORED.path) ?? null;

    // In flight, on the bytes as they were.
    const inFlight = parsedModelOf(cache, RESTORED, version, () => gated.bytes(RESTORED));
    onDisk.set(RESTORED.path, NEW);
    forgetSource(cache, RESTORED.uriString);

    // The next caller reads for itself and gets the file as it is now.
    const after = await parsedModelOf(cache, RESTORED, version, () => gated.bytes(RESTORED));
    expect(after?.dataDictionary).toBe('Params.SLDD');
    expect(reads).toEqual([RESTORED.path, RESTORED.path]);
    expect(cache.parsed.get(RESTORED.uriString)?.parsed).toBe(after);

    // Only now does the older derivation finish — strictly AFTER the fresh entry was stored, which
    // is the ordering that makes the store guard load-bearing rather than decorative.
    release();
    expect((await inFlight)?.dataDictionary).toBe('chain_top.sldd');
    // It answered its caller and retained nothing: the cache still holds the new parse.
    expect(cache.parsed.get(RESTORED.uriString)?.parsed).toBe(after);
    expect(cache.parsed.get(RESTORED.uriString)?.version).toBe(version);
  });

  it('will not let an in-flight cheap pass put back the artifact it derived before the write', async () => {
    // The same guard at the cheap tier, because the same window is there: a folder pass reads, the
    // write lands, and the pass stores what it read. It is the likelier of the two in practice — a
    // whole-folder pass is in flight for as long as the folder takes.
    const cache = newSourceCache();
    const { reader: gated, started, release } = gatedReader();

    const inFlight = cheapAll(cache, gated, [RESTORED]);
    await started;
    onDisk.set(RESTORED.path, NEW);
    forgetSource(cache, RESTORED.uriString);
    await cheapAll(cache, gated, [RESTORED]);
    expect(linkedDict(cache, RESTORED)).toBe('Params.SLDD');

    release();
    await inFlight;
    expect(linkedDict(cache, RESTORED)).toBe('Params.SLDD');
  });

  it('does not treat a whole-cache clear as news about any file, so a pass across one still stores', async () => {
    // The deliberate asymmetry between the two ways of emptying this cache. `clearSourceCache` runs
    // when a workspace FOLDER comes or goes; it invalidates the paths files were named by and says
    // nothing whatever about their content. So it must not stop a derivation in flight from storing
    // what it read — doing so would make an ordinary folder change cost the next pass a re-read of
    // everything it was already holding, to protect against a write nobody reported.
    const cache = newSourceCache();
    const { reader: gated, release } = gatedReader();

    const inFlight = parsedModelOf(cache, RESTORED, stamp.get(RESTORED.path) ?? null, () => gated.bytes(RESTORED));
    clearSourceCache(cache);
    release();
    await inFlight;

    expect(cache.parsed.get(RESTORED.uriString)?.parsed?.dataDictionary).toBe('chain_top.sldd');
  });
});
