// Copyright 2026 The MathWorks, Inc.
//
// The entry-scoped repaint for a compressed-binary .sldd: an edit paints ONE entry's
// rows from the model it just mutated, instead of re-parsing the whole dictionary and
// rebuilding every row. On a real customer file (75 MB of data/chunk0.xml, 31k entries)
// the old path spent ~7.5 s per keystroke-commit — two full parses of the same XML, one
// before the mutation and one to repaint — to express a one-cell change.
//
// BinarySlddEditorProvider imports `vscode` and cannot run under vitest, so — like
// binaryDirtyLifecycle.test.ts beside it — this reproduces the provider's composition
// from the real modules:
//   BinarySlddParser     (parseBinarySlddParts)      — the parse post() no longer does
//   DataModel            (mutateSubtree, findNodeById)
//   BinarySlddSerializer (serializeEntryToXml)
//   xmlEntrySplice       (findEntryObjectSpan)
//   xmlStructuralEdit    (addChildXml / deleteChildXml)
//   slddBaseline         (isEntryModified vs computeModified)
//   rowBuilder           (buildEntryRows vs buildRows)
//   rowUpdates           (spliceEntryRows — the webview's half)
//
// Two invariants, and they are the whole point:
//
//  1. NARROW === WIDE. Splicing the entry's freshly built rows into the rows already on
//     screen must produce, row for row, what a full re-parse-and-rebuild would have
//     produced. Anything the fast path gets wrong here is a table that disagrees with
//     the file until something else forces a full repaint.
//
//  2. The row ids it paints must still RESOLVE. Skipping the re-parse means skipping the
//     re-registration that used to rebuild DataModel's node index — and a node id is a
//     path, so a rename rekeys the entry and everything under it. Get this wrong and the
//     edit looks fine; it is the NEXT edit on that row that fails with "could not locate
//     the edited item in the model".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, parseBinarySlddParts, serializeEntryToXml } from 'data-explorer-core';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import { entrySelectorOf } from '../src/host/entrySelector.js';
import { addChildXml, deleteChildXml } from '../src/host/xmlStructuralEdit.js';
import { captureBaseline, computeModified, isEntryModified, clearBaseline } from '../src/host/slddBaseline.js';
import { buildRows, buildEntryRows } from '../src/host/rowBuilder.js';
import { spliceEntryRows } from '../src/webview/rowUpdates.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const bytes = readFileSync(
  fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url)),
);

function loadFixture() {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return { xml, meta };
}

// One open document, with the provider's two repaint paths side by side.
function openDoc(uri: string) {
  const srcId = 'binedit:' + uri;
  const { xml, meta } = loadFixture();
  clearBaseline(uri);
  DataModel.removeDataSource(srcId);
  const doc = { chunkXml: xml };

  // buildModel(): re-parse chunkXml and re-register. What post() does, and what an
  // edit is no longer allowed to do.
  const build = () => {
    DataModel.removeDataSource(srcId);
    return DataModel.addDataSource(srcId, parseBinarySlddParts(doc.chunkXml, meta), { path: 'params.sldd' });
  };
  // liveModel(): the tree as it already stands.
  const live = () => (DataModel as any).getDataSource(srcId) ?? build();

  captureBaseline(uri, build());

  // post(): the wide repaint — re-parse, diff every entry, rebuild every row.
  const widePaint = () => {
    const model = build();
    return buildRows(model, computeModified(uri, model));
  };
  // postEntry(): the narrow repaint — this entry's subtree, from the live model.
  const narrowPaint = (entry: any) => {
    const modified = new Set<string>();
    if (isEntryModified(uri, entry)) modified.add(entry.name);
    return buildEntryRows(entry, entry.parent.name, modified);
  };
  // The text half of an edit: replace the owning entry's <Object> with its
  // reserialization, addressed by the selector the entry had BEFORE the mutation.
  const spliceEntryText = (entry: any, selector: ReturnType<typeof entrySelectorOf>) => {
    const frag = serializeEntryToXml(entry).replace(/\n$/, '');
    const span = findEntryObjectSpan(doc.chunkXml, selector);
    expect(span, `the entry text for "${selector.name}" is locatable`).not.toBeNull();
    doc.chunkXml = doc.chunkXml.slice(0, span!.offset) + frag + doc.chunkXml.slice(span!.offset + span!.length);
  };

  const entryNamed = (name: string) =>
    (live() as any).children.flatMap((s: any) => s.children).find((e: any) => e.name === name);

  const dispose = () => {
    DataModel.removeDataSource(srcId);
    clearBaseline(uri);
  };

  return { doc, build, live, widePaint, narrowPaint, spliceEntryText, entryNamed, dispose };
}

