// Copyright 2026 The MathWorks, Inc.
//
// The one property the demand-scoped usage graph rests on: a graph built over the files that
// can affect ONE file gives that file the SAME answers as a graph built over the whole
// folder.
//
// Everything else about the change is a speed argument, and a speed argument is worthless if
// the answers move — a Usage column that is fast and wrong is worse than the slow one it
// replaced, because nothing about it looks broken. usageScope.test.ts pins the reasoning that
// picks the set, over hand-built relationships; this pins the RESULT, over real fixture bytes,
// through the same `planSummaries` the extension calls (usageSources.ts adds only the vscode
// file I/O in front of it).
//
// It is deliberately exhaustive rather than illustrative. Every file in the fixture corpus is
// opened in turn, and each one's graph is asked every name and every block key that appears
// ANYWHERE in the corpus — including names that belong to other files, which is how a scoped
// graph inventing an answer would be caught as well as one losing it. The corpus is read from
// the directory rather than listed, so a fixture added for some other reason is covered here
// too.
//
// Only `forUri`'s own answers are compared. A scoped graph is not entitled to answer for a
// file it was not built for — that is the point of it — and usageGraph.ts keys one graph per
// file being viewed for exactly that reason.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildUsageGraphFromSummaries, type UsageGraph } from '../src/host/usageCells.js';
import {
  clearUsageCache,
  newUsageCache,
  planSummaries,
  type PlanFile,
  type PlanReader,
  type UsageCache,
} from '../src/host/usagePlan.js';
import { isGraphPath } from '../src/common/fileTypes.js';
import type { FileSummaries } from 'data-explorer-core';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// Whatever the extension's own glob would pick up, in directory order — which stands in for
// folder order, the thing that decides basename-collision winners. Top level only: the
// subdirectories hold single-format fixtures for other suites.
const CORPUS = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isFile() && isGraphPath(e.name))
  .map((e) => e.name)
  .sort();

