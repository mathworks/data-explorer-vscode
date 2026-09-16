// Copyright 2026 The MathWorks, Inc.
//
// ONE scan of a data file, read three ways — asserted to say what three separate readings of it
// said, over every `.sldd` and `.mat` fixture in this repo, in both on-disk spellings.
//
// The cheap tier used to read a dictionary three times: `summarizeFiles` scanned it for the usage
// summary, `refsFromSlddBytes` scanned it again for the reference list, and the name index scanned
// it a third time for the entry names. Now `dataCheapOf` scans once and the artifact carries all
// three (sourceCache.ts). That is a speed change whose whole risk is in the ANSWERS: every one of
// the three is consumed somewhere a wrong answer is invisible — a tree edge that is simply not
// drawn, a search that simply does not find a name, a Usage cell that simply says nothing. So this
// suite is the equality, per fixture, in the style usageScopeEquality.test.ts uses for the scoped
// usage graph: exhaustive over the corpus rather than illustrative, and read from the directory so
// a fixture added for some other suite is covered here too.
//
// Each of the three is checked against TWO things, and the second is what makes the suite worth
// running:
//
//   * the route it replaced — for `refs`, the retired regex over the raw text, inlined below
//     because the function is gone (slddRefs.ts says why). Its answers are the shipped answers of
//     every release before this one.
//   * an independent ORACLE built from the FULL readers — `readSlddContent` and `parseMat`, which
//     decode the whole file and share no code with the scanners. This is the half that cannot pass
//     vacuously: `summarizeSlddScan` and the artifact now come from the same scan by construction,
//     so comparing them to each other would agree even if the scan itself were wrong. Core's
//     test/usageScanSummary.test.ts makes exactly this argument for the summariser, and records a
//     mutation (dropping `filter(Boolean)`) that its shared-code sweep missed and its full-reader
//     oracle caught. Same shape here, one layer up.
//
// The names oracle is ORDERED and includes the `''` placeholders, which is stronger than core's
// (it compares the summary's deduped Set). That is deliberate: the search index is this repo's
// consumer of `Cheap.names`, its contract is one record per OCCURRENCE, and a Set round-trip
// anywhere on that path is invisible to every other assertion here.
import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  isJsonTextBytes,
  isMatFile,
  isSlddFile,
  normalizeRefNames,
  parseMat,
  refBasename,
  scanMat,
  slddChunkContent,
} from 'data-explorer-core';
import { namesFromMat, namesFromSldd, type NameRecord } from '../src/host/nameExtract.js';
import { namesOfFile, type NameReader } from '../src/host/nameScan.js';
import { readSlddContent, scanSldd } from '../src/host/slddContent.js';
import {
  cheapOne,
  newSourceCache,
  type Cheap,
  type SourceCache,
  type SourceFile,
} from '../src/host/sourceCache.js';

const ROOT = import.meta.dirname;

// Every data-file fixture under test/, at any depth: test/fixtures (the unit corpus), its
// mcos/ subdirectory (MAT-files holding objects, which is where the `''` placeholder lives) and
// test/parity/artifacts/{text,binary} (MATLAB-generated, the same dictionaries in both formats).
// Read from the directory rather than listed, and by core's own extension tests rather than by
// a suffix written here, so this walks exactly the set the extension would pick up.
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (isSlddFile(e.name) || isMatFile(e.name)) out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

const CORPUS = walk(ROOT).sort();
const SLDD = CORPUS.filter(isSlddFile);
const MAT = CORPUS.filter(isMatFile);

