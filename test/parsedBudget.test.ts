// Copyright 2026 The MathWorks, Inc.
//
// `SourceCache.parsed` is BOUNDED, and dropping an entry from it costs a re-parse and never an
// answer.
//
// Those are two claims and the second is the load-bearing one. A parse of a 120 000-block model
// retains ~36 MB (~40 bytes per source byte, measured — see the phase 5 notes), and phase 3 left
// an entry for EVERY model in the folder after the first global search, so an unbounded map is a
// folder-sized leak. Bounding it is only safe because every entry is version-keyed and every
// consumer of one re-derives on a miss: a starved cache must give the same summaries, the same
// name records and the same rows as a roomy one, and differ only in what it read to get them.
// That equality is what the middle group here asserts, in both directions — equal answers AND a
// witness that eviction really happened, so the comparison cannot pass vacuously.
//
// The numbers are derived from `entry.estimated` rather than written down, because the point is
// the POLICY: a budget in BYTES (a big model displaces two small ones), recency that a hit
// refreshes (not insertion age), and the two exemptions that keep it from evicting the answer it
// is about to return — the entry just stored, and the models a tab pinned. A pin is off-budget as
// well as un-evictable, and both halves are asserted: sparing an entry while still charging it
// makes the budget a cliff that collapses the tier for the whole folder.
//
// Over real fixture bytes, like every other test of this cache: the artifacts are core's parsers'
// output, and a stub would let this agree with the cache about a shape core does not produce.
//
// The rest of this file — the bound, eviction order, the tab pin's policy — went to
// data-explorer-core with the cache (its test/parsedBudget.test.ts). What stays is the half that
// needs this host's own code: the name index's scan over a starved cache, and the text pin on
// which entry point sourceReads.ts calls.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newSourceCache,
  parsedModelOf,
  type SourceCache,
  type SourceFile,
} from 'data-explorer-core';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';
import { namesOfFile, type NameReader } from '../src/host/nameScan.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });
const nameOf = (f: SourceFile): string => f.path.slice('/fx/'.length);

// Six models of different sizes, smallest first, so a budget the size of the first one starves
// the cache for the rest.
const SMALL = file('chain_model.slx'); // 684 bytes
const NEXT = file('shared_gain.slx'); // 715 bytes
const MID = file('model_with_refs.slx'); // 869 bytes
const BIG = file('sid_blocks.slx'); // 980 bytes
const PAIR = file('shadow_pair.slx'); // 955 bytes
const WS = file('shadow_ws.slx'); // 946 bytes
const MODELS = [SMALL, NEXT, MID, BIG, PAIR, WS];
const FILES = [...MODELS, file('chain_top.sldd'), file('chain_leaf.sldd'), file('params.sldd')];

let reads: string[] = [];
let stamp: Map<string, string>;

const reader: NameReader = {
  version: async (f) => stamp.get(f.path) ?? null,
  bytes: async (f) => {
    reads.push(f.path);
    return bytesOf(nameOf(f));
  },
  dirtyBytes: () => null,
};

/** Ask for one model's parse the way a folder pass does — no pin. */
const scanParse = (cache: SourceCache, f: SourceFile): Promise<unknown> =>
  parsedModelOf(cache, f, stamp.get(f.path) ?? null, () => reader.bytes(f));

const estimateOf = (cache: SourceCache, f: SourceFile): number =>
  cache.parsed.get(f.uriString)?.estimated ?? 0;

/** The estimated bytes `files` cost, taken from an unbounded cache — the budgets are built of these. */
async function estimates(files: readonly SourceFile[]): Promise<number[]> {
  const cache = newSourceCache();
  const out: number[] = [];
  for (const f of files) {
    await scanParse(cache, f);
    out.push(estimateOf(cache, f));
  }
  return out;
}

beforeEach(() => {
  reads = [];
  stamp = new Map(FILES.map((f) => [f.path, `v1:${f.path}`]));
});

describe('an eviction costs a re-derive and changes no answer', () => {
  it('gives the name index the same records from a starved cache as from a roomy one', async () => {
    const roomy = newSourceCache();
    const starved = newSourceCache((await estimates([SMALL]))[0]);
    const scanAll = async (cache: SourceCache): Promise<unknown[]> => {
      const out: unknown[] = [];
      // Twice over the folder, which is a search then a second search: with room the second is
      // free, and starved it re-parses everything.
      for (let pass = 0; pass < 2; pass++) {
        for (const f of MODELS) out.push(await namesOfFile(cache, reader, f));
      }
      return out;
    };

    reads = [];
    const before = await scanAll(roomy);
    const roomyReads = reads.length;
    reads = [];
    const after = await scanAll(starved);

    expect(after).toEqual(before);
    expect(before.flat().length).toBeGreaterThan(0);
    expect(reads.length).toBeGreaterThan(roomyReads);
  });
});

describe('the tab pin is what keeps the folder pass from thrashing', () => {
  it('is the entry point the vscode adapter actually calls', () => {
    // The one seam no cache test can reach: `sourceReads.ts` imports `vscode`, so it cannot be
    // loaded in this suite (see vitest.config.ts) and the openTab helpers in nameScan.test.ts and
    // in core's own cache tests are all hand-copies of its inner sequence. Every one of them would
    // still pass if that module went back to `parsedModelOf` — and then the shipped host would
    // re-parse an open model on every folder pass while every suite agreed it did not. Checked as
    // TEXT because there is nothing else to check it with, and with the comments blanked so the
    // prose naming `parsedModelOf` is not what is being read.
    const src = blankCommentsAndKeepLines(
      readFileSync(fileURLToPath(new URL('../src/host/sourceReads.ts', import.meta.url)), 'utf8'),
    );
    expect(src).toContain('parsedModelForOpenTab(');
    expect(src).not.toContain('parsedModelOf(');
  });
});
