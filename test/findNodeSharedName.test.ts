// Copyright 2026 The MathWorks, Inc.
//
// findNode and two entries with one name in one section (F1-50).
//
// A node id is a path, so two same-named siblings are one id, and so is every row inside them.
// Only a malformed file holds such a pair, and core keeps both as read. Since F1-50 its session
// refuses to resolve such an id: `DataModel.findNodeById` answers null, and so do its delete,
// edit and add-child forms. Which twin the user meant cannot be told from an id both rows carry.
//
// SlddModel.findNode used to fall back to this module's cached tree whenever the registry
// answered null. For the text editor that cache IS the registered tree, so the fallback handed
// back the FIRST twin, the very wrong-entry pick core refuses. A cell edit, a child delete, a
// copy, a drag and the Property Inspector all act on findNode's answer without asking the
// session again. So a registered source's null has to stay null. The fallback is kept for what
// it was for: a source the registry cannot answer about.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, findNode, invalidate } from '../src/view/model/workspace/SlddModel.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../test-integration/fixtures/workspace/params.sldd', import.meta.url)), 'utf8'),
);

const entriesOf = (doc: any): any[] => doc.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

/** `name` under the given uuid: the same record the file holds, so the copy reads exactly as it does. */
function copyOf(entryName: string, name: string, uuid: string): any {
  const entry = structuredClone(entriesOf(fixture).find((e) => e.name === entryName));
  expect(entry, `the fixture holds ${entryName}`).toBeTruthy();
  return { ...entry, name, metadata: { ...entry.metadata, uuid } };
}

/**
 * params.sldd with two Simulink.Parameter entries named K and two structs named S, all in
 * Design Data, ahead of the fixture's own entries. Each twin carries its own uuid, as two
 * entries MATLAB wrote would.
 */
function twinsText(): string {
  const doc = structuredClone(fixture);
  const entries = entriesOf(doc);
  entries.unshift(
    copyOf('gravity', 'K', 'twin-k-1'),
    copyOf('gravity', 'K', 'twin-k-2'),
    copyOf('myStruct', 'S', 'twin-s-1'),
    copyOf('myStruct', 'S', 'twin-s-2'),
  );
  return JSON.stringify(doc, null, '\t');
}

const design = (model: any): any => model.children.find((s: any) => s.name === 'design');

/** Which of `twins` a lookup answered, so a failure says which one rather than dumping the node. */
const which = (node: any, twins: any[]): string | null =>
  node === null ? null : twins.indexOf(node) === 0 ? 'the first twin' : twins.indexOf(node) === 1 ? 'the second twin' : 'some other node';
const named = (model: any, name: string): any[] => design(model).children.filter((e: any) => e.name === name);

const opened: string[] = [];
function open(uri: string): any {
  invalidate(uri);
  opened.push(uri);
  return getModel(uri, 'twins.sldd', twinsText());
}

afterEach(() => {
  for (const uri of opened.splice(0)) {
    invalidate(uri);
    DataModel.removeDataSource(uri);
  }
});

describe('findNode on a text .sldd whose section holds two entries with one name', () => {
  it('answers null for the twins, and still resolves the entry that has its name to itself', () => {
    const uri = 'test://find-node-twins-entry.sldd';
    const model = open(uri);
    const ks = named(model, 'K');
    expect(ks).toHaveLength(2);
    expect(ks[0].className).toBe('Simulink.Parameter');
    expect(ks[1].id).toBe(ks[0].id); // one id for both rows: the state the ruling is about
    expect(ks[0].metadata.uuid).toBe('twin-k-1');

    // Not the first twin (what the cache fallback handed back), and not the second.
    expect(which(findNode(uri, ks[0].id), ks)).toBeNull();

    // An entry whose name is its own resolves as before, from the same registered source.
    const gravity = named(model, 'gravity')[0];
    expect(findNode(uri, gravity.id)).toBe(gravity);
  });

  it('answers null for a row inside a twin, which shares its id with the row in the other twin', () => {
    const uri = 'test://find-node-twins-child.sldd';
    const model = open(uri);
    const ss = named(model, 'S');
    expect(ss).toHaveLength(2);
    const field = ss[0].children.find((c: any) => c.name === 'a');
    expect(field, 'S has a field a').toBeTruthy();
    expect(field.id).toBe(`${ss[0].id}/a`);
    expect(ss[1].children.find((c: any) => c.name === 'a').id).toBe(field.id);

    const fields = ss.map((twin: any) => twin.children.find((c: any) => c.name === 'a'));
    expect(which(findNode(uri, field.id), fields)).toBeNull();

    // The same field of a struct that has its name to itself still resolves.
    const own = named(model, 'myStruct')[0].children.find((c: any) => c.name === 'a');
    expect(findNode(uri, own.id)).toBe(own);
  });

  // The other half of the rule, which the change must keep: the cache answers when the registry
  // cannot. Passes before the change too; it is here so that dropping the fallback whole, which
  // would also pass the two tests above, fails.
  it('still falls back to the cached tree when the source is not registered, or core has no findNodeById', () => {
    const uri = 'test://find-node-twins-fallback.sldd';
    const model = open(uri);
    const gravity = named(model, 'gravity')[0];

    // An older core: no findNodeById on DataModel at all.
    const dm = DataModel as any;
    const lookup = dm.findNodeById;
    dm.findNodeById = undefined;
    try {
      expect(findNode(uri, gravity.id)).toBe(gravity);
    } finally {
      dm.findNodeById = lookup;
    }

    // A source the session no longer holds, while this module's cache still does.
    DataModel.removeDataSource(uri);
    expect(DataModel.hasDataSource(uri)).toBe(false);
    expect(findNode(uri, gravity.id)).toBe(gravity);
  });
});
