// Copyright 2026 The MathWorks, Inc.
//
// What every table's copy, cut and drag start check before anything reaches a register — said
// once where both registers are filled (structuralEdit's registerItemsOf), and reported once by
// the two actions every provider runs (clipboardAction's copyEntriesToClipboard and
// dragEntries):
//
//  - core's copyRefusal of each entry: what a copy cannot carry is refused where it is made,
//    in core's words, and nothing reaches the register;
//  - the section each entry is carried from, '' for a MAT-file's variable (the file's one
//    section), so a same-file move is the usual no-op and the clip mark keys it as the rows do;
//  - whether a move could take the original out alone: a selector with no uuid names whichever
//    entry of that name the delete finds first, so an entry whose name its document holds twice
//    is copied, never cut. In a MAT-file such a variable is not even addressable (its id
//    names both, and core resolves a shared id to neither), so the rule bites on a dictionary's
//    hand-added entries; the MAT-file's source deleter refuses an ambiguous name as a backstop.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { copyEntriesToClipboard, dragEntries } from '../src/host/clipboardAction.js';
import { clearClipboard, clipboardState, getClipboard, setClipboard } from '../src/host/clipboard.js';
import { clearDrag, dragDescriptor, getDrag } from '../src/host/dragState.js';
import { buildClipboardSnapshot, buildDragSnapshot, sourceSectionOf } from '../src/host/structuralEdit.js';
import { getModel, findNode, invalidate } from 'data-explorer-view/model';

/* eslint-disable @typescript-eslint/no-explicit-any */

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

const scalar = (name: string, value = 3) => ({ name, className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value, fields: null });
// An int8 0x3 empty: a copy carries it as [], which reads back as a double 0x0 (core's
// copyDifference), so core refuses to copy it.
const int8Empty = (name: string) => ({ name, className: 'int8', dimensions: [0, 3], isComplex: false, isLogical: false, value: [], fields: null });

let seq = 0;
/** A MAT-file registered as the editable view registers one, under a prefixed srcId. */
function mat(variables: any[]): { node: any; uri: string; find: (id: string) => any; id: (name: string) => string } {
  const uri = `file:///work/copyrules-${seq++}.mat`;
  const srcId = `binedit:${uri}`;
  DataModel.removeDataSource(srcId);
  const node: any = DataModel.addMatSourceParsed(srcId, { header: 'MATLAB 5.0', variables }, { path: uri.split('/').pop() });
  return {
    node,
    uri,
    find: (id: string) => (DataModel as any).findNodeById(id) ?? null,
    id: (name: string) => node.children.find((v: any) => v.name === name).id,
  };
}

function deps(find: (id: string) => any) {
  const posted: any[] = [];
  let broadcasts = 0;
  return {
    posted,
    broadcasts: () => broadcasts,
    deps: { refresh: () => {}, findNode: find, post: (m: any) => posted.push(m), broadcast: () => void broadcasts++ },
  };
}

beforeEach(() => {
  clearClipboard();
  clearDrag();
});

describe("a MAT-file's variables on a register", () => {
  it("are carried from its one section, '', by both registers", () => {
    const m = mat([scalar('Kp'), scalar('Ki', 2)]);
    expect(sourceSectionOf(m.node.children[0])).toBe('');
    expect(buildClipboardSnapshot([m.id('Kp'), m.id('Ki')], m.find).map((i) => [i.sourceSection, i.payload.name])).toEqual([
      ['', 'Kp'],
      ['', 'Ki'],
    ]);
    expect(buildDragSnapshot([m.id('Ki')], m.find).items.map((i) => i.sourceSection)).toEqual(['']);
  });

  it('copy and cut put them on the clipboard, payload as core serializes it', () => {
    const m = mat([scalar('Kp')]);
    const h = deps(m.find);
    expect(copyEntriesToClipboard([m.id('Kp')], 'cut', m.uri, h.deps)).toBe(true);
    expect(getClipboard()).toMatchObject({ mode: 'cut', sourceDocUri: m.uri });
    expect(getClipboard()!.items[0].payload).toEqual({ name: 'Kp', metadata: null, value: 3 });
    expect(h.posted).toEqual([]);
    expect(h.broadcasts()).toBe(1);
  });
});

