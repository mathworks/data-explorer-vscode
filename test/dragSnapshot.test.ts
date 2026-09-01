// Copyright 2026 The MathWorks, Inc.
//
// buildDragSnapshot turns the ROW ids a drag started on into the ENTRY payloads
// the eventual drop pastes. Both table providers (SlddTextEditorProvider for JSON
// .sldd, BinarySlddEditorProvider for compressed-binary) call it with only their
// own findNode injected — it used to be two near-identical copies, and a
// divergence would mean the same drag behaved differently depending on which
// .sldd format the user opened.
//
// These tests drive it with a REAL model built from test/fixtures/arch.sldd and
// then run the resulting payloads through the real pasteEntries, because the bug
// this file most cares about (duplicate copies) is only visible downstream of the
// snapshot.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildDragSnapshot, pasteEntries } from '../src/host/structuralEdit.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

function harness(uri: string) {
  invalidate(uri);
  const model = getModel(uri, 'arch.sldd', archText);
  return {
    model,
    find: (rowId: string) => findNode(uri, rowId),
    // Row ids are name-paths, so they can be spelled directly.
    id: (section: string, ...rest: string[]) => [uri, section, ...rest].join('/'),
    section: (name: string) => model.children.find((s: any) => s.name === name),
  };
}

describe('buildDragSnapshot', () => {
  it('snapshots a single dragged entry with the facts the drop predictor needs', () => {
    // The webview never sees the model; it predicts the drop purely from these
    // per-item facts, so each one has to come off the real entry.
    const h = harness('test://snap-one.sldd');
    const snap = buildDragSnapshot([h.id('arch', 'DataInterface')], h.find);
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).toMatchObject({
      className: 'Simulink.Bus',
      arrayClass: 'Simulink.Bus',
      kind: 'Data Interface',
      isMatlabVariable: false,
      isScalarNumeric: false,
    });
    expect(snap.items[0].payload.name).toBe('DataInterface');
    expect(snap).toMatchObject({
      sourceSection: 'arch',
      sourceSectionLabel: 'Architectural Data',
      sourceIsDerived: true,
    });
  });

  it('marks a plain scalar-numeric variable as such — that is what lets it convert on drop', () => {
    // A MATLAB variable may become a Constant when dropped into Architectural
    // Data, but ONLY if it is scalar-numeric. Getting isScalarNumeric wrong means
    // either a refused drop that should work or a conversion that cannot.
    const h = harness('test://snap-const.sldd');
    const snap = buildDragSnapshot([h.id('arch', 'Constant')], h.find);
    expect(snap.items[0]).toMatchObject({
      arrayClass: '',
      isMatlabVariable: true,
      isScalarNumeric: true,
    });
  });

  // REGRESSION. A drag carries whole ENTRIES, but a multi-selection is a set of
  // ROWS, and several rows can belong to one entry: shift-selecting a bus and the
  // elements nested under it selects three rows of one entry. Snapshotting per row
  // put the same entry in the register three times, so the drop pasted
  // DataInterface1, DataInterface2 AND DataInterface3 while a move deleted the one
  // source once — the user dragged one thing and got three copies of it.
  it('dedupes rows that share an owning entry, so a parent+children drag pastes ONCE', () => {
    const uri = 'test://snap-dedupe.sldd';
    const h = harness(uri);
    const snap = buildDragSnapshot(
      [h.id('arch', 'DataInterface'), h.id('arch', 'DataInterface', 'Element'), h.id('arch', 'DataInterface', 'Element1')],
      h.find,
    );
    expect(snap.items.map((i) => i.payload.name)).toEqual(['DataInterface']);

    // The point: paste the snapshot the way applyDrop does and exactly one copy
    // lands, named off the single source.
    const { newText, selectIds } = pasteEntries(archText, h.section('design'), snap.items.map((i) => i.payload));
    expect(selectIds).toEqual([`${uri}/design/DataInterface1`]);
    expect(newText.match(/"name": "DataInterface\d*"/g)).toEqual(['"name": "DataInterface"', '"name": "DataInterface1"']);
  });

  it('keeps genuinely distinct entries that happen to share a name', () => {
    // Dedupe is by node IDENTITY, not by name: the same name in two sections is
    // two entries and both may legitimately be dragged at once. Deduping by name
    // would silently drop one of them.
    const h = harness('test://snap-distinct.sldd');
    const snap = buildDragSnapshot([h.id('arch', 'ValueType'), h.id('arch', 'ValueType1')], h.find);
    expect(snap.items.map((i) => i.payload.name)).toEqual(['ValueType', 'ValueType1']);
  });

  it('preserves the order the rows were given in', () => {
    // The drop pastes in this order and selects the last one, so a reorder would
    // leave the wrong row selected after the gesture.
    const h = harness('test://snap-order.sldd');
    const ids = [h.id('arch', 'NumericType'), h.id('arch', 'AliasType'), h.id('arch', 'ValueType')];
    expect(buildDragSnapshot(ids, h.find).items.map((i) => i.payload.name)).toEqual([
      'NumericType',
      'AliasType',
      'ValueType',
    ]);
  });

  it('resolves a nested child row to its owning entry — a drag carries whole entries', () => {
    // Grabbing a bus element drags the BUS. A drop cannot paste half an entry.
    const h = harness('test://snap-child.sldd');
    const snap = buildDragSnapshot([h.id('arch', 'DataInterface', 'Element')], h.find);
    expect(snap.items.map((i) => i.payload.name)).toEqual(['DataInterface']);
  });

  it('skips section-header rows, which are not entries', () => {
    // The table already filters `section:*` out before posting, but a drag that
    // reached here with only headers must yield nothing rather than a bogus item —
    // the caller reads items.length === 0 to mean "clear the register".
    const h = harness('test://snap-sections.sldd');
    expect(buildDragSnapshot(['section:arch', 'section:design'], h.find).items).toEqual([]);
  });

  it('skips a row id that no longer resolves instead of abandoning the drag', () => {
    // A stale id can arrive if the model was rebuilt between drag start and this
    // call. The other dragged rows are still valid and must survive.
    const h = harness('test://snap-stale.sldd');
    const snap = buildDragSnapshot([h.id('arch', 'GoneAway'), h.id('arch', 'ValueType')], h.find);
    expect(snap.items.map((i) => i.payload.name)).toEqual(['ValueType']);
  });

  it('returns an empty snapshot for a non-array rowIds — the message is untrusted', () => {
    // rowIds arrives over postMessage from the webview, so it is `unknown` in
    // practice. Anything but an array means "nothing is being dragged".
    const h = harness('test://snap-bad.sldd');
    for (const bad of [undefined, null, 'section:arch', 42, {}]) {
      expect(buildDragSnapshot(bad, h.find).items).toEqual([]);
    }
    expect(buildDragSnapshot([], h.find)).toEqual({
      items: [],
      sourceSection: '',
      sourceSectionLabel: '',
      sourceIsDerived: false,
    });
  });
});
