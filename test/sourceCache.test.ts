// Copyright 2026 The MathWorks, Inc.
//
// The shared cheap tier, counted rather than timed.
//
// This cache exists to make a file cost one read per content CHANGE no matter how many
// consumers want it, and every claim in that sentence is a count: how many times a candidate
// was stat'd, how many times its bytes were read, and which files a version bump re-reads.
// Stated as counts and not milliseconds so they hold on any machine, and asserted through the
// injected reader because that is the only place the reads are visible — a passing usage
// answer looks identical whether it read the folder once or four times, which is exactly how
// four independent readers of the same folder went unnoticed.
//
// Over real fixture bytes, not stubs. The artifacts are core's summarisers' output, and a
// hand-built `FileSummaries` would let the pass agree with this test about a shape core does
// not produce.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_EXTS } from '../src/common/fileTypes.js';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';
import {
  cheapAll,
  clearSourceCache,
  fillModelSummaries,
  newSourceCache,
  sourceKind,
  type SourceCache,
  type SourceFile,
  type SourceKind,
  type SourceReader,
} from '../src/host/sourceCache.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });
const nameOf = (path: string): string => path.slice('/fx/'.length);

// Deliberately NOT alphabetical: the pass must return these in the order it was GIVEN them,
// because that order is folder order, and folder order decides which of two same-named
// dictionaries wins a name and what order blocks are listed in a Usage cell.
const CORPUS = ['model_with_refs.slx', 'chain_top.sldd', 'nd_numeric.mat', 'chain_leaf.sldd', 'shared_gain.slx'];
const FILES = CORPUS.map(file);

// One file the reader refuses from the `stat` alone — oversized, or gone between the glob and
// the read. It has no bytes on disk either, so a pass that tried to read it would fail loudly
// rather than quietly passing.
const REFUSED = file('too_big.sldd');

let versions: string[] = [];
let reads: string[] = [];
// Both calls in ONE ordered list (`version:<path>` / `bytes:<path>`), which is the only way an
// ORDER can be asserted: an index into `versions` and an index into `reads` cannot be compared,
// because they count different things.
let calls: string[] = [];
// Versions the reader reports, by path — a test moves one entry to move one file on disk.
let stamp: Map<string, string>;

// How long the reader takes over each file, in REVERSE corpus order: the first file is the
// slowest, so completion order is the exact inverse of input order. Without this the reader
// answered every file after the same number of microtask ticks, which made completion order
// and input order identical — so the order assertion below passed whether the pass wrote by
// index or appended as reads finished, and the property it names was not being tested at all.
// mapLimited's cap is 8 and the corpus is five files, so all five are in flight together and
// the delays decide the order outright.
//
// The stagger is in `version` rather than `bytes` because that is the call every pass makes:
// it inverts the CACHED pass too, where nothing is read and the entries come straight back out
// of the map. Files no ordering test names (the refused one, the project) get no delay.
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = new Map(CORPUS.map((name, i) => [file(name).path, (CORPUS.length - i) * 4]));

const reader: SourceReader = {
  version: async (f) => {
    versions.push(f.path);
    calls.push(`version:${f.path}`);
    await sleep(DELAY_MS.get(f.path) ?? 0);
    return stamp.get(f.path) ?? null;
  },
  bytes: async (f) => {
    reads.push(f.path);
    calls.push(`bytes:${f.path}`);
    return bytesOf(nameOf(f.path));
  },
};

const once = (paths: string[]): string[] => [...paths].sort();

beforeEach(() => {
  versions = [];
  reads = [];
  calls = [];
  stamp = new Map(FILES.map((f) => [f.path, `v1:${f.path}`]));
});

