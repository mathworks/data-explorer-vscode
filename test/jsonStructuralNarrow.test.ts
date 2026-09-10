// Copyright 2026 The MathWorks, Inc.
//
// A STRUCTURAL edit of a JSON .sldd — delete an entry, add or delete a nested child, paste,
// move — repainted as the rows it changed instead of as the whole table.
//
// The narrow repaint arrived here one path at a time: first a keystroke in the text view
// (jsonEntryScopedSync.test.ts), then a table cell edit and its undo. Everything else still
// went wide, and "wide" on a 47.8 MB customer dictionary means re-parsing the document
// (~400 ms), diffing all 64,700 entries for their Modified mark, rebuilding ~130,000 rows and
// posting ~120 MB of them — after the delete, and again after its undo. The entries that
// changed are one or two.
//
// SlddTextEditorProvider imports `vscode` and cannot run under vitest, so — as in
// jsonEntryScopedSync.test.ts and binaryEntryScopedEdit.test.ts beside it — this reproduces
// the provider's composition from the real modules:
//   structuralEdit  (deleteEntry/addChild/deleteChild/pasteEntry) — the text transforms
//   entryOps        (removeOp/insertOp/applyEntryOps/opsOfPastedEntries) — the model change
//   jsonEntrySync   (planKnownOps) — an undo or a redo of one of those, recognised
//   rowUpdates      (spliceEntryRows/insertEntryRows) — the webview's half
//   slddBaseline + rowBuilder — the two ways the Modified mark is computed
//
// THE INVARIANT IS THE ONE THAT MATTERS: narrow === wide. Whatever the narrow path splices,
// removes or inserts, the table afterwards must be — row for row, cell for cell, Modified mark
// included — what re-parsing the new text and rebuilding every row would have produced. A
// structural edit is where that is hardest, because the row COUNT changes and the rows the
// webview keeps are the ones the host never mentions.
//
// And the second one, invisible until the NEXT edit: every id the repaint paints must still
// resolve in the session index (DataModel.findNodeById), or the next edit on that row fails
// with "could not locate the edited item". The wide re-parse used to repair that as a side
// effect.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import {
  applyEntryOps,
  findEntryByName,
  findEntryBySelector,
  insertAnchorOf,
  insertOp,
  mutateEntry,
  opsOfPastedEntries,
  patchOfPairs,
  removeOp,
  replaceOp,
  type AppliedOp,
  type EntryOpPair,
} from '../src/host/entryOps.js';
import { planKnownOps, type KnownEdit, type RangeReplacement } from '../src/host/jsonEntrySync.js';
import {
  addChild,
  applyTextPatch,
  deleteChild,
  deleteEntriesByName,
  deleteEntry,
  pasteEntry,
  type TextPatch,
} from '../src/host/structuralEdit.js';
import { minimalReplacement } from '../src/host/minimalEdit.js';
import { getModel, invalidate, peekModel } from '../src/host/SlddModel.js';
import { captureBaseline, computeModified, isEntryModified, clearBaseline } from '../src/host/slddBaseline.js';
import { buildRows, buildEntryRows } from '../src/host/rowBuilder.js';
import { spliceEntryRows, insertEntryRows } from '../src/webview/rowUpdates.js';
import { buildSectionRowId } from '../src/common/sectionRowId.js';
import { entrySelectorOf } from '../src/host/entrySelector.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = 'numeric_json.sldd';
const text = readFileSync(fileURLToPath(new URL(`./fixtures/${FIXTURE}`, import.meta.url)), 'utf8');

/**
 * One open document, with the provider's two repaint paths side by side.
 *
 * The text is spliced the way the provider writes it — one TextPatch, the region the
 * transform named — so `widePaint` re-parses exactly the document VS Code would hold.
 */
