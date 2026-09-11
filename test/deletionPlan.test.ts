// Copyright 2026 The MathWorks, Inc.
//
// planDeletion turns the ROW ids a delete acts on into model work: whole entries to
// remove, and nested children grouped under the entry that owns them (one splice per
// entry, one undo step for the gesture). Both providers call it, so a divergence here
// would mean the same multi-row delete behaved differently in a JSON .sldd and a
// binary one.
//
// Its webview twin is resolveOperands, which answers the same question from rows
// because the webview holds no model. multiSelectInvariants.test.ts pins the two
// together; these tests pin this side's own rules.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { planDeletion } from '../src/host/deletionPlan.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

function harness(uri: string) {
  invalidate(uri);
  const model = getModel(uri, 'arch.sldd', archText);
  const find = (rowId: string) => findNode(uri, rowId);
  // Row ids are name-paths, so they can be spelled directly.
  const id = (section: string, ...rest: string[]) => [uri, section, ...rest].join('/');
  return { model, find, id };
}

describe('planDeletion', () => {
  it('plans a whole entry as a removal', () => {
    const h = harness('test://plan-entry.sldd');
    const plan = planDeletion([h.id('arch', 'DataInterface')], h.find);
    expect(plan.entries.map((e: any) => e.name)).toEqual(['DataInterface']);
    expect(plan.childGroups).toEqual([]);
  });

  it('plans a nested child as a change to its owning entry', () => {
    // Removing an element rewrites the bus that holds it; the bus itself stays.
    const h = harness('test://plan-child.sldd');
    const plan = planDeletion([h.id('arch', 'DataInterface', 'Element')], h.find);
    expect(plan.entries).toEqual([]);
    expect(plan.childGroups).toHaveLength(1);
    expect(plan.childGroups[0].entry.name).toBe('DataInterface');
    expect(plan.childGroups[0].children.map((c: any) => c.name)).toEqual(['Element']);
  });

  it('groups two children of one entry into ONE group', () => {
    // One splice per entry: two groups over the same entry would each reserialize a
    // stale copy of it, and the second write would undo the first.
    const h = harness('test://plan-group.sldd');
    const ids = [h.id('arch', 'DataInterface', 'Element'), h.id('arch', 'DataInterface', 'Element1')];
    const plan = planDeletion(ids, h.find);
    expect(plan.childGroups).toHaveLength(1);
    expect(plan.childGroups[0].children.map((c: any) => c.name)).toEqual(['Element', 'Element1']);
  });

  it('drops a child whose own entry is also selected', () => {
    // Removing the entry already removes the child. Planning both would splice the
    // child out of an entry that is about to be deleted, and the second op would
    // throw on a node no longer in the tree.
    const h = harness('test://plan-subsume.sldd');
    const plan = planDeletion(
      [h.id('arch', 'DataInterface'), h.id('arch', 'DataInterface', 'Element')],
      h.find,
    );
    expect(plan.entries.map((e: any) => e.name)).toEqual(['DataInterface']);
    expect(plan.childGroups).toEqual([]);
  });

  it('plans entries and other entries’ children together', () => {
    const h = harness('test://plan-mixed.sldd');
    const plan = planDeletion(
      [h.id('arch', 'DataInterface', 'Element'), h.id('arch', 'StructType')],
      h.find,
    );
    expect(plan.entries.map((e: any) => e.name)).toEqual(['StructType']);
    expect(plan.childGroups.map((g: any) => g.entry.name)).toEqual(['DataInterface']);
  });

  it('dedupes a row id listed twice', () => {
    const h = harness('test://plan-dupe.sldd');
    const id = h.id('arch', 'DataInterface');
    expect(planDeletion([id, id], h.find).entries).toHaveLength(1);
  });

  it('skips a section header and an id that resolves to nothing', () => {
    // A header is not deletable and a stale id names nothing; neither may abort the
    // rest of the gesture.
    const h = harness('test://plan-skip.sldd');
    const plan = planDeletion(['section:arch', 'no-such-row', h.id('arch', 'DataInterface')], h.find);
    expect(plan.entries.map((e: any) => e.name)).toEqual(['DataInterface']);
    expect(plan.childGroups).toEqual([]);
  });

  it('plans nothing for an empty selection', () => {
    const h = harness('test://plan-empty.sldd');
    expect(planDeletion([], h.find)).toEqual({ entries: [], childGroups: [] });
  });
});