describe('what a cheap pass reads', () => {
  it('stats every candidate once and reads every candidate once, cold', async () => {
    const cache = newSourceCache();
    await cheapAll(cache, reader, FILES);
    // Exactly once each, in both lists: a duplicate would survive a set comparison, so these
    // compare the raw call lists against the corpus.
    expect(once(versions)).toEqual(once(FILES.map((f) => f.path)));
    expect(once(reads)).toEqual(once(FILES.map((f) => f.path)));
  });

  it('reads NOTHING on a second pass whose versions have not moved', async () => {
    const cache = newSourceCache();
    await cheapAll(cache, reader, FILES);
    versions = [];
    reads = [];
    await cheapAll(cache, reader, FILES);
    // The pass a consumer makes over a folder it has already paid for: a folder of `stat`s
    // and no bytes at all. This is the property that makes it affordable for four consumers
    // to each make the pass.
    expect(reads).toEqual([]);
    expect(once(versions)).toEqual(once(FILES.map((f) => f.path)));
  });

  it('re-reads exactly the one file whose version moved', async () => {
    const cache = newSourceCache();
    await cheapAll(cache, reader, FILES);
    reads = [];
    stamp.set('/fx/chain_leaf.sldd', 'v2:/fx/chain_leaf.sldd');
    await cheapAll(cache, reader, FILES);
    expect(reads).toEqual(['/fx/chain_leaf.sldd']);
  });

  it('returns the same artifact object for an unchanged file, so a consumer holding it is holding the cache', async () => {
    const cache = newSourceCache();
    const first = await cheapAll(cache, reader, FILES);
    const second = await cheapAll(cache, reader, FILES);
    // Identity, not equality: a pass that rebuilt an equal artifact from cached bytes would
    // pass every read count above while still re-deriving the folder.
    expect(second.get(file('chain_top.sldd').uriString)).toBe(first.get(file('chain_top.sldd').uriString));
  });

  it('skips a file the reader refuses, without reading a byte of it', async () => {
    const cache = newSourceCache();
    const cheap = await cheapAll(cache, reader, [...FILES, REFUSED]);
    // A `null` version is the reader saying "do not read this at all" — oversized, or
    // unreadable. The file is still a node elsewhere in the extension; it just has nothing to
    // say here, and it must not be stored either, or the next pass would treat the absence as
    // an answer.
    expect(reads).not.toContain(REFUSED.path);
    expect(cheap.has(REFUSED.uriString)).toBe(false);
    expect(cache.cheap.has(REFUSED.uriString)).toBe(false);
    expect(versions).toContain(REFUSED.path);
  });

  it('keeps the files in the order it was given them, however the reads finish', async () => {
    const cache = newSourceCache();
    const cheap = await cheapAll(cache, reader, FILES);
    // The reader answers in reverse (see DELAY_MS), so this is input order asserted against a
    // pass whose files finished in the OPPOSITE order — which is the only way the assertion
    // says anything. The property belongs to mapLimited's write-by-index; a pass that appended
    // as reads completed would return this corpus exactly backwards.
    expect([...cheap.keys()]).toEqual(FILES.map((f) => f.uriString));
    // And on the cached pass too, where the entries come back out of the cache rather than
    // from a read — the version calls are staggered the same way, so the inversion is there
    // as well.
    const again = await cheapAll(cache, reader, FILES);
    expect([...again.keys()]).toEqual(FILES.map((f) => f.uriString));
  });

  it('reads each file once for two passes running at the same time', async () => {
    // The case a sequential test cannot see, and the one production makes on folder open: the
    // tree's build (a view becoming visible) and a restored tab's usage plan are independent async
    // flows over the same folder, so both reach the same file before either has stored anything.
    // Without an in-flight map both read it, and the "one read per content change" this module
    // exists for holds only for passes that happen not to overlap.
    // The read has to be genuinely IN FLIGHT for the second pass to have anything to join. With
    // the instant reader above, the first pass finishes and stores each file within one microtask
    // drain of its `version` timer, so the second pass finds a plain cache hit and this test would
    // pass whether or not the in-flight map existed at all — the overlap it is named for would
    // never happen.
    const slow: SourceReader = {
      version: reader.version,
      bytes: async (f) => {
        reads.push(f.path);
        calls.push(`bytes:${f.path}`);
        await sleep(8);
        return bytesOf(nameOf(f.path));
      },
    };
    const cache = newSourceCache();
    const [first, second] = await Promise.all([cheapAll(cache, slow, FILES), cheapAll(cache, slow, FILES)]);

    expect(once(reads)).toEqual(once(FILES.map((f) => f.path)));
    // Both passes answered in full, and with the SAME artifacts — the joining pass is holding the
    // cache, exactly as a hit does, not an equal artifact derived from its own read.
    expect([...first.keys()]).toEqual(FILES.map((f) => f.uriString));
    expect([...second.keys()]).toEqual(FILES.map((f) => f.uriString));
    for (const f of FILES) expect(second.get(f.uriString)).toBe(first.get(f.uriString));
  });

  it('does not remember a read that THREW, so the next pass retries it', async () => {
    // The in-flight entry has to be dropped when its work fails, not only when it succeeds. A
    // rejection left in the map is one every later pass joins — so one file that would not read
    // once would never read again, where the version key otherwise retries it on the next pass.
    const cache = newSourceCache();
    const flaky = file('chain_top.sldd');
    let failing = true;
    const throwsOnce: SourceReader = {
      version: reader.version,
      bytes: async (f) => {
        if (failing && f.path === flaky.path) throw new Error('read failed');
        return reader.bytes(f);
      },
    };

    await expect(cheapAll(cache, throwsOnce, FILES)).rejects.toThrow('read failed');
    failing = false;
    const cheap = await cheapAll(cache, throwsOnce, FILES);

    expect(cheap.has(flaky.uriString)).toBe(true);
    // Nothing left in flight once the dust has settled, either — an entry that outlived its work
    // would be a strong reference to an artifact outside the tier that is supposed to own it.
    expect(cache.reading.size).toBe(0);
  });

  it('reads again after the cache is cleared', async () => {
    const cache = newSourceCache();
    await cheapAll(cache, reader, FILES);
    clearSourceCache(cache);
    reads = [];
    await cheapAll(cache, reader, FILES);
    expect(once(reads)).toEqual(once(FILES.map((f) => f.path)));
  });
});