function openDoc(uri: string) {
  clearBaseline(uri);
  DataModel.removeDataSource(uri);
  invalidate(uri);
  const doc = { text };

  const build = () => {
    invalidate(uri);
    return getModel(uri, FIXTURE, doc.text);
  };
  captureBaseline(uri, build());

  // post(): the wide repaint — re-parse, diff every entry, rebuild every row.
  const widePaint = () => {
    const model = build();
    return buildRows(model, computeModified(uri, model));
  };
  // postEntryRows(): one entry's rows, from the live model.
  const narrowPaint = (entry: any) => {
    const modified = new Set<string>();
    if (isEntryModified(uri, entry)) modified.add(entry.name);
    return buildEntryRows(entry, entry.parent.name, modified);
  };

  /** The tree registered for this document — what liveModel() hands the edit path. */
  const model = () => {
    const m = peekModel(uri);
    expect(m, 'the document has a registered tree to edit').toBeTruthy();
    return m as any;
  };

  /** What VS Code does with the patch the provider writes. */
  const write = (patch: TextPatch | undefined) => {
    expect(patch, 'the transform named the region it changed').toBeTruthy();
    doc.text = applyTextPatch(doc.text, patch!);
  };

  /**
   * repaintOps(): the webview's half of the narrow repaint, applied to the rows it holds.
   *
   * The three messages the host can send about an op, in the same order the provider sends
   * them — an empty replacement for a removal, the entry's fresh rows for a replace, and the
   * insert that has to be told its place.
   */
  const paintOps = (rows: any[], applied: AppliedOp[]) => {
    let out = rows;
    for (const op of applied) {
      const next =
        op.kind === 'remove'
          ? spliceEntryRows(out, op.entryRowId, [])
          : op.kind === 'replace'
            ? spliceEntryRows(out, op.entryRowId, narrowPaint(op.entry))
            : insertEntryRows(
                out,
                buildSectionRowId(op.entry.parent.name),
                op.beforeRowId,
                narrowPaint(op.entry),
              );
      expect(next, `the table could place the ${op.kind}`).not.toBeNull();
      out = next!;
    }
    return out;
  };

  const entryNamed = (name: string) =>
    ((peekModel(uri) as any)?.children ?? [])
      .flatMap((s: any) => s.children)
      .find((e: any) => e.name === name);

  const dispose = () => {
    DataModel.removeDataSource(uri);
    clearBaseline(uri);
    invalidate(uri);
  };

  return { doc, widePaint, narrowPaint, model, write, paintOps, entryNamed, dispose };
}

const openDocs: Array<() => void> = [];
function open(uri: string) {
  const d = openDoc(uri);
  openDocs.push(d.dispose);
  return d;
}
afterAll(() => openDocs.forEach((d) => d()));

/** The range replacement the provider hands the document for a patch. */
const submittedOf = (before: string, patch: TextPatch): RangeReplacement => ({
  rangeOffset: patch.offset,
  rangeLength: patch.length,
  text: patch.text,
});

/** What the host remembers, so an undo or a redo of it needs no scan. */
const rememberOf = (before: string, patch: TextPatch, pairs: EntryOpPair[]): KnownEdit => ({
  submitted: submittedOf(before, patch),
  replaced: before.slice(patch.offset, patch.offset + patch.length),
  patch: patchOfPairs(pairs),
});

/** The change VS Code reports when `known` is undone: the pair, the other way round. */
const undoOf = (known: KnownEdit): RangeReplacement => ({
  rangeOffset: known.submitted.rangeOffset,
  rangeLength: known.submitted.text.length,
  text: known.replaced,
});

/** ...and when it is redone: the same edit, forwards. */
const redoOf = (known: KnownEdit): RangeReplacement => ({ ...known.submitted });