/**
 * One dictionary that is BUILT and not read, and the two reasons it has to be — both of them
 * measured over the corpus rather than assumed (see the counting sweep below).
 *
 * No fixture in the corpus holds two entries with the SAME name, and that is exactly the property
 * `Cheap.names` exists for: Design Data and Other Data are separate namespaces, so pasting `Array`
 * from one into the other keeps the name (core's duplicateNameIdentity test), and the search
 * index's contract is one record per OCCURRENCE. A deduped array would satisfy every other
 * assertion in this file.
 *
 * No dictionary fixture holds an UNNAMED entry either — every `''` placeholder in the corpus comes
 * from a MAT-file, where the anonymous trailing element of an MCOS file supplies them in quantity.
 * So the ordered `names` array and the summary's filtered Set are indistinguishable over the
 * dictionaries on disk, which is the other thing this file is here to tell apart.
 *
 * Built rather than committed because a real one takes MATLAB to produce, and the shape a textual
 * dictionary carries is small enough to write: the three-key `__MW_TEXT_PARTS__` wrapper core's
 * readers look inside. It joins the corpus sweeps below, so it gets the same full-reader oracle
 * every fixture gets — which is what makes it evidence rather than a hand-written expectation.
 */
const DUPS = 'synthetic/duplicate_names.sldd';
const synthetic = new Map<string, ArrayBuffer>([
  [
    DUPS,
    new TextEncoder().encode(
      JSON.stringify({
        __MW_TEXT_PARTS__: {
          '__MW_TEXT_PART__/data/chunk0': {
            __MW_TEXT_content: {
              entries: [{ name: 'Kp' }, { name: 'Kp' }, {}, { name: 'Uo' }, { name: 'Ki' }],
              'Dictionary References': ['Shared/Common.sldd'],
            },
          },
        },
      }),
    ).buffer as ArrayBuffer,
  ],
]);

// What every sweep iterates: the directory, plus the one dictionary the directory cannot supply.
const DICTS = [...SLDD, DUPS];
const DATA = [...CORPUS, DUPS];

function bytesOf(name: string): ArrayBuffer {
  const built = synthetic.get(name);
  if (built) return built;
  const b = readFileSync(join(ROOT, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// A fixture as the cache sees one. The uri carries the fixture's whole relative path because
// several basenames repeat across the corpus (three `params.sldd`, two `signals.mat`); the PATH
// keeps the real basename, which is what core keys a summary by.
const asFile = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });
const fixtureOf = (file: SourceFile): string => file.path.slice('/fx/'.length);

// Reads are counted because "reads once" is the claim, and the only way to state it is to watch
// the reads. `dirtyBytes` is empty except in the buffer test at the end.
let reads: string[] = [];
const dirty = new Map<string, ArrayBuffer>();
const reader: NameReader = {
  version: async (file) => `v1:${file.path}`,
  bytes: async (file) => {
    reads.push(file.path);
    return bytesOf(fixtureOf(file));
  },
  dirtyBytes: (file) => dirty.get(file.uriString) ?? null,
};

async function cheapOf(cache: SourceCache, name: string): Promise<Cheap> {
  const entry = await cheapOne(cache, reader, asFile(name));
  if (!entry) throw new Error(`no cheap artifact for ${name}`);
  return entry.cheap;
}

/**
 * The reference list as every release before this one read it: core's format sniff, then the
 * regex for a textual dictionary and `scanSldd` for a compressed one.
 *
 * A verbatim inline of the retired `refsFromSlddBytes`/`extractReferences` (git history has the
 * originals). Inlined rather than kept in `src/`, because a function no shipping code calls is
 * dead weight that still has to be maintained — but its ANSWERS are the ones users have been
 * getting, so they are worth pinning once against the reader that replaced it.
 *
 * The compressed arm is the same `scanSldd` the new route runs, so on those fixtures the equality
 * below holds by construction; the textual arm is where the routes genuinely differ, and the
 * corpus guard checks both spellings are present in quantity.
 */
function retiredRefs(bytes: ArrayBuffer): string[] {
  const u8 = new Uint8Array(bytes);
  if (!isJsonTextBytes(u8)) return scanSldd(bytes).refs;
  const match = new TextDecoder().decode(u8).match(/"Dictionary References"\s*:\s*(\[[^\]]*\])/);
  if (!match) return [];
  try {
    return normalizeRefNames(JSON.parse(match[1]));
  } catch {
    return [];
  }
}

// --- the oracles: the FULL readers, which share no code with the scanners -------------------

/** A dictionary's content the expensive way: decode the entire file, then take the one key. */
function fullContent(bytes: ArrayBuffer): Record<string, unknown> | null {
  return slddChunkContent(readSlddContent(bytes, []));
}