describe('the version is taken BEFORE the bytes, on both paths', () => {
  // Which side of the read the `stat` falls on decides whether a mis-keyed entry heals itself or
  // never does, and only one direction is survivable. A version taken FIRST can only be older than
  // the bytes that follow it, so a file written during the read is keyed too old and the next pass
  // that stats it re-reads — the self-healing this cache's whole invalidation story rests on. A
  // version taken AFTER the bytes can be NEWER than the content it keys, and then every later pass
  // finds a version that matches and hits forever, on content the file no longer has: wrong, silent
  // and permanent.
  //
  // The rule therefore has to hold on both paths that key an entry, and neither of them states it
  // in a way a reader can check — the pass below gets it from the order of two statements, and the
  // adapter gets it from argument-evaluation order. So it is pinned twice, once per path.

  it('stats every file before reading it, in a pass that reads a whole folder', async () => {
    const cache = newSourceCache();
    await cheapAll(cache, reader, FILES);
    for (const f of FILES) {
      // Per file, not across the folder: the reads are concurrent and staggered (see DELAY_MS), so
      // one file's read legitimately lands before another file's `stat`.
      const stat = calls.indexOf(`version:${f.path}`);
      const read = calls.indexOf(`bytes:${f.path}`);
      expect(stat, `${f.path} was never stat'd`).toBeGreaterThanOrEqual(0);
      expect(read, `${f.path} was never read`).toBeGreaterThanOrEqual(0);
      expect(stat, `${f.path} was read before it was stat'd`).toBeLessThan(read);
    }
  });

  it('is the order the vscode adapter uses for a TAB, where only the text can say so', () => {
    // sourceReads.ts imports `vscode` and cannot be loaded in this suite (see vitest.config.ts), so
    // this is a text check for the same reason the entry-point pin in parsedBudget.test.ts is one.
    // What it is guarding against is specific: `scanVersion(uri)` is currently an ARGUMENT, so it
    // completes before the bytes thunk can run, and a refactor that wanted the bytes for something
    // else would hoist the read above it and change nothing that any other test can see.
    const src = blankCommentsAndKeepLines(
      readFileSync(fileURLToPath(new URL('../src/host/sourceReads.ts', import.meta.url)), 'utf8'),
    );
    const from = src.indexOf('export async function parsedModelForTab');
    const to = src.indexOf('export function readerFor');
    expect(from, 'parsedModelForTab was renamed — re-pin the order').toBeGreaterThan(-1);
    expect(to, 'readerFor was moved or renamed — re-pin the slice').toBeGreaterThan(from);
    const tabPath = src.slice(from, to);
    expect(tabPath).toContain('scanVersion(');
    expect(tabPath).toContain('readFile(');
    expect(
      tabPath.indexOf('scanVersion('),
      'the tab path reads the file before it versions it: a stale entry would be permanent',
    ).toBeLessThan(tabPath.indexOf('readFile('));
  });
});