// Every row the narrow paint produced must name a node the session can still find —
// the question the NEXT edit on that row asks.
function expectRowsResolve(rows: any[]): void {
  for (const row of rows) {
    expect((DataModel as any).findNodeById(row.ID), `row ${row.ID} resolves to a node`).toBeTruthy();
  }
}

describe('binary .sldd entry-scoped repaint — narrow paint equals wide paint', () => {
  it('a value edit: spliced rows are identical to a full rebuild', () => {
    const d = openDoc('test://scoped-value.sldd');
    const onScreen = d.widePaint();
    const entry = d.entryNamed('scalarD');
    const entryRowId = entry.id;

    const applied = (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    expect(applied).toBe(true);
    d.spliceEntryText(entry, entrySelectorOf(entry));

    const narrow = spliceEntryRows(onScreen, entryRowId, d.narrowPaint(entry));
    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });

  it('a rename: spliced rows are identical to a full rebuild, and the new ids resolve', () => {
    const d = openDoc('test://scoped-rename.sldd');
    const onScreen = d.widePaint();
    const entry = d.entryNamed('scalarD');
    // Snapshotted BEFORE the mutation, both of them: the selector addresses the text as
    // it is still written, the row id addresses the run as it is still displayed.
    const selector = entrySelectorOf(entry);
    const entryRowId = entry.id;

    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Name', 'scalarRenamed'));
    d.spliceEntryText(entry, selector);

    const entryRows = d.narrowPaint(entry);
    expect(entryRows[0].ID).not.toBe(entryRowId);
    expectRowsResolve(entryRows);
    // And the id the table used to show this entry under is gone, so a stale row id
    // cannot route an edit at a node that has since moved.
    expect((DataModel as any).findNodeById(entryRowId)).toBeNull();

    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('a rename of an entry WITH children rekeys the children too', () => {
    // The case a per-node index patch gets wrong: nothing touched the bus elements, but
    // their ids are paths through the entry that was renamed.
    const d = openDoc('test://scoped-rename-children.sldd');
    const onScreen = d.widePaint();
    const bus = d.entryNamed('MyBus');
    expect(bus.children.length).toBeGreaterThan(0);
    const selector = entrySelectorOf(bus);
    const entryRowId = bus.id;
    const childIdsBefore = bus.children.map((c: any) => c.id);

    (DataModel as any).mutateSubtree(bus, () => bus.setProperty('Name', 'MyRenamedBus'));
    d.spliceEntryText(bus, selector);

    const entryRows = d.narrowPaint(bus);
    expect(entryRows.length).toBe(1 + bus.children.length);
    expectRowsResolve(entryRows);
    for (const stale of childIdsBefore) {
      expect((DataModel as any).findNodeById(stale)).toBeNull();
    }

    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('an edit on a nested child paints the whole entry subtree', () => {
    // The user's design: the update unit is the ENTRY, whatever depth the change was at,
    // so nothing has to track which rows inside an entry a change could have touched.
    const d = openDoc('test://scoped-child-value.sldd');
    const onScreen = d.widePaint();
    const struct = d.entryNamed('myStruct');
    const field = struct.children[0];
    const entryRowId = struct.id;

    (DataModel as any).mutateSubtree(struct, () => field.setProperty('Value', '7'));
    d.spliceEntryText(struct, entrySelectorOf(struct));

    const entryRows = d.narrowPaint(struct);
    expect(entryRows.map((r: any) => r.ID)).toContain(field.id);
    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('adding a child grows the entry run and the new row resolves', () => {
    const d = openDoc('test://scoped-add-child.sldd');
    const onScreen = d.widePaint();
    const bus = d.entryNamed('MyBus');
    const entryRowId = bus.id;
    const runBefore = onScreen.filter((r: any) => r.ID === entryRowId || r.parent === entryRowId).length;

    const { newText } = (DataModel as any).mutateSubtree(bus, () => addChildXml(d.doc.chunkXml, bus));
    d.doc.chunkXml = newText;

    const entryRows = d.narrowPaint(bus);
    expect(entryRows.length).toBe(runBefore + 1);
    // The child the user is about to be selected on, and may edit next.
    expectRowsResolve(entryRows);
    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });

  it('deleting a nested child shrinks the entry run and drops its id', () => {
    const d = openDoc('test://scoped-delete-child.sldd');
    const onScreen = d.widePaint();
    const bus = d.entryNamed('MyBus');
    const element = bus.children[0];
    const elementId = element.id;
    const entryRowId = bus.id;

    const { newText } = (DataModel as any).mutateSubtree(bus, () => deleteChildXml(d.doc.chunkXml, element));
    d.doc.chunkXml = newText;

    const entryRows = d.narrowPaint(bus);
    expect(entryRows.map((r: any) => r.ID)).not.toContain(elementId);
    // Not merely absent from the rows: gone from the index, so a row id left over in
    // some other view cannot route an edit into a detached node.
    expect((DataModel as any).findNodeById(elementId)).toBeNull();
    expect(spliceEntryRows(onScreen, entryRowId, entryRows)).toEqual(d.widePaint());
    d.dispose();
  });
});

describe('binary .sldd entry-scoped repaint — the Modified mark', () => {
  it('marks the edited entry, and only it', () => {
    const d = openDoc('test://scoped-modified.sldd');
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    d.spliceEntryText(entry, entrySelectorOf(entry));

    expect(d.narrowPaint(entry)[0].Status).toBe('Modified');
    const untouched = d.entryNamed('gravity');
    expect(d.narrowPaint(untouched)[0].Status).toBeFalsy();
    d.dispose();
  });

  it('stays marked when an entry is edited BACK to its saved value', () => {
    // Not the obvious answer, and worth pinning: the value round-trips exactly, but a
    // dictionary entry carries a lastModified stamp that every edit rewrites, so its
    // canonical JSON no longer matches the baseline and the entry is still, correctly,
    // modified with respect to the last SAVE. Both repaint paths agree on that.
    const uri = 'test://scoped-modified-back.sldd';
    const d = openDoc(uri);
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    const original = entry.toRow().Value;

    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    d.spliceEntryText(entry, entrySelectorOf(entry));
    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', String(original)));
    d.spliceEntryText(entry, entrySelectorOf(entry));

    expect(entry.toRow().Value).toBe(original);
    expect(d.narrowPaint(entry)[0].Status).toBe('Modified');
    expect(computeModified(uri, d.build())).toEqual(new Set(['scalarD']));
    d.dispose();
  });

  it('lets the caller CLEAR a mark the node itself is still carrying', () => {
    // The rule the narrow path needs and the wide path never did: `modifiedNames` is
    // authoritative in both directions. A node sets its own `status = 'Modified'` the
    // moment it is touched and never clears it (DataNode._markModified), and the wide
    // path was blind to that because it re-parsed and threw the mutated node away. The
    // narrow path keeps the node, so the baseline diff — which is what "Modified" MEANS
    // here — has to be able to overrule the node's own flag.
    //
    // The stamp above is why no end-to-end sequence reaches this today. It is pinned as
    // a unit rule rather than left to chance because the alternative is a row that stays
    // marked forever on the strength of a flag that answers a different question.
    const d = openDoc('test://scoped-modified-authoritative.sldd');
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    (DataModel as any).mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    expect(entry.status).toBe('Modified');

    expect(buildEntryRows(entry, entry.parent.name, new Set<string>())[0].Status).toBe('');
    // ...and with no set at all the node's own status still shows through, which is what
    // a caller that has no baseline to diff against (before the first capture) reports.
    expect(buildEntryRows(entry, entry.parent.name)[0].Status).toBe('Modified');
    d.dispose();
  });

  it('isEntryModified answers for one entry what computeModified answers for all', () => {
    // Two repaint paths ask the same question through different functions; if they can
    // disagree, a "Modified" dot appears or clears depending on which repaint the user
    // happened to trigger. They share differsFromBaseline for exactly this reason.
    const uri = 'test://scoped-modified-agree.sldd';
    const d = openDoc(uri);
    d.widePaint();
    const entry = d.entryNamed('MyBus');
    (DataModel as any).mutateSubtree(entry, () => entry.children[0].setProperty('Name', 'RenamedElement'));
    d.spliceEntryText(entry, entrySelectorOf(entry));

    const model = d.live() as any;
    const wide = computeModified(uri, model);
    for (const section of model.children) {
      for (const e of section.children) {
        expect(isEntryModified(uri, e), `${e.name}`).toBe(wide.has(e.name));
      }
    }
    expect(wide).toEqual(new Set(['MyBus']));
    d.dispose();
  });
});