function fullSlddRefs(bytes: ArrayBuffer): string[] {
  const content = fullContent(bytes);
  return content ? normalizeRefNames(content['Dictionary References']) : [];
}

/**
 * Every entry's name, in file order, `''` where an entry has no readable one — the shape
 * `scanSldd` reports, derived from the full parse instead.
 *
 * The placeholder is core's contract and not an accident: a caller indexing POSITIONALLY would be
 * shifted by one without it (nameExtract.ts).
 */
function fullSlddNames(bytes: ArrayBuffer): string[] {
  const entries = (fullContent(bytes)?.entries ?? []) as { name?: unknown }[];
  return entries.map((e) => (typeof e?.name === 'string' ? e.name : ''));
}

function fullMatNames(bytes: ArrayBuffer): string[] {
  return parseMat(bytes).variables.map((v) => (typeof v?.name === 'string' ? v.name : ''));
}

beforeEach(() => {
  reads = [];
  dirty.clear();
});

describe('the corpus this suite sweeps', () => {
  it('holds data files of both kinds, in both on-disk spellings', () => {
    // A guard on the test itself: every sweep below iterates the corpus, so an empty or
    // one-format corpus would pass all of them while asserting nothing.
    expect(SLDD.length).toBeGreaterThan(15);
    expect(MAT.length).toBeGreaterThan(5);
    // The pairs that exist precisely to be the same dictionary twice.
    expect(SLDD).toContain('fixtures/rt_text.sldd');
    expect(SLDD).toContain('fixtures/rt_bin.sldd');
    expect(SLDD).toContain('parity/artifacts/text/params.sldd');
    expect(SLDD).toContain('parity/artifacts/binary/params.sldd');
    // And the split is real, by core's sniff rather than by the file names above.
    const textual = SLDD.filter((n) => isJsonTextBytes(new Uint8Array(bytesOf(n))));
    expect(textual.length).toBeGreaterThan(5);
    expect(SLDD.length - textual.length).toBeGreaterThan(5);
  });
});

describe('a dictionary’s RAW references, one scan against the two readers it replaced', () => {
  it('matches the retired regex route on every fixture', async () => {
    const cache = newSourceCache();
    for (const name of DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect(cheap.refs, name).toEqual(retiredRefs(bytesOf(name)));
    }
  });

  it('matches the full reader on every fixture', async () => {
    const cache = newSourceCache();
    for (const name of DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect(cheap.refs, name).toEqual(fullSlddRefs(bytesOf(name)));
    }
  });

  it('is not comparing empty reference lists', async () => {
    // Non-vacuity for both sweeps above: most fixtures reference nothing, and equality over a
    // corpus of empty lists is no evidence at all. `chain_top.sldd` is the compressed one whose
    // reference lives inside the zip, and the parity dictionaries are MATLAB's own.
    const cache = newSourceCache();
    const refsOf = async (name: string): Promise<readonly string[]> => {
      const cheap = await cheapOf(cache, name);
      return cheap.kind === 'sldd' ? cheap.refs : [];
    };
    expect(await refsOf('fixtures/chain_top.sldd')).toEqual(['chain_leaf.sldd']);
    expect(await refsOf('parity/artifacts/text/params.sldd')).toContain('common.sldd');
    expect(await refsOf('parity/artifacts/binary/params.sldd')).toContain('common.sldd');
  });

  it('keeps the literal spelling the summary lower-cases away', async () => {
    // WHY the artifact carries `refs` at all rather than reading them back off the summary: the
    // summary's list is `refs.map(refBasename)`, which is what a NAME resolves through, and the
    // tree needs what the file SAYS. Both come off the same scan, so this is the one property
    // that would survive them being confused for each other.
    const cache = newSourceCache();
    for (const name of DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      const summary = cheap.summary.slddByName.get(refBasename(`/fx/${name}`));
      expect(summary?.slddRefs, name).toEqual(cheap.refs.map(refBasename));
    }
  });
});

