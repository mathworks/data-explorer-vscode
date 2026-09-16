// Copyright 2026 The MathWorks, Inc.
//
// The two ways a model gets into a session answer identically.
//
// A model tab used to hand core its BYTES (`addModelSource`, which parses them) and now hands
// core the PARSE the shared source cache already holds (`addModelSourceParsed`) — so the same
// bytes reach the same tree by two routes, and every row the user sees comes out of whichever
// route the file happened to take. That is this repo's recurring bug class stated exactly: one
// rule, two paths. usageIndex.test.ts in the core repo pins the same equality for the SUMMARY
// half of the split; this pins the ROWS half, over the model fixtures, through the two host
// functions the extension actually calls.
//
// Deliberately a sweep and not an example. The two routes differ in what they hand core — a
// buffer against a parsed object — and the parsed route also labels the parse with a filename
// that is NOT the srcId, which is what `parsed.name` carries. Every fixture is registered both
// ways under the SAME srcId, one after the other, so the row ids are directly comparable and
// nothing has to be normalised out of the comparison first.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel, isModelFile, parseModel } from 'data-explorer-core';
import { getModelFromBytes, getModelFromParsed, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { sourceWarnings } from '../src/host/parseWarnings.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// Every model fixture at the top level, read from the directory rather than listed, so a model
// added for some other suite is covered here too. Both `.mdl` flavours are in here as well as
// `.slx`, which matters: a classic `.mdl` has no `rawContents` and no `zipEntries`, so it is
// the case where the parsed route hands core the most nulls.
const MODELS = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isFile() && isModelFile(e.name))
  .map((e) => e.name)
  .sort();

// A fresh registration under `srcId`, from whichever end. The de-register is what makes the two
// comparable: the same srcId means the same row ids, and core keys one source per srcId.
function fromBytes(srcId: string, name: string, bytes: ArrayBuffer): any {
  invalidate(srcId);
  DataModel.removeDataSource(srcId);
  return getModelFromBytes(srcId, name, bytes);
}

function fromParsed(srcId: string, name: string, path: string, bytes: ArrayBuffer): any {
  invalidate(srcId);
  DataModel.removeDataSource(srcId);
  // The filename the cache parses with is the PATH, and it is neither the srcId nor the
  // basename core labels the tree with — so a fixture passing below is also evidence that
  // `parsed.name` reaches nothing the table shows.
  return getModelFromParsed(srcId, name, parseModel(bytes, path));
}

describe('registering a model from a parse equals registering it from its bytes', () => {
  it('has a corpus worth sweeping', () => {
    // Without this every comparison below could pass over an empty list.
    expect(MODELS.length).toBeGreaterThan(4);
    expect(MODELS).toContain('model_with_refs.slx');
    expect(MODELS).toContain('legacy_ctrl.mdl');
  });

  it.each(MODELS)('gives %s the same rows either way', (name) => {
    const srcId = `eq://${name}`;
    const bytes = bytesOf(name);

    const bytesNode = fromBytes(srcId, name, bytes);
    const viaBytes = buildRows(bytesNode);
    const parsedNode = fromParsed(srcId, name, `/fx/${name}`, bytes);
    const viaParsed = buildRows(parsedNode);

    // Non-vacuity first: an empty row list on both sides would compare equal and say nothing.
    // Every model fixture has at least its sections.
    expect(viaBytes.length).toBeGreaterThan(0);
    expect(viaParsed).toEqual(viaBytes);
    // And the recorded meta, which the rows cannot show: core resolves a link target by
    // srcId, then by `meta.path`'s basename (openSourceNamed's rank 2), so a route that
    // forgot to pass the path would leave the rows identical and every cross-file link into
    // this model dead for a host keyed by uri.
    expect(parsedNode.meta).toEqual(bytesNode.meta);
  });

  it.each(MODELS)('reports the same losses for %s either way', (name) => {
    const srcId = `warn://${name}`;
    const bytes = bytesOf(name);

    const fromBytesCodes = sourceWarnings(fromBytes(srcId, name, bytes)).map((w) => w.code);
    const fromParsedCodes = sourceWarnings(fromParsed(srcId, name, `/fx/${name}`, bytes)).map((w) => w.code);

    // The CODES, not the messages, and the difference is real rather than glossed over: two of
    // core's `.mdl` warnings quote the filename they were given, and the two routes give
    // different filenames (the srcId against the path). The code is what the extension acts
    // on — `refuseIfUnreadable` refuses `source-unreadable` and nothing else — so it is the
    // code that has to match, and a message naming the path rather than the uri is the better
    // sentence of the two.
    expect(fromParsedCodes).toEqual(fromBytesCodes);
  });

  it('refuses a model that read short through the parsed route too', () => {
    // The gate, not the rows. A modern `.mdl` truncated after its package marker leaves only
    // the legacy `Model { Version }` stub, which parses into an empty model with a
    // `source-unreadable` warning — the case slddModel.test.ts pins for the bytes route. The
    // parsed route reaches the same `registered()` gate, and a route that skipped it would
    // register a five-empty-section tree and tell the user the file opened.
    const b = new TextEncoder().encode('__MWOPC_PACKAGE_BEGIN__\n\nModel {\n  Version 12.0\n}\n');
    const bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const srcId = 'eq://trunc.mdl';

    expect(() => fromBytes(srcId, 'trunc.mdl', bytes)).toThrow(/OPC text package/);
    expect(() => fromParsed(srcId, 'trunc.mdl', '/fx/trunc.mdl', bytes)).toThrow(/OPC text package/);
    // And left nothing registered, which is the half that is easy to miss: core attaches the
    // warnings to a node it has ALREADY indexed.
    expect(DataModel.hasDataSource(srcId)).toBe(false);
  });
});