// ---------------------------------------------------------------------------------------
// The forward edits.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd structural edit — narrow === wide', () => {
  it('delete: the entry’s run leaves the table and no other row moves', () => {
    const d = open('test://struct-delete.sldd');
    const before = d.widePaint();
    const entry = d.entryNamed('Number');
    const entryRowId = entry.id;

    // The transform is text-only, so the model half is an op — and it is captured while the
    // entry is still attached, because that is what an undo needs (section and index).
    const pairs: EntryOpPair[] = [{ redo: removeOp(entryRowId), undo: insertOp(entry) }];
    const result = deleteEntry(d.doc.text, entry);
    const applied = applyEntryOps(d.model(), [removeOp(entryRowId)]);
    d.write(result.patch);

    const narrow = d.paintOps(before, applied);
    expect(narrow.some((r: any) => r.ID === entryRowId), 'the deleted run is gone').toBe(false);
    expect(narrow.length).toBe(before.length - 1);
    // The id the delete took away must stop resolving, or a later op could still find it.
    expect(DataModel.findNodeById(entryRowId)).toBeNull();
    expect(pairs).toHaveLength(1);
    expect(narrow).toEqual(d.widePaint());
  });

  it('add child: only the owning entry’s rows are rebuilt, and the new child resolves', () => {
    const d = open('test://struct-add-child.sldd');
    const before = d.widePaint();
    const entry = d.entryNamed('Struct');
    const entryRowId = entry.id;

    // Through mutateEntry, because addChild mutates the tree before it splices the text: an
    // id is a PATH, so the new child is in no index until the subtree is re-indexed.
    const result = mutateEntry(entry, () => addChild(d.doc.text, entry));
    d.write(result.patch);

    const narrow = d.paintOps(before, [{ kind: 'replace', entryRowId, entry }]);
    expect(result.selectId, 'the new child is the row to select').toBeTruthy();
    expect(narrow.some((r: any) => r.ID === result.selectId), 'its row is on screen').toBe(true);
    expect(DataModel.findNodeById(result.selectId!), 'and it resolves for the next edit').toBeTruthy();
    // Every row outside the entry is untouched — the point of the whole path.
    const others = (rows: any[]) => rows.filter((r) => !String(r.ID).startsWith(entryRowId));
    expect(others(narrow)).toEqual(others(before));
    expect(narrow).toEqual(d.widePaint());
  });

  it('delete child: the owning entry’s rows, one row shorter', () => {
    const d = open('test://struct-del-child.sldd');
    const before = d.widePaint();
    const entry = d.entryNamed('Struct');
    const entryRowId = entry.id;
    const child = entry.children[0];
    expect(child, 'the fixture’s Struct has a field to delete').toBeTruthy();
    const childId = child.id;

    const result = mutateEntry(entry, () => deleteChild(d.doc.text, child));
    d.write(result.patch);

    const narrow = d.paintOps(before, [{ kind: 'replace', entryRowId, entry }]);
    expect(narrow.some((r: any) => r.ID === childId), 'the deleted field’s row is gone').toBe(false);
    expect(DataModel.findNodeById(childId), 'and its id no longer resolves').toBeNull();
    expect(narrow).toEqual(d.widePaint());
  });

  it('paste: the new entry’s rows are inserted where a re-parse would put them', () => {
    const d = open('test://struct-paste.sldd');
    const before = d.widePaint();
    const section = d.model().children[0];
    const payload = d.entryNamed('Number').serialize();

    // The paste attaches its new node to the section itself (prepareEntryForPaste does, so
    // the uniqueness check can see the namespace), APPENDING — so what it added is the tail
    // after this count.
    const addedFrom = section.children.length;
    const pasted = pasteEntry(d.doc.text, section, payload);
    const { pairs, applied } = opsOfPastedEntries(section, addedFrom);
    d.write(pasted.patch);

    expect(applied).toHaveLength(1);
    expect(pairs).toHaveLength(1);
    const fresh = (applied[0] as any).entry;
    expect(fresh.name, 'the copy is renamed within the namespace').toBe('Number1');
    expect(DataModel.findNodeById(fresh.id), 'the pasted entry is indexed').toBe(fresh);

    const narrow = d.paintOps(before, applied);
    expect(narrow.length).toBe(before.length + 1);
    expect(narrow).toEqual(d.widePaint());
  });

  it('a same-document move: the source’s rows leave, the copy’s arrive under its own name', () => {
    const d = open('test://struct-move.sldd');
    const before = d.widePaint();
    const section = d.model().children[0];
    const source = d.entryNamed('PI');
    const payload = source.serialize();
    const selector = entrySelectorOf(payload);

    // The source goes first, from the text AND from the model — the paste's uniqueness check
    // reads the model's namespace, and a source still standing there would push the copy to
    // "PI1".
    const trimmed = deleteEntriesByName(d.doc.text, [selector]);
    const pairs: EntryOpPair[] = [{ redo: removeOp(source.id), undo: insertOp(source) }];
    const applied = applyEntryOps(d.model(), [removeOp(source.id)]);
    const addedFrom = section.children.length;
    const pasted = pasteEntry(trimmed, section, payload);
    const added = opsOfPastedEntries(section, addedFrom);
    pairs.push(...added.pairs);
    applied.push(...added.applied);
    d.doc.text = pasted.newText;

    expect((added.applied[0] as any).entry.name, 'the copy keeps the moved name').toBe('PI');
    const narrow = d.paintOps(before, applied);
    expect(narrow.length).toBe(before.length);
    expect(narrow).toEqual(d.widePaint());
  });
});