describe('a data file’s usage summary, against one built by the FULL reader', () => {
  // The summariser now runs on the cheap tier's scan instead of on its own read of the file. Core
  // owns the reduction (`summarizeSlddScan`/`summarizeMatScan`, the same call `summarizeFiles`
  // makes), so what is at risk here is what this host hands it — the scan, the srcId and the
  // filename — and a wrong srcId silently re-keys every Usage answer that resolves through the
  // summary. The expected object is spelled out from the full parse for that reason: it is the
  // whole `DataSummary`, so nothing about it can be right by construction.
  it('gives every dictionary the summary its full parse implies', async () => {
    const cache = newSourceCache();
    for (const name of DICTS) {
      const file = asFile(name);
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect([...cheap.summary.slddByName.keys()], name).toEqual([refBasename(file.path)]);
      expect(cheap.summary.slddByName.get(refBasename(file.path)), name).toEqual({
        srcId: file.uriString,
        names: new Set(fullSlddNames(bytesOf(name)).filter((n) => n !== '')),
        slddRefs: fullSlddRefs(bytesOf(name)).map(refBasename),
      });
      // A dictionary contributes no models and no MAT-files, whichever route built it.
      expect(cheap.summary.models, name).toEqual([]);
      expect(cheap.summary.matByName.size, name).toBe(0);
    }
  });

  it('gives every MAT-file the summary its full parse implies', async () => {
    const cache = newSourceCache();
    for (const name of MAT) {
      const file = asFile(name);
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'mat') throw new Error(`${name} is not a MAT-file to this cache`);
      expect([...cheap.summary.matByName.keys()], name).toEqual([refBasename(file.path)]);
      expect(cheap.summary.matByName.get(refBasename(file.path)), name).toEqual({
        srcId: file.uriString,
        names: new Set(fullMatNames(bytesOf(name)).filter((n) => n !== '')),
        // A MAT-file inherits nothing, and this is not a field the scan could fill.
        slddRefs: [],
      });
      expect(cheap.summary.models, name).toEqual([]);
      expect(cheap.summary.slddByName.size, name).toBe(0);
    }
  });

  it('is not comparing empty summaries', async () => {
    const cache = newSourceCache();
    const namesOf = async (name: string): Promise<Set<string>> => {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind === 'model') return new Set();
      const data = [...cheap.summary.slddByName.values(), ...cheap.summary.matByName.values()][0];
      return new Set(data?.names ?? []);
    };
    expect(await namesOf('fixtures/params.sldd')).toContain('Kp');
    expect(await namesOf('parity/artifacts/binary/params.sldd')).toContain('gravity');
    expect(await namesOf('fixtures/nd_numeric.mat')).toContain('Nd4');
  });
});

