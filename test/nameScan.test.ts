// Copyright 2026 The MathWorks, Inc.
//
// What the global search SHARES, and the one thing it must never share.
//
// The first search over a folder used to full-parse every model in it, sharing nothing —
// including the model the open tab had just parsed, which was therefore parsed a third time.
// Search still needs those parses (a block name exists nowhere cheaper than
// `parsed.blockParamUsages`, and a cheap block-name scanner is an explicit non-goal), so what
// this pins is not that the parses went away but that they are now the SAME parses: one per
// model per content version, whichever consumer asked first. A `.sldd` or `.mat` is the same
// story one tier down: search used to scan each of them for itself, and now reads the
// occurrence-ordered names off the cheap artifact the tree and the usage plan already wanted —
// one scan per data file per content version, whichever consumer asked first.
//
// Counted the way parseOnce.test.ts counts, and for the same reason: `parsedModelOf` is the only
// place this host parses a model, and every parse stores a NEW `{version, parsed}` entry in
// `cache.parsed`, so "what was parsed between here and there" is the set of entries whose object
// identity moved. A second parse yields an equal-but-distinct object that no deep comparison
// catches, which is why the assertions below are identity and counts rather than names.
//
// The other half is a correctness rule, not a count. Search prefers an open document's UNSAVED
// text over disk, and the cache keys every entry on the DISK file's `mtime:size` — a key that
// cannot tell saved content from unsaved. So buffer bytes stored under one would be handed to
// every other consumer as though they were the file, and no `stat` would ever notice. The tests
// at the bottom are that rule, from both sides: the override still wins, and nothing it read
// reaches the cache.
//
// Over real fixture bytes, because the artifacts are core's parsers' output and a stub would let
// this agree with the scan about a shape core does not produce.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NameRecord } from '../src/host/nameExtract.js';
import { mapLimited } from '../src/host/mapLimited.js';
import { namesOfFile, type NameReader } from '../src/host/nameScan.js';
import {
  newSourceCache,
  parsedModelForOpenTab,
  type SourceCache,
  type SourceFile,
} from '../src/host/sourceCache.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });
const nameOf = (path: string): string => path.slice('/fx/'.length);
const encode = (text: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

// The model a tab opens. `chain_model.slx` holds one named block, `ChainGain`.
const MODEL = file('chain_model.slx');
// Four models, so "one fewer" is a number and not a coincidence. `model_with_refs.slx` is
// deliberately NOT here: it yields no names at all, so it would be parsed and then contribute
// nothing, which is a fact about the fixture rather than about the sharing.
const MODELS = [MODEL, file('shared_gain.slx'), file('sid_blocks.slx'), file('legacy_ctrl.mdl')];
const DICT = file('params.sldd');
// The data files, which search now reads through the shared cheap tier rather than scanning
// itself: two dictionaries (one textual, one compressed) and a MAT-file.
const DATA = [DICT, file('chain_top.sldd'), file('nd_numeric.mat')];
const FILES = [...MODELS, ...DATA];

let reads: string[] = [];
let stamp: Map<string, string>;
// Bytes standing in for what is on DISK, for the two files this suite has to author rather than
// read (a dictionary with two entries of the same name; a model whose buffer disagrees with it).
let disk: Map<string, ArrayBuffer>;
// uriString -> the unsaved buffer of an open document, exactly what nameIndex.dirtyBytesOf
// answers with. Empty for every test that is not about the override.
let buffers: Map<string, ArrayBuffer>;

const reader: NameReader = {
  version: async (f) => stamp.get(f.path) ?? null,
  bytes: async (f) => {
    // A file with no version has no bytes either. That is the real reader's contract, not a
    // convenience: `scanVersion` and `readForScan` make the SAME two refusals (oversized,
    // unreadable), one from the `stat` alone and one from the read — see sourceReads.ts.
    if (!stamp.has(f.path)) return null;
    reads.push(f.path);
    return disk.get(f.path) ?? bytesOf(nameOf(f.path));
  },
  dirtyBytes: (f) => buffers.get(f.uriString) ?? null,
};

/** The whole first-search pass: every candidate, batched, exactly as nameIndex.build runs it. */
async function search(cache: SourceCache, files: readonly SourceFile[] = FILES): Promise<Map<string, NameRecord[]>> {
  const found = await mapLimited(files, async (f) => ({ f, records: await namesOfFile(cache, reader, f) }));
  const out = new Map<string, NameRecord[]>();
  for (const { f, records } of found) {
    if (records.length > 0) out.set(f.uriString, records);
  }
  return out;
}

/**
 * What a TAB does — the inner sequence of sourceReads.parsedModelForTab, which imports vscode.
 *
 * Through the cache's tab entry point, which is what that adapter calls: the pin it adds is what
 * keeps a tab's parse out of the search pass's eviction order, and spelling it out again here
 * would be a copy of a decision rather than a use of it.
 */
async function openTab(cache: SourceCache, f: SourceFile) {
  return parsedModelForOpenTab(cache, f, stamp.get(f.path) ?? null, async () => {
    reads.push(f.path);
    return disk.get(f.path) ?? bytesOf(nameOf(f.path));
  });
}

/** Which parse each model currently has, by object identity — the parse ledger. */
const ledger = (cache: SourceCache): Map<string, unknown> => new Map(cache.parsed);

/** The models parsed between two ledgers: a new entry, or an entry that was replaced. */
const parsedBetween = (before: Map<string, unknown>, after: Map<string, unknown>): string[] =>
  [...after]
    .filter(([uri, entry]) => before.get(uri) !== entry)
    .map(([uri]) => uri)
    .sort();

const uris = (files: readonly SourceFile[]): string[] => files.map((f) => f.uriString).sort();
const namesIn = (found: Map<string, NameRecord[]>, f: SourceFile): string[] =>
  (found.get(f.uriString) ?? []).map((r) => r.name);

beforeEach(() => {
  reads = [];
  disk = new Map();
  buffers = new Map();
  stamp = new Map([...FILES, MODEL].map((f) => [f.path, `v1:${f.path}`]));
});

describe('the first search shares whatever is already parsed', () => {
  it('parses every model when nothing else has, which is the number the saving is measured against', async () => {
    const cache = newSourceCache();
    const found = await search(cache);
    // All four, so the one-fewer below is a model that was skipped rather than a model that
    // was never wanted.
    expect(parsedBetween(new Map(), ledger(cache))).toEqual(uris(MODELS));
    // The cheap tier holds the DATA files and no model. Both halves are the sharing: a
    // dictionary's or a MAT-file's names come off the same scan the tree and the usage plan
    // read, so the artifact is here for them; a model's cheap artifact is
    // `extractSlxStructure`, a scan search has no use for, so this pass does not run it.
    expect([...cache.cheap.keys()].sort()).toEqual(uris(DATA));
    expect(namesIn(found, MODEL)).toContain('ChainGain');
  });

  it('parses one fewer after a tab has opened one of them, and does not re-read it either', async () => {
    const cache = newSourceCache();
    const held = await openTab(cache, MODEL);
    const afterTab = ledger(cache);
    reads = [];

    const found = await search(cache);

    // Three parses, not four: the model the tab already parsed is not parsed again. This is
    // the measured case — "open a model, then run the first global search" — where the opened
    // model used to be parsed a third time, having already been parsed twice for the tab.
    expect(parsedBetween(afterTab, ledger(cache))).toEqual(uris(MODELS.slice(1)));
    // And not re-read: the bytes are behind a thunk, so a hit skips the read as well as the
    // parse. A 13.8 MB model the tab holds costs search a `stat`.
    expect(reads).not.toContain(MODEL.path);
    // The names really came out of the tab's parse. Identity, not equality — a second parse
    // would have produced an equal-but-distinct `ParsedSlx` and every name would still match.
    expect(namesIn(found, MODEL)).toContain('ChainGain');
    expect(cache.parsed.get(MODEL.uriString)?.parsed).toBe(held);
  });

  it('hands a later tab the parse the search made, for nothing', async () => {
    const cache = newSourceCache();
    await search(cache);
    const afterSearch = ledger(cache);
    reads = [];

    const parsed = await openTab(cache, MODEL);

    // The other direction of the same sharing, and the one that decides whether search is
    // worth routing through the cache at all: a folder-wide pass that parsed 22 models and
    // threw them away made the next tab pay again.
    expect(parsedBetween(afterSearch, ledger(cache))).toEqual([]);
    expect(reads).toEqual([]);
    expect(parsed).toBe(cache.parsed.get(MODEL.uriString)?.parsed);
  });

  it('re-parses exactly the model whose version moved, and searches with the new names', async () => {
    const cache = newSourceCache();
    await search(cache);
    const before = ledger(cache);

    // What an external edit looks like to the cache: the version moved. Nothing had to be
    // invalidated — the entry key IS the content version.
    stamp.set(MODEL.path, `v2:${MODEL.path}`);
    disk.set(MODEL.path, bytesOf('shared_gain.slx'));
    const found = await search(cache);

    expect(parsedBetween(before, ledger(cache))).toEqual([MODEL.uriString]);
    expect(namesIn(found, MODEL).sort()).toEqual(['PlantGain', 'Trim']);
  });

  it('parses nothing for a model the reader will not version, and keeps nothing for it', async () => {
    // A file over the scan cap: no version, so no key, and `readForScan` refuses the bytes as
    // well. Search contributes nothing for it, as it did before — the file still opens in its
    // own tab, where a tab reads eagerly whatever a scan skips.
    const cache = newSourceCache();
    stamp.delete(MODEL.path);
    const found = await search(cache);
    expect(found.has(MODEL.uriString)).toBe(false);
    expect(cache.parsed.has(MODEL.uriString)).toBe(false);
    expect(reads).not.toContain(MODEL.path);
    // The rest of the folder answered as usual.
    expect(parsedBetween(new Map(), ledger(cache))).toEqual(uris(MODELS.slice(1)));
  });
});

describe('a dictionary shares the cheap tier’s scan, and its names are not the summary’s', () => {
  // Why search reads `Cheap.names` and NOT the cheap tier's `FileSummaries`, stated as the case
  // that would break: `DataSummary.names` is a `Set`, and one .sldd legitimately holds two
  // entries with the same name — Design and Other Data are separate namespaces, so pasting
  // `Array` from one into the other keeps the name (duplicateNameIdentity.test.ts). This index
  // promises one record per OCCURRENCE, so a deduped set would silently drop a search hit. The
  // artifact carries both: the Set for resolution and the occurrence-ordered array for this.
  const DUPS = file('dup_names.sldd');

  const withDuplicateEntry = (): ArrayBuffer => {
    const text = readFileSync(join(dir, 'params.sldd'), 'utf8');
    const entry = /\{\s*"name": "Kp",[\s\S]*?\n\t{5}\}/.exec(text);
    if (!entry) throw new Error('params.sldd no longer spells its entries the way this test edits');
    // The same name a second time, with its own uuid — the shape a cross-namespace paste
    // leaves behind.
    return encode(text.replace(entry[0], `${entry[0]},\n${entry[0].replace('fixture-uuid-Kp', 'fixture-uuid-Kp2')}`));
  };

  it('reports both entries of a duplicated name, which a Set would collapse to one', async () => {
    const cache = newSourceCache();
    stamp.set(DUPS.path, `v1:${DUPS.path}`);
    disk.set(DUPS.path, withDuplicateEntry());

    const found = await search(cache, [DUPS]);

    expect(namesIn(found, DUPS).filter((n) => n === 'Kp').length).toBe(2);
    expect(namesIn(found, DUPS)).toEqual(['Kp', 'Kp', 'Uo', 'Ki']);
    // Off the SHARED artifact, and the two lists it carries are the two answers: the summary
    // this same scan produced collapsed the duplicate, which is what search must not read.
    const cheap = cache.cheap.get(DUPS.uriString)?.cheap;
    if (cheap?.kind !== 'sldd') throw new Error(`expected a dictionary, got ${cheap?.kind}`);
    expect(cheap.names).toEqual(['Kp', 'Kp', 'Uo', 'Ki']);
    expect([...[...cheap.summary.slddByName.values()][0].names]).toEqual(['Kp', 'Uo', 'Ki']);
  });

  it('stores ONE dictionary artifact and reads the file once, whichever tier asked first', async () => {
    // Search shares the model tier AND the cheap tier now. A dictionary read for its names is
    // the same read the tree and the usage plan want, so the artifact it leaves behind is
    // theirs, and a second search over the same folder reads nothing at all.
    const cache = newSourceCache();
    await search(cache);
    expect([...cache.cheap.keys()].sort()).toEqual(uris(DATA));
    expect([...cache.parsed.keys()].sort()).toEqual(uris(MODELS));
    const first = cache.cheap.get(DICT.uriString);
    reads = [];

    const again = await search(cache);

    // The same artifact object, not an equal one: the second pass re-versioned and hit.
    expect(cache.cheap.get(DICT.uriString)).toBe(first);
    expect(reads.filter((p) => p === DICT.path)).toEqual([]);
    expect(namesIn(again, DICT)).toEqual(['Kp', 'Uo', 'Ki']);
  });

  it('contributes nothing for a dictionary the read cannot recover, without failing the pass', async () => {
    // The refusal policies CONVERGED with the sharing, and this is where they now meet. This
    // index used to scan the file itself and catch its own throw; the throw is now inside the
    // cheap tier, which answers an empty artifact for such a file (`dataCheapOf`). Same `[]`
    // here, and the file is still an artifact-bearing node for the tree and a scope for the
    // usage plan — the alternative, dropping it, makes `usageScope` summarise the whole folder.
    const BAD = file('broken.sldd');
    const cache = newSourceCache();
    stamp.set(BAD.path, `v1:${BAD.path}`);
    disk.set(BAD.path, encode('{ "__MW_TEXT_PARTS__": trunc'));

    const found = await search(cache, [BAD, DICT]);

    expect(found.has(BAD.uriString)).toBe(false);
    const cheap = cache.cheap.get(BAD.uriString)?.cheap;
    if (cheap?.kind !== 'sldd') throw new Error(`expected a dictionary, got ${cheap?.kind}`);
    expect(cheap.names).toEqual([]);
    expect(cheap.refs).toEqual([]);
    expect(cheap.summary.slddByName.size).toBe(0);
    // Non-vacuity: the pass kept going and the healthy dictionary beside it still answered.
    expect(namesIn(found, DICT)).toEqual(['Kp', 'Uo', 'Ki']);
  });
});

describe('the dirty-buffer override still wins', () => {
  it('finds a name renamed in an unsaved buffer, and stops finding the old one', async () => {
    // The behaviour the override exists for. reindexFile runs per keystroke on an UNSAVED
    // buffer; reading disk there re-derives the names the file had BEFORE the edit, so search
    // offered the old name — which no longer resolves to a row — and never the new one.
    const cache = newSourceCache();
    const renamed = readFileSync(join(dir, 'params.sldd'), 'utf8').replace('"Kp"', '"KpRenamed"');
    buffers.set(DICT.uriString, encode(renamed));

    const found = await search(cache, [DICT]);

    expect(namesIn(found, DICT)).toContain('KpRenamed');
    expect(namesIn(found, DICT)).not.toContain('Kp');
    // The rest of the buffer is still indexed — this is the file's names, not a patch.
    expect(namesIn(found, DICT)).toEqual(['KpRenamed', 'Uo', 'Ki']);
    expect(reads).toEqual([]);
  });

  it('prefers the buffer for a MODEL too, though no model can be dirty through our own editors', async () => {
    // Models open in the read-only `BinaryEditorProvider` (a `CustomDocument`, never a
    // `TextDocument`) and the writable binary editor keeps its edits in its own stack, so a
    // dirty model only happens if the user force-opens one in VS Code's text editor. The rule
    // does not depend on that being rare: whatever is dirty is preferred, and cached nowhere.
    const cache = newSourceCache();
    buffers.set(MODEL.uriString, bytesOf('shared_gain.slx'));

    const found = await search(cache, [MODEL]);

    expect(namesIn(found, MODEL).sort()).toEqual(['PlantGain', 'Trim']);
    expect(reads).toEqual([]);
  });
});

describe('an unsaved buffer never enters the shared cache', () => {
  it('keeps no parse for a dirty model, and hands the next tab the DISK file', async () => {
    // The single most important rule of this phase. `mtime:size` cannot tell saved content
    // from unsaved, so a buffer stored under it would be served to every other consumer — a
    // tab's rows, a Usage summary — as though it were the file, and would never self-heal
    // because the version it claims is the version on disk.
    const cache = newSourceCache();
    buffers.set(MODEL.uriString, bytesOf('shared_gain.slx'));

    await search(cache, [MODEL]);
    expect(cache.parsed.has(MODEL.uriString)).toBe(false);

    // And the proof that it is not merely absent from the map: the tab that opens the same
    // model next gets `chain_model.slx`'s own blocks. A poisoned entry would have answered
    // with the buffer's — `PlantGain` and `Trim` — under the disk file's version.
    buffers.clear();
    const parsed = await openTab(cache, MODEL);
    expect(parsed?.blockParamUsages?.map((u) => u.blockName)).toEqual(['ChainGain']);
    expect(reads).toEqual([MODEL.path]);
  });

  it('keeps nothing for a dirty dictionary either', async () => {
    // Now that a dictionary HAS a cheap artifact, this is the rule's sharpest edge: the scan of
    // an unsaved buffer must not become the artifact the tree, the usage plan and the next
    // search all read for the file on disk. It bypasses the tier entirely rather than writing
    // under the disk version.
    const cache = newSourceCache();
    buffers.set(DICT.uriString, encode(readFileSync(join(dir, 'params.sldd'), 'utf8').replace('"Kp"', '"KpRenamed"')));
    await search(cache, [DICT]);
    expect(cache.cheap.has(DICT.uriString)).toBe(false);
    expect(cache.models.has(DICT.uriString)).toBe(false);
    expect(cache.parsed.size).toBe(0);
    expect(reads).toEqual([]);
  });

  it('takes no cached SCAN for a dirty dictionary, so the renamed entry is what search finds', async () => {
    // The other direction, and the one the shared cheap tier newly makes possible: the file has
    // an artifact at the current disk version, so a scan that only refused to WRITE would read
    // the saved names straight back out of it and offer `Kp` — exactly the stale name the
    // override exists to remove.
    const cache = newSourceCache();
    await search(cache, [DICT]);
    const onDisk = cache.cheap.get(DICT.uriString);
    expect(onDisk).toBeTruthy();
    buffers.set(DICT.uriString, encode(readFileSync(join(dir, 'params.sldd'), 'utf8').replace('"Kp"', '"KpRenamed"')));

    const found = await search(cache, [DICT]);

    expect(namesIn(found, DICT)).toEqual(['KpRenamed', 'Uo', 'Ki']);
    // And the disk artifact it did not take is still there, unchanged, for every other consumer.
    expect(cache.cheap.get(DICT.uriString)).toBe(onDisk);
  });

  it('takes no cached parse for a dirty model, so the stale name cannot come back', async () => {
    // The override has to bypass the cache in BOTH directions. A file already parsed from disk
    // has an entry at the current version, so a scan that only refused to WRITE would still
    // read the saved content straight back out of it — offering exactly the old name the
    // override exists to remove.
    const cache = newSourceCache();
    await openTab(cache, MODEL);
    buffers.set(MODEL.uriString, bytesOf('shared_gain.slx'));

    const found = await search(cache, [MODEL]);

    expect(namesIn(found, MODEL).sort()).toEqual(['PlantGain', 'Trim']);
    // The disk entry it did not take is still there, unchanged, for the tab that owns it.
    expect(cache.parsed.get(MODEL.uriString)?.parsed.blockParamUsages?.map((u) => u.blockName)).toEqual(['ChainGain']);
  });
});