// ---------------------------------------------------------------------------------------
// Undo and redo of a structural edit.
//
// A cell edit's undo can be planned from the bytes it writes back — they are one element,
// and re-parsing that element says everything about the entry it names (planKnownChange).
// A delete's undo writes back an element AND a comma, and a paste's undo writes back nothing
// at all, so there is no element to read: what an undo of one of these means is not in its
// text. It is in what the host already knew when it made the edit, so it keeps the ops with
// the pair it remembers and recognises which direction came back.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd structural edit — undo and redo, from the ops the host kept', () => {
  it('undo of a delete puts the entry back where it was — narrow === wide', () => {
    const d = open('test://struct-undo-delete.sldd');
    const before = d.widePaint();
    const entry = d.entryNamed('Number');
    const entryRowId = entry.id;

    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = [{ redo: removeOp(entryRowId), undo: insertOp(entry) }];
    const result = deleteEntry(textBefore, entry);
    const deleted = d.paintOps(before, applyEntryOps(d.model(), [removeOp(entryRowId)]));
    d.write(result.patch);
    const known = rememberOf(textBefore, result.patch!, pairs);

    // Cmd+Z: VS Code writes the bytes back at the same offset, and says only that.
    const change = undoOf(known);
    d.doc.text = applyTextPatch(d.doc.text, { offset: change.rangeOffset, length: change.rangeLength, text: change.text });
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises its own delete coming back').not.toBeNull();

    const narrow = d.paintOps(deleted, applyEntryOps(d.model(), ops!));
    expect(narrow, 'the table is what it was before the delete').toEqual(before);
    expect(DataModel.findNodeById(entryRowId), 'and the restored id resolves again').toBeTruthy();
    expect(narrow).toEqual(d.widePaint());
  });

  it('redo of a delete takes the entry away again — narrow === wide', () => {
    const d = open('test://struct-redo-delete.sldd');
    const before = d.widePaint();
    const entry = d.entryNamed('Number');
    const entryRowId = entry.id;

    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = [{ redo: removeOp(entryRowId), undo: insertOp(entry) }];
    const result = deleteEntry(textBefore, entry);
    const deleted = d.paintOps(before, applyEntryOps(d.model(), [removeOp(entryRowId)]));
    d.write(result.patch);
    const known = rememberOf(textBefore, result.patch!, pairs);

    // Undone...
    const undo = undoOf(known);
    d.doc.text = applyTextPatch(d.doc.text, { offset: undo.rangeOffset, length: undo.rangeLength, text: undo.text });
    const restored = d.paintOps(deleted, applyEntryOps(d.model(), planKnownOps([undo], [known])!));
    // ...and redone.
    const redo = redoOf(known);
    d.doc.text = applyTextPatch(d.doc.text, { offset: redo.rangeOffset, length: redo.rangeLength, text: redo.text });
    const ops = planKnownOps([redo], [known]);
    expect(ops, 'the redo is the same edit forwards').not.toBeNull();

    const narrow = d.paintOps(restored, applyEntryOps(d.model(), ops!));
    expect(narrow).toEqual(deleted);
    expect(narrow).toEqual(d.widePaint());
  });

  it('undo of a paste takes the pasted entry away — narrow === wide', () => {
    const d = open('test://struct-undo-paste.sldd');
    const before = d.widePaint();
    const section = d.model().children[0];
    const payload = d.entryNamed('Number').serialize();

    const textBefore = d.doc.text;
    const addedFrom = section.children.length;
    const pasted = pasteEntry(textBefore, section, payload);
    const { pairs, applied } = opsOfPastedEntries(section, addedFrom);
    d.write(pasted.patch);
    const afterPaste = d.paintOps(before, applied);
    const known = rememberOf(textBefore, pasted.patch!, pairs);

    const change = undoOf(known);
    d.doc.text = applyTextPatch(d.doc.text, { offset: change.rangeOffset, length: change.rangeLength, text: change.text });
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises its own paste coming back').not.toBeNull();

    const narrow = d.paintOps(afterPaste, applyEntryOps(d.model(), ops!));
    expect(narrow).toEqual(before);
    expect(narrow).toEqual(d.widePaint());
  });

  it('undo of a MOVE undoes its two halves in reverse — narrow === wide', () => {
    // The order is the whole reason patchOfPairs reverses: the copy has to go before the
    // source comes back, or two entries answer to one name, hence to one id.
    const d = open('test://struct-undo-move.sldd');
    const before = d.widePaint();
    const section = d.model().children[0];
    const source = d.entryNamed('PI');
    const payload = source.serialize();

    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = [{ redo: removeOp(source.id), undo: insertOp(source) }];
    const applied = applyEntryOps(d.model(), [removeOp(source.id)]);
    const addedFrom = section.children.length;
    const pasted = pasteEntry(deleteEntriesByName(textBefore, [entrySelectorOf(payload)]), section, payload);
    const added = opsOfPastedEntries(section, addedFrom);
    pairs.push(...added.pairs);
    applied.push(...added.applied);
    d.doc.text = pasted.newText;
    const moved = d.paintOps(before, applied);

    // A move folds two transforms through one text and so cannot name its region; the host
    // works one out (minimalReplacement) and remembers THAT, because that is the change VS
    // Code will hand back.
    const known = rememberOf(textBefore, minimalReplacement(textBefore, d.doc.text), pairs);
    const change = undoOf(known);
    d.doc.text = applyTextPatch(d.doc.text, { offset: change.rangeOffset, length: change.rangeLength, text: change.text });
    expect(d.doc.text, 'the undo restores the text exactly').toBe(textBefore);
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises the move coming back').not.toBeNull();

    const narrow = d.paintOps(moved, applyEntryOps(d.model(), ops!));
    expect(narrow).toEqual(before);
    expect(narrow).toEqual(d.widePaint());
  });

  it('refuses a change that is neither direction of a remembered edit', () => {
    const known: KnownEdit = {
      submitted: { rangeOffset: 100, rangeLength: 0, text: 'inserted' },
      replaced: '',
      patch: { undo: [removeOp('a')], redo: [] },
    };
    // Right shape, wrong offset: the bytes in hand describe some other part of the file.
    expect(planKnownOps([{ rangeOffset: 101, rangeLength: 8, text: '' }], [known])).toBeNull();
    // A batch, whose later offsets are stated against the text before it.
    expect(
      planKnownOps(
        [
          { rangeOffset: 100, rangeLength: 0, text: 'inserted' },
          { rangeOffset: 400, rangeLength: 1, text: 'x' },
        ],
        [known],
      ),
    ).toBeNull();
    // An edit remembered WITHOUT ops says nothing this path can apply — its undo is planned
    // from its own bytes instead (planKnownChange).
    const noOps: KnownEdit = { submitted: known.submitted, replaced: known.replaced };
    expect(planKnownOps([{ rangeOffset: 100, rangeLength: 8, text: '' }], [noOps])).toBeNull();
  });

  it('recognises the older of two remembered edits, and answers with ITS ops', () => {
    const first: KnownEdit = {
      submitted: { rangeOffset: 10, rangeLength: 0, text: 'AAAA' },
      replaced: '',
      patch: { undo: [removeOp('first')], redo: [] },
    };
    const second: KnownEdit = {
      submitted: { rangeOffset: 90, rangeLength: 0, text: 'BBBB' },
      replaced: '',
      patch: { undo: [removeOp('second')], redo: [] },
    };
    const ops = planKnownOps([{ rangeOffset: 10, rangeLength: 4, text: '' }], [first, second]);
    expect(ops).toEqual([removeOp('first')]);
  });
});