describe('the occurrence-ordered names the search index reads', () => {
  // `Cheap.names` is the scan's own array — one string per entry, in file order, placeholders
  // included — and the summary's `Set` is built from it. Every property that distinguishes the two
  // is asserted here, because nothing else in this repo can see the difference: a Set round-trip
  // on this path would drop a duplicate search hit and no other test would move.
  it('is what the full parse lists, in order, for every dictionary', async () => {
    const cache = newSourceCache();
    for (const name of DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect(cheap.names, name).toEqual(fullSlddNames(bytesOf(name)));
    }
  });

  it('is what the full parse lists, in order, for every MAT-file', async () => {
    const cache = newSourceCache();
    for (const name of MAT) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'mat') throw new Error(`${name} is not a MAT-file to this cache`);
      expect(cheap.names, name).toEqual(fullMatNames(bytesOf(name)));
    }
  });

  it('really does carry duplicates and empty placeholders', async () => {
    // Non-vacuity for the two sweeps above, and the measurement that justifies `DUPS` existing:
    // the fixtures on disk supply the `''` placeholder in quantity (every MAT-file holding an
    // MCOS object carries a trailing anonymous element) and supply NO duplicate name at all, so
    // over the directory alone a deduped array would pass every assertion in this file.
    const counted = async (list: readonly string[]) => {
      const cache = newSourceCache();
      let duplicates = 0;
      let placeholders = 0;
      for (const name of list) {
        const cheap = await cheapOf(cache, name);
        if (cheap.kind === 'model') continue;
        if (new Set(cheap.names).size < cheap.names.length) duplicates++;
        if (cheap.names.includes('')) placeholders++;
      }
      return { duplicates, placeholders };
    };
    const fixtures = await counted(CORPUS);
    expect(fixtures.placeholders).toBeGreaterThan(0);
    expect(fixtures.duplicates).toBe(0);
    // And the placeholders on disk are all MAT-files' — which is why `DUPS` carries one too.
    expect((await counted(SLDD)).placeholders).toBe(0);
    const withBoth = await counted(DATA);
    expect(withBoth.duplicates).toBeGreaterThan(0);
    expect(withBoth.placeholders).toBeGreaterThan(fixtures.placeholders);
  });

  it('keeps a duplicate name twice, and the placeholder, where the summary keeps neither', async () => {
    // The same facts stated as the answers themselves, on the one dictionary that has both. All
    // three fields come off one scan, so this is the reduction being visible: the array is what
    // the file holds, in order, and the Set is what a name resolves through.
    const cache = newSourceCache();
    const cheap = await cheapOf(cache, DUPS);
    if (cheap.kind !== 'sldd') throw new Error('expected a dictionary');
    expect(cheap.names).toEqual(['Kp', 'Kp', '', 'Uo', 'Ki']);
    expect([...(cheap.summary.slddByName.get('duplicate_names.sldd')?.names ?? [])]).toEqual([
      'Kp',
      'Uo',
      'Ki',
    ]);
    // And search finds both `Kp`s and no empty record: the hit a Set on this path would lose, and
    // the unsearchable record a missing filter would add.
    const records = await namesOfFile(cache, reader, asFile(DUPS));
    expect(records.map((r) => r.name)).toEqual(['Kp', 'Kp', 'Uo', 'Ki']);
  });

  it('hands the search index the SAME strings, not copies of them', async () => {
    // The other half of "no second copy": the array is core's own and the Set holds the same
    // string objects, so a folder of dictionaries costs one array of names and not two. Object
    // identity is the only way to state it, and `Object.is` on an interned short string proves
    // nothing — so this is checked on the array, which is what a defensive copy would clone.
    const cache = newSourceCache();
    const first = await cheapOf(cache, 'fixtures/params.sldd');
    const second = await cheapOf(cache, 'fixtures/params.sldd');
    if (first.kind !== 'sldd' || second.kind !== 'sldd') throw new Error('expected dictionaries');
    expect(second.names).toBe(first.names);
    expect(second.refs).toBe(first.refs);
  });
});

describe('the search index over the shared scan', () => {
  // Fix 4's own equality: what `namesOfFile` returns THROUGH the cache must be what its own
  // scan of the bytes returned, record for record. `NameRecord[]` and not a name list, because
  // the records are what the index stores and the fields it fills (kind, sourceLabel) are part
  // of the answer.
  const directRecords = (name: string): NameRecord[] => {
    const { uriString } = asFile(name);
    const bytes = bytesOf(name);
    return isMatFile(name)
      ? namesFromMat(scanMat(bytes).names, uriString)
      : namesFromSldd(scanSldd(bytes).names, uriString);
  };

  it('returns exactly the records a direct scan of the file returns', async () => {
    const cache = newSourceCache();
    for (const name of DATA) {
      const records = await namesOfFile(cache, reader, asFile(name));
      expect(records, name).toEqual(directRecords(name));
    }
  });

  it('drops the placeholders and keeps the duplicates', async () => {
    // The two ways the records differ from `Cheap.names`, asserted as counts over the corpus so
    // that neither can be satisfied by the other. A Set anywhere on this path would make the
    // second number wrong; a `filter(Boolean)` missing from `nameExtract` would make the first.
    const cache = newSourceCache();
    let placeholders = 0;
    let duplicates = 0;
    for (const name of DATA) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind === 'model') continue;
      const records = await namesOfFile(cache, reader, asFile(name));
      expect(records.map((r) => r.name), name).toEqual(cheap.names.filter((n) => n !== ''));
      placeholders += cheap.names.filter((n) => n === '').length;
      duplicates += cheap.names.length - new Set(cheap.names).size;
    }
    expect(placeholders).toBeGreaterThan(0);
    expect(duplicates).toBeGreaterThan(0);
  });

  it('reads each file ONCE whichever tier asked first', async () => {
    // The point of the change, as reads. Both orders, because both happen: the tree's folder
    // pass fills the artifact and search reads it, or a search runs first and the tree's pass
    // finds the artifact already there.
    for (const name of DATA) {
      const searchFirst = newSourceCache();
      const records = await namesOfFile(searchFirst, reader, asFile(name));
      expect(reads, name).toEqual([`/fx/${name}`]);
      const cheap = await cheapOf(searchFirst, name);
      expect(reads, name).toEqual([`/fx/${name}`]);
      expect(cheap.kind, name).not.toBe('model');

      reads = [];
      const cheapFirst = newSourceCache();
      await cheapOf(cheapFirst, name);
      expect(reads, name).toEqual([`/fx/${name}`]);
      expect(await namesOfFile(cheapFirst, reader, asFile(name)), name).toEqual(records);
      expect(reads, name).toEqual([`/fx/${name}`]);
      reads = [];
    }
  });
});