describe("core's copyRefusal, asked where both registers are filled", () => {
  // A copy of an int8 0x3 keeps its class and loses its shape (a MAT-file's classed, shaped empty).
  const refusal = 'Cannot copy "e8": what a copy carries of it reads back as another value (e8: its size reads back as 0x0 where 0x3 was written). Nothing was copied.';

  it('refuses a copy in its words, and leaves the clipboard as it was', () => {
    const m = mat([scalar('Kp'), int8Empty('e8')]);
    expect(DataModel.copyRefusal(m.id('e8'))).toBe(refusal);
    setClipboard([{ payload: { name: 'Earlier' }, sourceSection: 'design', className: '', arrayClass: '', kind: '', isMatlabVariable: true, isScalarNumeric: false }], 'copy', 'file:///other.sldd');
    const h = deps(m.find);
    expect(copyEntriesToClipboard([m.id('Kp'), m.id('e8')], 'copy', m.uri, h.deps)).toBe(false);
    expect(h.posted).toEqual([{ type: 'error', message: refusal }]);
    expect(getClipboard()!.items[0].payload.name).toBe('Earlier');
    expect(h.broadcasts()).toBe(0);
  });

  it('refuses a drag start the same way, and leaves no drag behind', () => {
    const m = mat([int8Empty('e8')]);
    const h = deps(m.find);
    expect(dragEntries([m.id('e8')], m.uri, h.deps)).toBe(false);
    expect(h.posted).toEqual([{ type: 'error', message: refusal }]);
    expect(getDrag()).toBeNull();
    expect(h.broadcasts(), 'every table is told no drag is on').toBe(1);
  });

  it("passes a dictionary's entries, which it can copy, as before", () => {
    const uri = 'test://copyrules-arch.sldd';
    invalidate(uri);
    getModel(uri, 'arch.sldd', archText);
    const h = deps((id) => findNode(uri, id));
    expect(copyEntriesToClipboard([`${uri}/arch/DataInterface`], 'cut', uri, h.deps)).toBe(true);
    expect(getClipboard()!.items.map((i) => [i.sourceSection, i.payload.name, i.sharedName])).toEqual([['arch', 'DataInterface', undefined]]);
  });
});

describe('an entry whose name its document holds twice', () => {
  // Two variables of one name, as a MAT-file holding two records of it reads. Both are one id (an
  // id is a path), and core refuses every id-addressed gesture on an id that names two nodes, and
  // says so when the file opens: so neither row resolves, and neither is copied or cut. The file's
  // other variables are.
  it("in a MAT-file, is not copied or cut — its id names both, which core resolves to neither", () => {
    const m = mat([scalar('x', 1), scalar('str', 2), scalar('x', 3)]);
    const shared = m.node.children[0].id;
    expect(m.node.children[2].id).toBe(shared);
    expect(m.find(shared)).toBeNull();
    for (const mode of ['copy', 'cut'] as const) {
      const h = deps(m.find);
      expect(copyEntriesToClipboard([shared], mode, m.uri, h.deps)).toBe(false);
      expect(h.posted).toEqual([{ type: 'error', message: `Could not ${mode} the selected item.` }]);
    }
    const h = deps(m.find);
    expect(copyEntriesToClipboard([m.id('str')], 'cut', m.uri, h.deps)).toBe(true);
    expect(getClipboard()!.items.map((i) => [i.payload.name, i.sharedName])).toEqual([['str', undefined]]);
  });

  // The rule itself, on a document whose two same-named entries ARE told apart by id: a
  // dictionary's, one in each of two sections. Without metadata (added by hand) the two are one
  // selector, which the move's delete would resolve to either; with their uuids, two.
  const doc = (uuids: boolean) => {
    const root: any = { name: 'dd', children: [] };
    for (const section of ['design', 'other']) {
      const s: any = { name: section, parent: root, children: [] };
      const entry: any = { isEntry: true, name: 'A', parent: s, metadata: uuids ? { uuid: `u-${section}` } : undefined };
      entry.serialize = () => ({ name: 'A', metadata: entry.metadata ?? null, value: 1 });
      s.children.push(entry);
      root.children.push(s);
    }
    return root.children.map((s: any) => s.children[0]);
  };

  it('is copied, its items saying a move could not take it out alone, payload-free too', () => {
    const [design] = doc(false);
    const h = deps(() => design);
    expect(copyEntriesToClipboard(['a'], 'copy', 'file:///w/d.sldd', h.deps)).toBe(true);
    expect(getClipboard()!.items.map((i) => [i.sourceSection, i.payload.name, i.sharedName])).toEqual([['design', 'A', true]]);
    // As the webview reads it: the drop predictor and the Paste menu see it too.
    expect(clipboardState().items.map((i: any) => i.sharedName)).toEqual([true]);
  });

  it('is not cut: refused, naming it and its file, before anything is marked', () => {
    const [design] = doc(false);
    const h = deps(() => design);
    expect(copyEntriesToClipboard(['a'], 'cut', 'file:///w/my%20d.sldd', h.deps)).toBe(false);
    expect(h.posted).toEqual([
      { type: 'error', message: 'Cannot cut "A": my d.sldd holds more than one "A", and a move takes its original out by name. Copy it instead.' },
    ]);
    expect(getClipboard()).toBeNull();
    expect(h.broadcasts()).toBe(0);
  });

  it('is dragged, its descriptor saying so, for the drop to refuse a move of it', () => {
    const [, other] = doc(false);
    const h = deps(() => other);
    expect(dragEntries(['a'], 'file:///w/d.sldd', h.deps)).toBe(true);
    expect(dragDescriptor()!.items.map((i: any) => [i.sectionName, i.sharedName])).toEqual([['other', true]]);
    expect(h.posted).toEqual([]);
  });

  it('is told apart by a uuid, which a dictionary entry read from its file has', () => {
    const [tagged] = doc(true);
    expect(buildClipboardSnapshot(['a'], () => tagged)[0].sharedName).toBeUndefined();
  });
});