describe('what each kind yields at the cheap tier', () => {
  let cache: SourceCache;

  beforeEach(async () => {
    cache = newSourceCache();
    await cheapAll(cache, reader, FILES);
  });

  it('keeps a model’s WHOLE structure, model→model references included', async () => {
    // The rule that is easy to get backwards. `usagePlan` drops model references when it
    // builds a chain, because a usage scope must not follow them — a referenced model's
    // blocks resolve through its own chain and it is tested on its own. That is a rule about
    // the SCOPE, and the sections tree needs the same references to draw its model→model
    // edges. Dropping them HERE would take them from every consumer to satisfy one.
    const entry = cache.cheap.get(file('model_with_refs.slx').uriString);
    expect(entry?.cheap.kind).toBe('model');
    if (entry?.cheap.kind !== 'model') throw new Error('unreachable');
    expect(entry.cheap.structure.modelReferences).toContain('plant.slx');
    expect(entry.cheap.structure.dataDictionary).toBe('params.sldd');
    expect(entry.cheap.structure.externalDataSources).toContain('signals.mat');
  });

  it('summarises a dictionary — references AND names — from the one read', async () => {
    // Reading a data file's references IS summarising it, which is why there is no cheaper
    // tier for one. `chain_top.sldd` is a ZIP whose reference to `chain_leaf.sldd` is inside
    // the archive, so this is also the case a text-scraping tier would report as having no
    // references at all.
    const entry = cache.cheap.get(file('chain_top.sldd').uriString);
    if (entry?.cheap.kind !== 'sldd') throw new Error(`expected a dictionary, got ${entry?.cheap.kind}`);
    const summarised = [...entry.cheap.summary.slddByName.values()];
    expect(summarised.length).toBe(1);
    expect(summarised[0].slddRefs).toContain('chain_leaf.sldd');
    expect(summarised[0].srcId).toBe(file('chain_top.sldd').uriString);
  });

  it('carries a dictionary’s references RAW as well, beside the summary’s reduced ones', async () => {
    // Two lists off the same bytes, and the artifact keeps both because its consumers need
    // different ones: a usage chain resolves through core's reduced `slddRefs` (basename,
    // lower-cased) and the sections tree labels an unresolved reference with what the file
    // SAYS. This fixture spells its reference the same way either way — the case that pulls
    // them apart is a pathful, mixed-case reference, and it is pinned where the tree is
    // (treeSources.test.ts), against the row the user would read.
    const entry = cache.cheap.get(file('chain_top.sldd').uriString);
    if (entry?.cheap.kind !== 'sldd') throw new Error(`expected a dictionary, got ${entry?.cheap.kind}`);
    expect(entry.cheap.refs).toEqual(['chain_leaf.sldd']);
  });

  it('summarises a MAT-file, whose references are empty by definition', async () => {
    const entry = cache.cheap.get(file('nd_numeric.mat').uriString);
    if (entry?.cheap.kind !== 'mat') throw new Error(`expected a MAT-file, got ${entry?.cheap.kind}`);
    const summarised = [...entry.cheap.summary.matByName.values()];
    expect(summarised.length).toBe(1);
    // A MAT-file inherits nothing, so a chain out of one would reach files core's own
    // resolver never would.
    expect(summarised[0].slddRefs).toEqual([]);
    // The names came out of the same call, which is the collapse that makes a data file's
    // cheap tier its whole summary: search needs nothing more than this.
    expect([...summarised[0].names]).toEqual(['Mat', 'Nd', 'Nd4', 'Vec']);
  });

  it('does not summarise a model at the cheap tier', async () => {
    // The whole point of the two tiers: a model's summary costs a full `parseModel`, so the
    // cheap pass must not have produced one. Nothing in `cache.models` until something asks.
    expect(cache.models.size).toBe(0);
  });
});