describe('an unsaved buffer stays out of the shared cache, in both directions', () => {
  // The one thing this scan must NOT share, kept as a sweep because it is the rule the whole
  // change could have broken quietly. nameScan.test.ts pins it over a synthetic disk with an
  // edited name; this pins it over real fixture bytes, by handing each file the NEXT fixture's
  // content as its unsaved buffer — a buffer that could not possibly be mistaken for what is on
  // disk, so both halves of the rule are visible in one answer.
  const shifted = (list: string[]): [string, string][] =>
    list.map((name, i) => [name, list[(i + 1) % list.length]]);

  it('answers from the buffer and caches nothing for it', async () => {
    const cache = newSourceCache();
    for (const [name, other] of [...shifted(DICTS), ...shifted(MAT)]) {
      const file = asFile(name);
      const buffer = bytesOf(other);
      dirty.set(file.uriString, buffer);
      const records = await namesOfFile(cache, reader, file);
      // The buffer's names under the FILE's identity: that is what the index stores, and it is
      // how a rename in an open dictionary stops search offering the old name.
      const expected = isMatFile(name)
        ? namesFromMat(scanMat(buffer).names, file.uriString)
        : namesFromSldd(scanSldd(buffer).names, file.uriString);
      expect(records, `${name} <- ${other}`).toEqual(expected);
      expect(cache.cheap.has(file.uriString), `${name} <- ${other}`).toBe(false);
      expect(reads, `${name} <- ${other}`).toEqual([]);
      dirty.delete(file.uriString);
    }
  });

  it('takes no cached scan for a file whose buffer disagrees with disk', async () => {
    // The other direction, and the one a cache makes tempting: the artifact is already there,
    // at the version on disk, and it is the stale content the override exists to avoid.
    const cache = newSourceCache();
    const file = asFile('fixtures/params.sldd');
    const onDisk = await namesOfFile(cache, reader, file);
    expect(cache.cheap.has(file.uriString)).toBe(true);
    reads = [];

    const buffer = bytesOf('fixtures/chain_leaf.sldd');
    dirty.set(file.uriString, buffer);
    const records = await namesOfFile(cache, reader, file);
    expect(records).toEqual(namesFromSldd(scanSldd(buffer).names, file.uriString));
    expect(records).not.toEqual(onDisk);
    // Nothing read (the buffer was there) and the artifact untouched — still the disk answer,
    // for the tab and the Usage plan that share it.
    expect(reads).toEqual([]);
    const cheap = cache.cheap.get(file.uriString)?.cheap;
    if (cheap?.kind !== 'sldd') throw new Error(`expected a dictionary, got ${cheap?.kind}`);
    expect(namesFromSldd(cheap.names, file.uriString)).toEqual(onDisk);
  });
});