const FILES: PlanFile[] = CORPUS.map((name) => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` }));

// Every read is counted, because "reads less" is the other half of the claim and the only way
// to state it is to watch the reads. `version` is a constant: these fixtures do not change
// during a test, and the cache's freshness rule is exercised by `bumped` below instead.
let reads: string[] = [];
const reader: PlanReader = {
  version: async (file) => `v1:${file.path}`,
  bytes: async (file) => {
    reads.push(file.path);
    return bytesOf(file.path.slice('/fx/'.length));
  },
};

const graphFor = async (cache: UsageCache, forUri: string | null): Promise<UsageGraph> =>
  buildUsageGraphFromSummaries(await planSummaries(cache, reader, FILES, forUri));

// Everything worth asking, gathered from the WHOLE corpus so that each file's graph is
// probed with names and blocks it may have nothing to do with.
function probes(all: FileSummaries): { names: string[]; keys: string[] } {
  const names = new Set<string>();
  const keys = new Set<string>();
  for (const data of [...all.slddByName.values(), ...all.matByName.values()]) {
    for (const name of data.names) names.add(name);
  }
  for (const model of all.models) {
    for (const name of model.workspaceNames) names.add(name);
    for (const block of model.blockParams) {
      // The expression too: a cell's answer is keyed by the NAME that resolved, and probing
      // the raw expression (`2*Kp`) asserts neither graph answers for something that is not
      // a name at all.
      names.add(block.expression);
      // Both, rather than core's `blockKey` rule: over-probing costs a lookup and removes
      // any chance of the test agreeing with the implementation about the wrong key.
      keys.add(block.sid);
      keys.add(block.blockName);
    }
  }
  return { names: [...names], keys: [...keys] };
}

beforeEach(() => {
  reads = [];
});

describe('a scoped usage graph answers exactly as the whole folder does', () => {
  it('has a corpus worth testing', () => {
    // A guard on the test itself: if the glob or the directory ever stops matching, every
    // comparison below passes vacuously over an empty list.
    expect(CORPUS.length).toBeGreaterThan(8);
    expect(CORPUS).toContain('params.sldd');
    expect(CORPUS).toContain('shared_gain.slx');
    expect(CORPUS).toContain('chain_leaf.sldd');
  });

  it('gives every file in the corpus the same answers as the unscoped graph', async () => {
    const whole = await graphFor(newUsageCache(), null);
    const all = await planSummaries(newUsageCache(), reader, FILES, null);
    const { names, keys } = probes(all);
    expect(names.length).toBeGreaterThan(3);
    expect(keys.length).toBeGreaterThan(3);

    for (const file of FILES) {
      // A cache PER FILE, so each scoped graph is built from nothing and cannot be passing
      // because a previous file's build happened to summarise what this one needed.
      const scoped = await graphFor(newUsageCache(), file.uriString);
      for (const name of names) {
        expect(
          scoped.blocksUsing(file.uriString, name),
          `blocksUsing(${file.path}, ${name})`,
        ).toEqual(whole.blocksUsing(file.uriString, name));
      }
      for (const key of keys) {
        expect(scoped.paramLinks(file.uriString, key), `paramLinks(${file.path}, ${key})`).toEqual(
          whole.paramLinks(file.uriString, key),
        );
      }
    }
  });

  it('credits a shadowed name to the FIRST dictionary on the chain, not the second', async () => {
    // The other hazard, asserted on its own because the corpus sweep above stops at its first
    // failure and this file sorts after `chain_leaf.sldd` — a regression here would hide
    // behind that one.
    //
    // `shadow_pair.slx` links `shadow_first.sldd` then `shadow_second.sldd`, and both define
    // `PairVar`. MATLAB resolves once, first hit wins, so the usage belongs to `first` and
    // `second` has none. Opening `second` must still carry `first`: without it core cannot
    // see what shadowed the name and moves the usage down onto `second`, inventing a user for
    // a cell that has none.
    const first = 'file:///fx/shadow_first.sldd';
    const second = 'file:///fx/shadow_second.sldd';

    const atFirst = await graphFor(newUsageCache(), first);
    expect(atFirst.blocksUsing(first, 'PairVar').map((l) => l.blockName)).toEqual(['PairGain']);

    const atSecond = await graphFor(newUsageCache(), second);
    expect(atSecond.blocksUsing(second, 'PairVar')).toEqual([]);
    // And the shadowing file really was read, which is WHY the answer above is empty — as
    // opposed to it being empty because the model was never summarised at all.
    expect(reads).toContain('/fx/shadow_first.sldd');
    expect(reads).toContain('/fx/shadow_pair.slx');
  });

  it('finds a usage that is only reachable THROUGH a compressed dictionary', async () => {
    // The case the cheap tier could have got wrong, and the reason a dictionary is summarised
    // by core's own summariser rather than scraped: `chain_model.slx` links `chain_top.sldd`,
    // which is a ZIP whose reference to `chain_leaf.sldd` is inside the archive. A scope that
    // could not read it would drop the model and answer that `ChainVar` is unused.
    //
    // Asserted positively as well as by equality, because equality alone would also hold if
    // BOTH graphs answered emptily.
    const leaf = 'file:///fx/chain_leaf.sldd';
    const scoped = await graphFor(newUsageCache(), leaf);
    const links = scoped.blocksUsing(leaf, 'ChainVar');
    expect(links.map((l) => `${l.blockName}(${l.modelName})`)).toEqual(['ChainGain(chain_model)']);
    expect(reads).toContain('/fx/chain_model.slx');
  });

  it('hands core the scoped files only, so no file outside the scope can win a name', async () => {
    // The scope stated at the level core actually resolves through: its name maps are keyed by
    // refBasename with the LAST assignment winning, so a dictionary merged in from outside the
    // scope is not merely spare data — it can take a name from the file that should have had
    // it. Every file sharing a needed basename is already in scope by construction
    // (usageScope.ts materialises them all, in folder order), which is what makes filtering the
    // merge safe; this asserts the filter is there, since the answers above cannot see it.
    //
    // A model's scope is itself plus its own chain, and `chain_top.sldd` reaches
    // `chain_leaf.sldd` — so these three files, and none of the corpus's other dictionaries.
    const model = 'file:///fx/chain_model.slx';
    const summaries = await planSummaries(newUsageCache(), reader, FILES, model);
    expect(summaries.models.map((m) => m.srcId)).toEqual([model]);
    expect([...summaries.slddByName.keys()].sort()).toEqual(['chain_leaf.sldd', 'chain_top.sldd']);
    expect([...summaries.matByName.keys()]).toEqual([]);
  });
});

describe('what a scoped build actually reads', () => {
  // The performance claim, stated as reads rather than milliseconds so it holds on any
  // machine. A model is the expensive file — `summarizeFiles` full-parses one — so a model
  // read TWICE in a build is the cheap tier plus the full parse, and a model read once is the
  // cheap tier alone.
  const modelReads = (): string[] => reads.filter((p) => p.endsWith('.slx') || p.endsWith('.mdl'));
  const twice = (paths: string[]): string[] => [...new Set(paths.filter((p, i) => paths.indexOf(p) !== i))].sort();

  it('never parses a model that cannot reach the opened file', async () => {
    await graphFor(newUsageCache(), 'file:///fx/chain_leaf.sldd');
    // Only the one model whose chain reaches it. The others were versioned and cheaply
    // scanned for their links, and never parsed.
    expect(twice(modelReads())).toEqual(['/fx/chain_model.slx']);
  });

  it('parses nothing new for a second file whose models are already summarised', async () => {
    const cache = newUsageCache();
    await graphFor(cache, 'file:///fx/chain_leaf.sldd');
    reads = [];
    // The same model set, reached from the other end of the same chain. This is the case the
    // cache exists for — the user opening a second tab in a folder they have already paid
    // for — and it must read nothing at all, cheap tier included.
    await graphFor(cache, 'file:///fx/chain_top.sldd');
    expect(reads).toEqual([]);
  });

  it('opening a MODEL parses that model and no other', async () => {
    // A model's Usage is answerable from itself plus its chain, so this case stops depending
    // on how many models the folder holds — the one that made a small file cost as much as
    // the largest model beside it.
    await graphFor(newUsageCache(), 'file:///fx/shared_gain.slx');
    expect(twice(modelReads())).toEqual(['/fx/shared_gain.slx']);
  });

  it('re-reads only the file whose version moved', async () => {
    const cache = newUsageCache();
    await graphFor(cache, 'file:///fx/params.sldd');
    reads = [];
    // One file edited on disk. Everything else is still at the version its summary was built
    // from, which is what makes dropping every graph on any workspace change affordable.
    const bumped: PlanReader = {
      version: async (file) =>
        file.path === '/fx/shared_gain.slx' ? 'v2:/fx/shared_gain.slx' : `v1:${file.path}`,
      bytes: reader.bytes,
    };
    await planSummaries(cache, bumped, FILES, 'file:///fx/params.sldd');
    expect([...new Set(reads)]).toEqual(['/fx/shared_gain.slx']);
  });

  it('clearing the cache makes the next build read again', async () => {
    const cache = newUsageCache();
    await graphFor(cache, 'file:///fx/params.sldd');
    clearUsageCache(cache);
    reads = [];
    await graphFor(cache, 'file:///fx/params.sldd');
    expect(reads.length).toBeGreaterThan(0);
  });
});
