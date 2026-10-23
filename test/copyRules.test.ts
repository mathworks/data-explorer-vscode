// Copyright 2026 The MathWorks, Inc.
//
// What every table's copy, cut and drag start check before anything reaches a register — said
// once where both registers are filled (structuralEdit's registerItemsOf), and reported once by
// the two actions every provider runs (clipboardAction's copyEntriesToClipboard and
// dragEntries):
//
//  - the section each entry is carried from, '' for a MAT-file's variable (the file's one
//    section), so a same-file move is the usual no-op and the clip mark keys it as the rows do;
//  - whether a move could take the original out alone: a selector with no uuid names whichever
//    entry of that name the delete finds first, so an entry whose name its document holds twice
//    is copied, never cut. In a MAT-file such a variable is not even addressable (its id
//    names both, and core resolves a shared id to neither), so the rule bites on a dictionary's
//    hand-added entries; the MAT-file's source deleter refuses an ambiguous name as a backstop.
import { describe, it, expect, beforeEach } from 'vitest';
import { DataModel } from 'data-explorer-core';
import { copyEntriesToClipboard, dragEntries } from '../src/host/clipboardAction.js';
import { clearClipboard, clipboardState, getClipboard } from '../src/host/clipboard.js';
import { clearDrag, dragDescriptor, getDrag } from '../src/host/dragState.js';
import { buildClipboardSnapshot, buildDragSnapshot, sourceSectionOf } from '../src/host/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const scalar = (name: string, value = 3) => ({ name, className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value, fields: null });

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
