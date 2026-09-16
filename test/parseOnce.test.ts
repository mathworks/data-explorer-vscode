// Copyright 2026 The MathWorks, Inc.
//
// A model is parsed ONCE per content change, however many consumers want it.
//
// The duplicate work this pins out is not visible in any answer: opening a model ran a full
// `parseModel` for the rows (`DataModel.addModelSource`) and a second one for the Usage summary
// (`summarizeFiles`), on the same bytes, in the same open — 2 parses of a 120 000-block model,
// 1369 ms, where one parse is 675 ms. Opening a linked dictionary and then the model it names
// did the same thing across two opens: the dictionary's usage scope parsed the model, the tab
// then parsed it again. Both look perfect from the outside, which is why the claim has to be
// stated as a COUNT.
//
// How the count is taken, and why it is honest: `parsedModelOf` is the only place this host
// parses a model, and every parse it makes stores a NEW `{version, parsed}` entry in
// `cache.parsed`. So "which files were parsed between here and there" is the set of entries
// whose object identity moved — a structural count, taken at the call site, with no counter to
// keep in sync. Counting core's `parseModel` from outside instead does NOT work: `summarizeFiles`
// and `addModelSource` reach it through core's own relative import, and an ESM namespace binding
// cannot be reassigned (see the session log). The one blind spot is stated as its own test at
// the bottom: a file the reader will not version is parsed and not kept, so it is invisible here.
//
// Counts, not milliseconds, so these hold on any machine. Over real fixture bytes, because the
// artifacts are core's parsers' output and a stub would let this agree with the cache about a
// shape core does not produce.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel } from 'data-explorer-core';
import {
  newSourceCache,
  parsedModelForOpenTab,
  parsedModelOf,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from '../src/host/sourceCache.js';
import { planSummaries } from '../src/host/usagePlan.js';
import { getModelForBinaryTab, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });

// `chain_model.slx` links `chain_top.sldd`, which references `chain_leaf.sldd` from inside its
// zip. That chain is the reported case: open the dictionary, then open the model.
const MODEL = file('chain_model.slx');
const TOP = file('chain_top.sldd');
const LEAF = file('chain_leaf.sldd');
const OTHER = file('shared_gain.slx');
const FILES = [MODEL, TOP, LEAF, OTHER, file('params.sldd'), file('nd_numeric.mat')];

let reads: string[] = [];
let stamp: Map<string, string>;

// The folder pass's reader. Its `bytes` is the read a SCAN makes.
const reader: SourceReader = {
  version: async (f) => stamp.get(f.path) ?? null,
  bytes: async (f) => {
    reads.push(f.path);
    return bytesOf(f.path.slice('/fx/'.length));
  },
};

// What a TAB does. The two statements `BinaryEditorProvider.post` makes — drop this module's node
// for the uri, then ask `getModelForBinaryTab` which route the format takes — are the REAL calls
// here, so the branch under test is production's own and not a copy of it. Only the body of the
// `parsed` thunk is written out, because it is `sourceReads.parsedModelForTab`'s inner sequence
// (version the file, then ask the shared cache, reading the whole file only on a miss) and that
// module imports `vscode`.
//
// Nothing is de-registered, exactly as in production: `addModelSourceParsed` REPLACES the session
// entry for a srcId (core deindexes the previous tree first), so a re-open needs no help. An
// earlier version of this replica removed the data source between opens — tidier than the host,
// which is the way a replica stops testing it.
async function openTab(cache: SourceCache, f: SourceFile): Promise<any> {
  invalidate(f.uriString);
  return getModelForBinaryTab(f.uriString, f.path.slice('/fx/'.length), {
    // Through the cache's own TAB entry point, not `parsedModelOf` with the tab's options spelled
    // out again: what a tab asks for differently is a decision, and a copy of a decision is the
    // thing that goes stale (see parsedBudget.test.ts).
    parsed: () =>
      parsedModelForOpenTab(cache, f, stamp.get(f.path) ?? null, async () => {
        reads.push(f.path);
        return bytesOf(f.path.slice('/fx/'.length));
      }),
    // The branch not taken for a model, counted like the other one so that a route that flipped
    // would show up here as a read rather than as nothing.
    bytes: async () => {
      reads.push(f.path);
      return bytesOf(f.path.slice('/fx/'.length));
    },
  });
}

/** Which model each parsed entry currently is, by object identity — the parse ledger. */
const ledger = (cache: SourceCache): Map<string, unknown> =>
  new Map([...cache.parsed].map(([uri, entry]) => [uri, entry]));

