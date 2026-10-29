// Copyright 2026 The MathWorks, Inc.
//
// The one write this cache cannot see, and the two watchers allowed to tell it.
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
// only place the WIRING can be pinned: `BinaryEditorProvider` and the workspace watcher's handler
// (workspaceChange.ts) import `vscode`.
//
// The two watchers do not forget alike. A read-only tab's watcher forgets on every event; the
// workspace watcher forgets only when the file's new version is one the cache already holds
// (`forgetUnseenWrite`), so an ordinary save, which the version key already sees, costs nothing.
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
  forgetIfVersionUnmoved,
  forgetSource,
  forgetUnseenWrite,
  heldVersionsOf,
  newSourceCache,
  parsedBudgetedBytes,
  parsedModelForOpenTab,
  parsedModelOf,
  parsedRetainedBytes,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from '../src/host/sourceCache.js';
import { getModelForBinaryTab, invalidate, buildRows } from 'data-explorer-view/model';

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

describe('the workspace watcher forgets only the write the version key cannot see', () => {
  const versionOf = (f: SourceFile): string | null => stamp.get(f.path) ?? null;
  /** The `stat` the workspace watcher's handler takes after the event: the file's version now. */
  const statOf = (f: SourceFile) => async (): Promise<string | null> => versionOf(f);

  /** Every tier filled for `f` from what is on disk now, through the cache's own entry points. */
  async function fillAllTiers(cache: SourceCache, f: SourceFile): Promise<void> {
    const wanted = new Set([f.uriString]);
    await fillModelSummaries(cache, reader, [f], wanted, await cheapAll(cache, reader, [f]));
    await parsedModelOf(cache, f, versionOf(f), () => reader.bytes(f));
  }

  it('forgets every tier when the new version is one the cache already holds', async () => {
    const cache = newSourceCache();
    await fillAllTiers(cache, RESTORED);
    await fillAllTiers(cache, OTHER);
    expect(labels(await openTab(cache, RESTORED))).toContain('ChainGain');

    // The write the key cannot see: new bytes, same version. No read-only tab's watcher says so.
    onDisk.set(RESTORED.path, NEW);
    const generation = cache.generation;
    const forgot = await forgetUnseenWrite(cache, RESTORED.uriString, statOf(RESTORED));

    // What the user sees first: the table, the tree's edge and the Usage summary follow the file.
    reads = [];
    expect(labels(await openTab(cache, RESTORED))).toContain('PlantGain');
    await fillAllTiers(cache, RESTORED);
    expect(linkedDict(cache, RESTORED)).toBe('Params.SLDD');
    expect(summaryBlocks(cache, RESTORED)).toContain('PlantGain');
    expect(summaryBlocks(cache, RESTORED)).not.toContain('ChainGain');
    expect(reads).toContain(RESTORED.path);

    // One forget, of this file only.
    expect(forgot).toBe(true);
    expect(cache.generation).toBe(generation + 1);
    expect(cache.parsed.has(OTHER.uriString)).toBe(true);
    expect(cache.cheap.has(OTHER.uriString)).toBe(true);
    expect(cache.models.has(OTHER.uriString)).toBe(true);
  });

  it('forgets nothing for an ordinary save, so a derivation in flight elsewhere still stores', async () => {
    // Why the ruling took this option over forgetting on every event. An ordinary save moves the
    // version, and the version key already re-reads the file. A forget would also bump the
    // cache-wide generation, which discards the store of every derivation in flight: over a branch
    // switch, every file in the folder pass.
    const cache = newSourceCache();
    await fillAllTiers(cache, RESTORED);
    const { reader: gated, started, release } = gatedReader();
    const elsewhere = cheapAll(cache, gated, [OTHER]);
    await started;

    onDisk.set(RESTORED.path, NEW);
    stamp.set(RESTORED.path, 'v2:saved');
    const generation = cache.generation;
    expect(await forgetUnseenWrite(cache, RESTORED.uriString, statOf(RESTORED))).toBe(false);
    expect(cache.generation).toBe(generation);
    expect(cache.parsed.get(RESTORED.uriString)?.version).toBe(`v1:${RESTORED.path}`);

    release();
    await elsewhere;
    expect(cache.cheap.has(OTHER.uriString)).toBe(true);

    // And the save is still seen, by the key: the next read is the file as it is now.
    reads = [];
    expect(labels(await openTab(cache, RESTORED))).toContain('PlantGain');
    expect(reads).toEqual([RESTORED.path]);
  });

  it('forgets and stats nothing for a file nothing holds, and forgets nothing at no version', async () => {
    const cache = newSourceCache();
    await fillAllTiers(cache, OTHER);

    // A file no consumer has read has nothing stale in it, so its event costs no `stat`.
    let stats = 0;
    const counted = async (): Promise<string | null> => {
      stats += 1;
      return versionOf(RESTORED);
    };
    expect(heldVersionsOf(cache, RESTORED.uriString).size).toBe(0);
    expect(await forgetUnseenWrite(cache, RESTORED.uriString, counted)).toBe(false);
    expect(stats).toBe(0);

    // A file that stopped answering a `stat` after its event (deleted, or grown past the scan cap):
    // nothing is stored under `null`, so nothing held can be the version it has now.
    await fillAllTiers(cache, RESTORED);
    const held = heldVersionsOf(cache, RESTORED.uriString);
    expect(forgetIfVersionUnmoved(cache, RESTORED.uriString, held, null)).toBe(false);
    expect(cache.parsed.has(RESTORED.uriString)).toBe(true);
    expect(cache.generation).toBe(0);
  });

  it('counts a parse still in flight as held, because it read the bytes from before the write', async () => {
    const cache = newSourceCache();
    const { reader: gated, started, release } = gatedReader();
    const version = versionOf(RESTORED);

    // In flight on the old bytes, and nothing finished is held yet.
    const inFlight = parsedModelOf(cache, RESTORED, version, () => gated.bytes(RESTORED));
    await started;
    expect(cache.parsed.has(RESTORED.uriString)).toBe(false);
    onDisk.set(RESTORED.path, NEW);
    const forgot = await forgetUnseenWrite(cache, RESTORED.uriString, statOf(RESTORED));

    // Its own caller still gets what it read; nobody after it does.
    release();
    expect((await inFlight)?.dataDictionary).toBe('chain_top.sldd');
    const after = await parsedModelOf(cache, RESTORED, version, () => reader.bytes(RESTORED));
    expect(after?.dataDictionary).toBe('Params.SLDD');
    expect(forgot).toBe(true);
  });

  it('counts a cheap read still in flight as held, for the same reason', async () => {
    const cache = newSourceCache();
    const { reader: gated, started, release } = gatedReader();

    const pass = cheapAll(cache, gated, [RESTORED]);
    await started;
    onDisk.set(RESTORED.path, NEW);
    const forgot = await forgetUnseenWrite(cache, RESTORED.uriString, statOf(RESTORED));
    release();
    await pass;

    await cheapAll(cache, reader, [RESTORED]);
    expect(linkedDict(cache, RESTORED)).toBe('Params.SLDD');
    expect(forgot).toBe(true);
  });

  it('reads what is held before the stat, so a tab that already forgot and re-parsed is left alone', async () => {
    // A read-only tab on the file has its own watcher, and it forgets on every event. When its event
    // is handled first, the tab's re-parse has started, at the same version, by the time the
    // workspace handler's `stat` comes back. The handler must not count that re-parse as stale.
    const cache = newSourceCache();
    expect(labels(await openTab(cache, RESTORED))).toContain('ChainGain');
    const version = versionOf(RESTORED);
    onDisk.set(RESTORED.path, NEW);

    // The tab's watcher: `forgetChangedSource`, then a repost.
    forgetSource(cache, RESTORED.uriString);
    // The workspace watcher's handler, in the same turn. Its `stat` does not come back until the
    // tab's re-parse has stored.
    let statBack = (): void => {};
    const statted = new Promise<void>((r) => (statBack = r));
    const verdict = forgetUnseenWrite(cache, RESTORED.uriString, async () => {
      await statted;
      return version;
    });
    const rows = labels(await openTab(cache, RESTORED));
    statBack();

    expect(await verdict).toBe(false);
    expect(rows).toContain('PlantGain');
    // The tab's new parse is still the one held, and the tab's forget was the only one.
    expect(cache.parsed.get(RESTORED.uriString)?.parsed.dataDictionary).toBe('Params.SLDD');
    expect(cache.generation).toBe(1);
  });
});