describe('dragEntries', () => {
  it('starts a drag of every entry the rows resolve to, and tells every table', () => {
    const m = mat([scalar('Kp'), scalar('Ki', 2)]);
    const h = deps(m.find);
    expect(dragEntries([m.id('Kp'), m.id('Ki')], m.uri, h.deps)).toBe(true);
    expect(getDrag()).toMatchObject({ sourceDocUri: m.uri });
    expect(getDrag()!.items.map((i) => i.payload.name)).toEqual(['Kp', 'Ki']);
    expect(h.broadcasts()).toBe(1);
  });

  it('clears the drag when no row resolves to an entry, saying nothing', () => {
    const m = mat([scalar('Kp')]);
    const h = deps(() => null);
    expect(dragEntries(['gone'], m.uri, h.deps)).toBe(false);
    expect(getDrag()).toBeNull();
    expect(h.posted).toEqual([]);
    expect(h.broadcasts()).toBe(1);
  });

  it('says a failed start as a failure, and leaves no drag behind', () => {
    const h = deps(() => ({ isEntry: true, parent: {}, serialize: () => { throw new Error('boom'); } }));
    expect(dragEntries(['x'], 'file:///d.sldd', h.deps)).toBe(false);
    expect(h.posted).toEqual([{ type: 'error', message: 'Failed to drag: boom' }]);
    expect(getDrag()).toBeNull();
  });
});

// A MAT-file's variable is told by name alone, so its document hands each one taken a token
// (CopyDeps.originOf), which the register item carries back to that document's deleter. It
// travels to nothing else: the payload, and what the webview is told, are as they were.
describe("a document's origin token for what it lets go of", () => {
  it('is carried by every item of a copy and a drag, and shown to no table', () => {
    const m = mat([scalar('Kp'), scalar('Ki', 2)]);
    const tokens = new Map<any, object>();
    const originOf = (entry: any) => {
      if (!tokens.has(entry)) tokens.set(entry, {});
      return tokens.get(entry)!;
    };
    const h = deps(m.find);
    expect(copyEntriesToClipboard([m.id('Kp'), m.id('Ki')], 'cut', m.uri, { ...h.deps, originOf })).toBe(true);
    const [kp, ki] = m.node.children;
    expect(getClipboard()!.items.map((i) => i.origin)).toEqual([tokens.get(kp), tokens.get(ki)]);
    expect(getClipboard()!.items[0].origin).toBe(tokens.get(kp));
    expect(getClipboard()!.items[0].payload).toEqual({ name: 'Kp', metadata: null, value: 3 });
    expect(JSON.stringify(clipboardState())).not.toContain('origin');

    expect(dragEntries([m.id('Ki')], m.uri, { ...h.deps, originOf })).toBe(true);
    expect(getDrag()!.items[0].origin).toBe(tokens.get(ki));
    expect(JSON.stringify(dragDescriptor())).not.toContain('origin');
  });

  it("is absent where the document hands none out, as a dictionary's does", () => {
    const m = mat([scalar('Kp')]);
    const h = deps(m.find);
    expect(copyEntriesToClipboard([m.id('Kp')], 'copy', m.uri, h.deps)).toBe(true);
    expect('origin' in getClipboard()!.items[0]).toBe(false);
  });
});