describe('a project is classified as a project, not defaulted into a dictionary', () => {
  // The trap this replaces: the classifier answered "dictionary" for anything it did not
  // recognise, which was safe only because the usage candidate glob excluded projects. A
  // `.prj` reaching it would have been read as a dictionary — a read of a marker file, an
  // empty summary, and a project admitted to the usage graph.
  const PRJ = file('MyProj.prj');

  // Which kind each extension the glob offers must classify as. Written out by hand — this is
  // the mapping, so deriving it from the thing it pins would assert nothing — but KEYED by
  // SUPPORTED_EXTS, so a format that joins the list and not `sourceKind` fails to compile here
  // and, since vitest does not typecheck, fails the set comparison below at run time too.
  //
  // fileTypes.test.ts pins that list against core's kind PREDICATES; it never imports
  // `sourceKind`, so it cannot see this third copy of the same rule. Nothing else can either,
  // which is why the derivation is here: a `.slxp` added to the list and to core's tests would
  // otherwise pass both halves of that pin while `sourceKind` answered `null`, and a file this
  // pass answers `null` for is one the glob finds and the tree lists and the cache drops.
  const KIND_OF: Readonly<Record<(typeof SUPPORTED_EXTS)[number], SourceKind>> = {
    slx: 'model',
    mdl: 'model',
    sldd: 'sldd',
    mat: 'mat',
    prj: 'prj',
  };

  // The kinds this cache holds an artifact for — every one in KIND_OF except `prj`, which is
  // classified and never cached. Written out beside the table above so the exception is a
  // statement rather than the absence of one: `sourceKind` naming a kind and `cheapAll`
  // storing an artifact for it are two different claims, and the tests below check both.
  const NEVER_CACHED: readonly SourceKind[] = ['prj'];

  it('names a kind for every extension the glob offers, and none for anything else', () => {
    // Set equality in both directions: an extension in the list with no entry here, or an
    // entry here for an extension discovery never offers.
    expect(Object.keys(KIND_OF).sort()).toEqual([...SUPPORTED_EXTS].sort());
    for (const ext of SUPPORTED_EXTS) {
      // Two assertions, not one. `not.toBeNull` is the property that matters — a `null` is a
      // file dropped from the pass — and the exact kind is what keeps this a pin on the
      // MAPPING rather than on "some kind, any kind".
      expect(sourceKind(`/w/thing.${ext}`), `.${ext} must not drop out of the pass`).not.toBeNull();
      expect(sourceKind(`/w/thing.${ext}`), `.${ext} is a ${KIND_OF[ext]}`).toBe(KIND_OF[ext]);
      // Upper-cased too, because the glob finds `Params.SLDD` and core's predicates accept it:
      // a kind test stricter than the glob is the disagreement this whole indirection removes.
      expect(sourceKind(`/w/Thing.${ext.toUpperCase()}`), `.${ext.toUpperCase()} is a ${KIND_OF[ext]}`).toBe(
        KIND_OF[ext],
      );
    }
    // Not a dictionary. A kind nothing here reads is a file dropped from the pass.
    expect(sourceKind('/w/notes.txt')).toBeNull();
  });

  it('caches an artifact for every kind it names EXCEPT the never-cached ones', async () => {
    // The other direction of the same table, checked against the PASS rather than against the
    // table: a kind with no arm in `Cheap` is a file this cache silently drops, and a file
    // silently dropped is how a `.prj` came to be read as a dictionary in the first place. So
    // every supported extension is run through a real pass here, and the only ones allowed to
    // come back with nothing are the ones named above.
    //
    // The bytes are four bytes of nothing on purpose. Every cacheable kind must still produce
    // an artifact for a file it cannot make sense of — that is the "still a node, just no
    // relationships" rule the tree and the usage graph both depend on — so a `null` here is
    // about the KIND and cannot be about the content.
    const junk = new Uint8Array([1, 2, 3, 4]).buffer;
    for (const ext of SUPPORTED_EXTS) {
      const f = file(`thing.${ext}`);
      const oneReader: SourceReader = { version: async () => 'v1', bytes: async () => junk };
      const cheap = await cheapAll(newSourceCache(), oneReader, [f]);
      const cached = !NEVER_CACHED.includes(KIND_OF[ext]);
      expect(cheap.has(f.uriString), `.${ext} (${KIND_OF[ext]}) cached: expected ${cached}`).toBe(cached);
    }
  });

  it('classifies a project and then caches NOTHING for it, on every pass', async () => {
    // Decision 8, and the phase-1 speculation this replaces: a `.prj`'s structure is a sibling
    // `resources/project/` tree, not the marker file's bytes, so the marker's `mtime:size`
    // cannot key it — a store cached against it would go stale on every edit inside that tree
    // with no `stat` able to notice. The cache therefore holds none, the ONE consumer that
    // wants a project's structure fetches it per build (treeSources.test.ts pins that), and
    // what is left here is the part that must never regress: the marker is not read as a
    // dictionary.
    stamp.set(PRJ.path, `v1:${PRJ.path}`);
    const cache = newSourceCache();
    const cheap = await cheapAll(cache, reader, [...FILES, PRJ]);
    expect(sourceKind(PRJ.path)).toBe('prj');
    expect(reads).not.toContain(PRJ.path);
    expect(cheap.has(PRJ.uriString)).toBe(false);
    // And nothing is REMEMBERED about it either, so a project cannot be served out of the
    // cache at a stale version: there is nothing to serve.
    expect(cache.cheap.has(PRJ.uriString)).toBe(false);
    const again = await cheapAll(cache, reader, [...FILES, PRJ]);
    expect(again.has(PRJ.uriString)).toBe(false);
    expect(reads).not.toContain(PRJ.path);
  });

  it('never summarises a project, however it got into the wanted set', async () => {
    stamp.set(PRJ.path, `v1:${PRJ.path}`);
    const cache = newSourceCache();
    const files = [...FILES, PRJ];
    const cheap = await cheapAll(cache, reader, files);
    await fillModelSummaries(cache, reader, files, new Set(files.map((f) => f.uriString)), cheap);
    expect(cache.models.has(PRJ.uriString)).toBe(false);
  });
});