// ---------------------------------------------------------------------------------------
// The one lookup a same-document move needs, shared with the binary provider so the two
// formats cannot disagree about which entry the clipboard means.
// ---------------------------------------------------------------------------------------
describe('findEntryBySelector', () => {
  const model = (...names: Array<[string, string]>) => ({
    children: [{ children: names.map(([name, uuid]) => ({ name, metadata: { uuid } })) }],
  });

  it('names the one entry that answers to a name', () => {
    const m = model(['A', '1'], ['B', '2']);
    expect(findEntryBySelector(m, 'B')).toBe(m.children[0].children[1]);
    expect(findEntryBySelector(m, { name: 'A', uuid: '1' })).toBe(m.children[0].children[0]);
  });

  it('consults the uuid only when the name is ambiguous', () => {
    const m = model(['A', '1'], ['A', '2']);
    expect(findEntryBySelector(m, { name: 'A', uuid: '2' })).toBe(m.children[0].children[1]);
    // Ambiguous and nothing to tell them apart: no answer, so the caller repaints wide
    // rather than moving the entry the user did not touch.
    expect(findEntryBySelector(m, 'A')).toBeNull();
  });

  it('answers nothing for a name the model does not hold', () => {
    expect(findEntryBySelector(model(['A', '1']), 'Z')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// The lookup the clipboard mark needs — also shared with the binary provider, and NOT the
// same rule as the selector one above: a mark is captured with the section it was taken in,
// so it can say which "A" it means without a uuid.
// ---------------------------------------------------------------------------------------
describe('findEntryByName', () => {
  const model = {
    children: [
      { name: 'design', children: [{ name: 'A' }, { name: 'B' }] },
      { name: 'coder', children: [{ name: 'A' }] },
    ],
  };

  it('scopes the name to its own section, because entry names are unique per section only', () => {
    expect(findEntryByName(model, 'design', 'A')).toBe(model.children[0].children[0]);
    expect(findEntryByName(model, 'coder', 'A')).toBe(model.children[1].children[0]);
    expect(findEntryByName(model, 'design', 'B')).toBe(model.children[0].children[1]);
  });

  it('answers nothing for a name, or a section, the model does not hold', () => {
    // Which is what lets a cut+paste skip un-dimming a source row that the paste removed.
    expect(findEntryByName(model, 'design', 'Z')).toBeNull();
    expect(findEntryByName(model, 'nope', 'A')).toBeNull();
    expect(findEntryByName(undefined, 'design', 'A')).toBeNull();
  });
});