/** The files parsed between two ledgers: a new entry, or an entry that was replaced. */
function parsedBetween(before: Map<string, unknown>, after: Map<string, unknown>): string[] {
  return [...after]
    .filter(([uri, entry]) => before.get(uri) !== entry)
    .map(([uri]) => uri)
    .sort();
}

const modelReads = (): string[] => reads.filter((p) => p.endsWith('.slx') || p.endsWith('.mdl'));

beforeEach(() => {
  reads = [];
  stamp = new Map(FILES.map((f) => [f.path, `v1:${f.path}`]));
});

describe('opening a model parses it once, not once per consumer', () => {
  it('parses the opened model exactly once between the rows and the Usage summary', async () => {
    const cache = newSourceCache();

    // The tab: rows.
    const node = await openTab(cache, MODEL);
    expect(buildRows(node).length).toBeGreaterThan(0);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);

    // The same open's Usage column, which is the second consumer and used to be the second
    // parse. It is a whole folder pass, so it reads the model once more for the CHEAP tier —
    // that read is a scan, not a parse, and the parse it would have made is a hit.
    const mid = ledger(cache);
    const summaries = await planSummaries(cache, reader, FILES, MODEL.uriString);
    expect(parsedBetween(mid, ledger(cache))).toEqual([]);
    expect(summaries.models.map((m) => m.srcId)).toEqual([MODEL.uriString]);

    // One parse, and both consumers are reading it: the registered tree holds the parse's own
    // `rawContents` object and the summary holds its own `masks` array. A second parse would
    // have produced equal-but-distinct objects for both, which no deep comparison would catch.
    const parsed = (cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed;
    expect(parsed.rawContents).toBeTruthy();
    expect(node.rawContents).toBe(parsed.rawContents);
    expect(parsed.masks).toBeTruthy();
    expect(summaries.models[0].masks).toBe(parsed.masks);

    // Two reads of the model in the whole open — the tab's own, and the folder's cheap pass —
    // where it used to be three, one per parse plus the scan.
    expect(modelReads().filter((p) => p === MODEL.path).length).toBe(2);
  });

  it('parses a model NOT in the opened model’s scope zero times', async () => {
    // The scope rule this must not undo: a model resolves through its own chain, so another
    // model in the folder is never parsed for it. It is versioned and cheaply scanned only.
    const cache = newSourceCache();
    await openTab(cache, MODEL);
    await planSummaries(cache, reader, FILES, MODEL.uriString);
    expect([...cache.parsed.keys()]).toEqual([MODEL.uriString]);
  });
});

describe('opening a dictionary and then its model parses that model once in total', () => {
  it('is one parse across the two opens, not one each', async () => {
    // Case A, the reported case. Opening `chain_leaf.sldd` has to summarise `chain_model.slx`
    // to answer "what uses ChainVar" — a full parse, on the dictionary's behalf. Opening the
    // model next then parsed the same bytes again for its rows.
    const cache = newSourceCache();

    await planSummaries(cache, reader, FILES, LEAF.uriString);
    const afterDict = ledger(cache);
    expect(parsedBetween(new Map(), afterDict)).toEqual([MODEL.uriString]);
    const held = cache.parsed.get(MODEL.uriString) as { parsed: any };

    reads = [];
    const node = await openTab(cache, MODEL);

    // Nothing parsed, and nothing read either: the tab's own read is skipped on a hit, so a
    // 13.8 MB model already parsed for a dictionary costs a `stat`.
    expect(parsedBetween(afterDict, ledger(cache))).toEqual([]);
    expect(reads).toEqual([]);
    // And the rows really came from that parse rather than from a fresh one.
    expect(node.rawContents).toBe(held.parsed.rawContents);
    expect(buildRows(node).length).toBeGreaterThan(0);
  });

  it('registers nothing in the session for a model parsed on a dictionary’s behalf', async () => {
    // Retaining a parse is not registering it (design decision 5). A model reachable from an
    // opened dictionary is parsed, and its tree stays unbuilt until a TAB asks for it —
    // otherwise the registry holds nodes `findNodeById` resolves selections into with no view
    // to show them.
    const cache = newSourceCache();
    DataModel.removeDataSource(MODEL.uriString);
    await planSummaries(cache, reader, FILES, LEAF.uriString);
    expect(cache.parsed.has(MODEL.uriString)).toBe(true);
    expect(DataModel.hasDataSource(MODEL.uriString)).toBe(false);
  });
});