describe('what the expensive tier reads', () => {
  const wanted = (...names: string[]): Set<string> => new Set(names.map((n) => file(n).uriString));

  it('summarises only the wanted models, and no data file', async () => {
    const cache = newSourceCache();
    const cheap = await cheapAll(cache, reader, FILES);
    reads = [];
    // A set naming one model and two dictionaries: the dictionaries were already summarised
    // by the cheap pass, so the only read here is the one model's.
    await fillModelSummaries(cache, reader, FILES, wanted('shared_gain.slx', 'chain_top.sldd', 'chain_leaf.sldd'), cheap);
    expect(reads).toEqual(['/fx/shared_gain.slx']);
    expect([...cache.models.keys()]).toEqual([file('shared_gain.slx').uriString]);
    expect(cache.models.get(file('shared_gain.slx').uriString)?.summary.models.map((m) => m.srcId)).toEqual([
      file('shared_gain.slx').uriString,
    ]);
  });

  it('summarises a model once, however many times it is wanted', async () => {
    const cache = newSourceCache();
    const cheap = await cheapAll(cache, reader, FILES);
    await fillModelSummaries(cache, reader, FILES, wanted('shared_gain.slx'), cheap);
    reads = [];
    // The second consumer, or the second tab. This is the memoization the tiers exist for: a
    // model is parsed once per content change, not once per asker.
    await fillModelSummaries(cache, reader, FILES, wanted('shared_gain.slx', 'model_with_refs.slx'), cheap);
    expect(reads).toEqual(['/fx/model_with_refs.slx']);
  });

  it('re-summarises a model whose version moved, and only that one', async () => {
    const cache = newSourceCache();
    let cheap = await cheapAll(cache, reader, FILES);
    const both = wanted('shared_gain.slx', 'model_with_refs.slx');
    await fillModelSummaries(cache, reader, FILES, both, cheap);
    stamp.set('/fx/shared_gain.slx', 'v2:/fx/shared_gain.slx');
    cheap = await cheapAll(cache, reader, FILES);
    reads = [];
    await fillModelSummaries(cache, reader, FILES, both, cheap);
    expect(reads).toEqual(['/fx/shared_gain.slx']);
  });
});
