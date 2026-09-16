// Copyright 2026 The MathWorks, Inc.
//
// Which route a read-only binary TAB takes for its tree, by format.
//
// This is phase 2's headline behaviour on the tab path — a model's rows come off the SHARED
// `ParsedSlx` rather than off a parse of its own — and until `getModelForBinaryTab` existed it was
// a ternary inside `BinaryEditorProvider.post`, in a module that imports `vscode` and that no unit
// test can load. Reverting it there to the old `getModelFromBytes(uriString, name, await
// readBytes())` left the whole suite green and `tsc` clean: the equality sweep in
// parsedRegistration.test.ts proves the two registration routes produce identical rows, which is
// exactly why identical rows cannot say which route ran. What tells them apart is what was READ,
// so that is what these assert.
//
// Over real fixture bytes, and through the real registration, because the thing being pinned is a
// branch on core's own `isModelFile` and a stub would let this test agree with itself about a
// dispatch core does not make.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel } from 'data-explorer-core';
import { getModelForBinaryTab, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { newSourceCache, parsedModelForOpenTab, type SourceFile } from '../src/host/sourceCache.js';

const dir = join(import.meta.dirname, 'fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });

// Both model flavours, because the branch is core's `isModelFile` and a `.mdl` is text: an
// extension test that only ever saw `.slx` would not notice a dispatch that had quietly become
// "is it a zip".
const MODELS = ['chain_model.slx', 'model_with_refs.mdl'];
// Every other format the binary view renders. `.prj` is absent on purpose — the provider answers a
// project from its sibling store before this decision is reached at all.
const OTHERS = ['nd_numeric.mat', 'compressed.sldd'];

// What each source was asked for, in order — the only place the choice is observable.
let asked: string[] = [];

beforeEach(() => {
  asked = [];
});

/** The call `BinaryEditorProvider.post` makes, with both of its vscode reads counted. */
async function openTab(name: string): Promise<any> {
  const f = file(name);
  const cache = newSourceCache();
  invalidate(f.uriString);
  DataModel.removeDataSource(f.uriString);
  return getModelForBinaryTab(f.uriString, name, {
    parsed: async () => {
      asked.push('parsed');
      return parsedModelForOpenTab(cache, f, `v1:${f.path}`, async () => bytesOf(name));
    },
    bytes: async () => {
      asked.push('bytes');
      return bytesOf(name);
    },
  });
}

describe('a model tab registers the shared parse; every other format registers its bytes', () => {
  for (const name of MODELS) {
    it(`takes the shared-parse route for ${name}, and reads no bytes of its own`, async () => {
      const node = await openTab(name);
      // The read a tab must NOT make: the parse it wants may already be in the cache, in which
      // case this open costs a `stat`. A bytes read here is the pre-phase-2 cost back again, and
      // it is invisible in the rows.
      expect(asked).toEqual(['parsed']);
      expect(buildRows(node).length).toBeGreaterThan(0);
    });
  }

  for (const name of OTHERS) {
    it(`takes the bytes route for ${name}, and asks for no model parse`, async () => {
      const node = await openTab(name);
      // The other direction of the same branch, and it is not symmetric decoration: the shared
      // parse tier is `parseModel` only, so a dictionary sent through it would be parsed as a
      // model — an empty table for a file that opens.
      expect(asked).toEqual(['bytes']);
      expect(buildRows(node).length).toBeGreaterThan(0);
    });
  }

  it('hands the model tab the very parse object the cache holds, not an equal one', async () => {
    // The identity behind the count. `ModelNode.fromParsed` keeps `rawContents` BY REFERENCE, so
    // an equal-but-distinct object here is the fingerprint of a second parse — which is what a
    // deep row comparison cannot see and what the sweep in parsedRegistration.test.ts is blind to.
    const f = file('chain_model.slx');
    const cache = newSourceCache();
    invalidate(f.uriString);
    DataModel.removeDataSource(f.uriString);
    const node = await getModelForBinaryTab(f.uriString, 'chain_model.slx', {
      parsed: () => parsedModelForOpenTab(cache, f, `v1:${f.path}`, async () => bytesOf('chain_model.slx')),
      bytes: async () => {
        throw new Error('a model tab must not read bytes for itself');
      },
    });
    const held = cache.parsed.get(f.uriString) as { parsed: any };
    expect(held.parsed.rawContents).toBeTruthy();
    expect(node.rawContents).toBe(held.parsed.rawContents);
  });
});