describe('two consumers that ask at the SAME TIME parse once', () => {
  // The half of "once per content change" a map of finished parses cannot cover, and the half the
  // ledger above is blind to by construction: two callers that both miss, both read and both parse
  // store two equal entries at one version, so the FINAL map shows one identity change either way.
  // What tells them apart is what was read, and which object each caller got back.
  //
  // Every test here fires the second ask without awaiting the first — that is the whole scenario,
  // and an `await` between them would turn each of them into the cache-hit case already pinned
  // above.
  const askFor = (cache: SourceCache, f: SourceFile): Promise<any> =>
    parsedModelOf(cache, f, stamp.get(f.path) ?? null, () => reader.bytes(f));

  it('reads and parses once for two consumers in flight together, and hands both the same object', async () => {
    const cache = newSourceCache();
    const first = askFor(cache, MODEL);
    const second = askFor(cache, MODEL);
    const [a, b] = await Promise.all([first, second]);

    // One read, where two callers each reading for themselves is two — the bytes are the larger
    // half of the cost on this path, and a 13.8 MB model read twice is what the thunk exists to
    // avoid.
    expect(reads).toEqual([MODEL.path]);
    // The same object, not an equal one: distinct parses are what a deep comparison cannot see,
    // and what both consumers then hold BY REFERENCE (the registered tree's `rawContents`, the
    // summary's `masks`), so two of them is two retained copies as well as two parses.
    expect(a).toBe(b);
    expect(a).toBe((cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);
  });

  it('parses a shared model once when two restored tabs plan their usage at the same time', async () => {
    // The production shape of the same thing, and the reason it is worth a test of its own:
    // `ensureUsageGraph` dedups by the file being VIEWED, so two files open in two editor groups
    // are two entries and two whole-folder passes — which both scope `chain_model.slx`, one because
    // it IS the file and one because the chain from `chain_leaf.sldd` reaches it. Restoring such a
    // window starts them together.
    const cache = newSourceCache();
    const [forModel, forLeaf] = await Promise.all([
      planSummaries(cache, reader, FILES, MODEL.uriString),
      planSummaries(cache, reader, FILES, LEAF.uriString),
    ]);

    // Two reads of the model across BOTH passes — one for the cheap tier's structure and one for
    // the parse, which is what a single pass costs (see the cold-open test above). Four is what
    // two independent passes cost.
    expect(modelReads().filter((p) => p === MODEL.path).length).toBe(2);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);
    // And both plans are answering out of that one parse, not out of one each.
    const parsed = (cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed;
    const summaryOf = (s: Awaited<ReturnType<typeof planSummaries>>): any =>
      s.models.find((m) => m.srcId === MODEL.uriString);
    expect(summaryOf(forModel).masks).toBe(parsed.masks);
    expect(summaryOf(forLeaf).masks).toBe(parsed.masks);
  });

  it('parses once when one model is opened in two panels at once', async () => {
    // `supportsMultipleEditorsPerDocument: true` (see package.json), so splitting a model tab is
    // two providers posting for one uri. Both call the tab entry point, neither has finished when
    // the other starts.
    const cache = newSourceCache();
    const [a, b] = await Promise.all([openTab(cache, MODEL), openTab(cache, MODEL)]);

    expect(reads).toEqual([MODEL.path]);
    // One parse and, for a separate reason, one TREE as well: `getModelFromParsed` caches its node
    // by uriString, so the second panel to arrive re-uses the first one's registration instead of
    // building a second tree over the same parse. This is what the host does and it used to look
    // otherwise here — the replica de-registered the source between opens, which the provider never
    // does, and two nodes came back.
    expect(a).toBe(b);
    // And that shared tree really is holding the shared parse: `ModelNode.fromParsed` keeps
    // `rawContents` by reference, so an equal-but-distinct object would be a second parse.
    expect(a.rawContents).toBe((cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed.rawContents);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);
  });

  it('forgets a parse that FAILED, so the next ask retries it instead of joining the failure', async () => {
    // The cost of getting this wrong is worse than the duplicate work it removes: a rejected parse
    // left in the in-flight map is one every later caller at that version joins, so a file that
    // would not read once would never read again — where the version key otherwise retries it on
    // the next ask, and a corrupt model recovers the moment it is fixed.
    const cache = newSourceCache();
    const junk = (): Promise<ArrayBuffer> => Promise.resolve(new TextEncoder().encode('PK not a zip').buffer);
    const version = stamp.get(MODEL.path) ?? null;
    const first = parsedModelOf(cache, MODEL, version, junk);
    const second = parsedModelOf(cache, MODEL, version, junk);

    // Both callers see the failure — a joined parse is joined for its throw as well as its answer,
    // which is what lets a tab still show its "Failed to parse" banner.
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(cache.parsing.size).toBe(0);

    // The same file, the same version, real bytes: parsed, not re-joined to the rejection.
    const parsed = await parsedModelOf(cache, MODEL, version, () => reader.bytes(MODEL));
    expect(parsed).toBeTruthy();
  });

  it('does NOT join two versionless asks, which is the same rule as never keeping them', async () => {
    // A file the reader will not version is parsed for its caller and shared with nobody. There is
    // no key to coalesce on: two callers with no version can be shown to want the same PATH, never
    // the same bytes, and handing the second one a parse of whatever the first happened to read
    // would be a guess where every other entry in this module is a version check. So it costs one
    // parse per caller, exactly as it did before there was an in-flight map — reachable only above
    // MAX_SCAN_BYTES or after a failed `stat`.
    const cache = newSourceCache();
    const [a, b] = await Promise.all([
      parsedModelOf(cache, MODEL, null, () => reader.bytes(MODEL)),
      parsedModelOf(cache, MODEL, null, () => reader.bytes(MODEL)),
    ]);

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(cache.parsed.size).toBe(0);
    expect(cache.parsing.size).toBe(0);
  });
});

describe('a second open of an unchanged model parses nothing', () => {
  it('re-registers the tree from the parse it already had', async () => {
    const cache = newSourceCache();
    const first = await openTab(cache, MODEL);
    const afterFirst = ledger(cache);
    reads = [];

    const second = await openTab(cache, MODEL);

    expect(parsedBetween(afterFirst, ledger(cache))).toEqual([]);
    expect(reads).toEqual([]);
    // A new tree each time — the provider's own node cache was dropped — built from the one
    // parse. Rows equal, nodes distinct.
    expect(second).not.toBe(first);
    expect(buildRows(second)).toEqual(buildRows(first));
  });
});

describe('a version bump re-parses exactly the file that moved', () => {
  it('re-parses one model and keeps the other', async () => {
    const cache = newSourceCache();
    // Unscoped, which is the reference build in usageScopeEquality.test.ts: every model in the
    // folder is summarised, so there are two parses to tell apart.
    await planSummaries(cache, reader, FILES, null);
    expect([...cache.parsed.keys()].sort()).toEqual([MODEL.uriString, OTHER.uriString].sort());
    const before = ledger(cache);

    stamp.set(OTHER.path, `v2:${OTHER.path}`);
    await planSummaries(cache, reader, FILES, null);

    expect(parsedBetween(before, ledger(cache))).toEqual([OTHER.uriString]);
  });

  it('re-parses for a tab whose file moved under it, and hands the tab the new tree', async () => {
    const cache = newSourceCache();
    const first = await openTab(cache, MODEL);
    const before = ledger(cache);

    // What an external edit looks like to the cache: the version moved. Nothing had to be
    // invalidated for this — the entry key IS the content version, which is why
    // BinaryEditorProvider.post drops its own node and leaves this cache alone.
    stamp.set(MODEL.path, `v2:${MODEL.path}`);
    reads = [];
    const second = await openTab(cache, MODEL);

    expect(parsedBetween(before, ledger(cache))).toEqual([MODEL.uriString]);
    expect(reads).toEqual([MODEL.path]);
    expect(second.rawContents).not.toBe(first.rawContents);
  });
});

describe('what the count cannot see', () => {
  it('parses, and does not keep, a model the reader will not version', async () => {
    // The blind spot in the method above, stated rather than left implicit. A file over the
    // scan cap has no version to key an entry by, and a tab must still open it — so it is
    // parsed on every open and counted nowhere. `scanVersion` returns null for exactly this.
    const cache = newSourceCache();
    const parsed = await parsedModelOf(cache, MODEL, null, async () => bytesOf('chain_model.slx'));
    expect(parsed).toBeTruthy();
    expect(cache.parsed.size).toBe(0);
  });

  it('summarises a model it cannot parse as nothing, without failing the folder', async () => {
    // The guard that moved when the parse moved: it used to live inside core's
    // `summarizeFiles`, per file. One corrupt model in a folder must not empty the Usage
    // answers for every other file in it.
    const cache = newSourceCache();
    const corrupt = file('corrupt.slx');
    stamp.set(corrupt.path, `v1:${corrupt.path}`);
    const bad: SourceReader = {
      version: reader.version,
      bytes: async (f) =>
        f.path === corrupt.path ? new TextEncoder().encode('PK not a zip').buffer : reader.bytes(f),
    };
    const summaries = await planSummaries(cache, bad, [...FILES, corrupt], null);
    expect(cache.models.get(corrupt.uriString)?.summary.models).toEqual([]);
    // The rest of the folder answered as usual.
    expect(summaries.models.map((m) => m.srcId).sort()).toEqual([MODEL.uriString, OTHER.uriString].sort());
  });
});
