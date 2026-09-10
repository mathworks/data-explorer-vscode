// Copyright 2026 The MathWorks, Inc.
//
// The entry-scoped repaint for a JSON .sldd: a change typed into the plain-text view
// repaints ONE entry's rows, instead of re-parsing the whole document and rebuilding every
// row on every keystroke. On a 46 MB dictionary (64,700 entries, 317,000 rows) the wide
// path costs ~1.3 s of host work and a ~120 MB postMessage per keystroke; locating the
// changed entry by scanning costs ~82 ms and rebuilding it 0.3 ms.
//
// SlddTextEditorProvider imports `vscode` and cannot run under vitest, so — like
// binaryEntryScopedEdit.test.ts beside it — this reproduces the provider's composition from
// the real modules:
//   jsonEntryScan   (locateChangedEntry)   — the parse the repaint no longer does
//   jsonEntrySync   (planEntrySync)        — the change, read back as one entry op
//   entryOps        (applyEntryOps)        — the model change
//   SlddModel       (getModel, peekModel)  — the tree that is already built
//   slddBaseline    (isEntryModified vs computeModified)
//   rowBuilder      (buildEntryRows vs buildRows)
//   rowUpdates      (spliceEntryRows — the webview's half)
//
// Three invariants, and they are the whole point:
//
//  1. NARROW === WIDE. Splicing the entry's freshly built rows over the run on screen must
//     produce, row for row, what re-parsing the document and rebuilding every row would
//     have produced — including the "Modified" mark, which the two paths compute by
//     different means.
//
//  2. THE SCAN AGREES WITH THE PARSER. The span it finds for an entry must be the span
//     jsonc-parser's tree finds, for every entry of a real dictionary — strings holding
//     braces and brackets included.
//
//  3. IT REFUSES EVERYTHING ELSE. A structural change, a change to the file's header, a
//     namespace change, a half-typed value: all must come back as "no plan", because the
//     caller answers that with the full repaint the user has always had.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { findEntriesArrayStart, scanEntries, locateChangedEntry } from '../src/host/jsonEntryScan.js';
import {
  planEntrySync,
  planKnownChange,
  type KnownEdit,
  type RangeReplacement,
} from '../src/host/jsonEntrySync.js';
import { applyEntryOps } from '../src/host/entryOps.js';
import { getModel, invalidate, peekModel } from '../src/host/SlddModel.js';
import { findEntrySpan } from '../src/host/entrySplice.js';
import { captureBaseline, computeModified, isEntryModified, clearBaseline } from '../src/host/slddBaseline.js';
import { buildRows, buildEntryRows } from '../src/host/rowBuilder.js';
import { spliceEntryRows } from '../src/webview/rowUpdates.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = 'numeric_json.sldd';
const text = readFileSync(fileURLToPath(new URL(`./fixtures/${FIXTURE}`, import.meta.url)), 'utf8');

/** The offset of `needle`'s single occurrence in `source`, or a failure. */
function only(source: string, needle: string): number {
  const at = source.indexOf(needle);
  expect(at, `"${needle}" appears in the fixture`).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(needle, at + 1), `"${needle}" appears only once`).toBe(-1);
  return at;
}

// One open document, with the provider's two repaint paths side by side.
//
// The change is stated the way VS Code states it — the offset of the replaced range in the
// text BEFORE the change, and the text that replaced it — because that is all the provider
// is given and all planEntrySync is allowed to use.
function openDoc(uri: string) {
  clearBaseline(uri);
  DataModel.removeDataSource(uri);
  invalidate(uri);
  const doc = { text };

  // getModel(): parse the live text and register it. What post() does, and what a
  // keystroke is no longer allowed to do.
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
  // postEntryRows(): the narrow repaint — this entry's subtree, from the live model.
  const narrowPaint = (entry: any) => {
    const modified = new Set<string>();
    if (isEntryModified(uri, entry)) modified.add(entry.name);
    return buildEntryRows(entry, entry.parent.name, modified);
  };

  /**
   * Type into the text view: splice `replacement` over [offset, offset+length) and hand the
   * change to the provider's narrow path.
   *
   * Returns what the provider would do — the applied op, or null for "repaint wide".
   */
  const type = (offset: number, length: number, replacement: string) => {
    doc.text = doc.text.slice(0, offset) + replacement + doc.text.slice(offset + length);
    const model = peekModel(uri);
    expect(model, 'the document has a registered tree to update').not.toBeNull();
    const plan = planEntrySync(model, doc.text, { rangeOffset: offset, text: replacement });
    if (!plan) return null;
    const rowIdOnScreen = plan.entry.id;
    const applied = applyEntryOps(model, [{ kind: 'replace', rowId: plan.entry.id, record: plan.record }]);
    expect(applied).toHaveLength(1);
    expect(applied[0].kind).toBe('replace');
    return { rowIdOnScreen, entry: (applied[0] as any).entry };
  };

  /**
   * A change the host RECOGNISES: splice it into the document and plan it from the change's
   * own text, against the edits the host remembers writing.
   *
   * The document is spliced first because that is the order reality has — the text has
   * already changed when the event arrives — but note what is NOT passed on: `doc.text`. That
   * is the whole difference between this path and `type` above, and it is stated by the
   * signature rather than by a timing assertion.
   */
  const known = (change: RangeReplacement, ring: readonly KnownEdit[]) => {
    doc.text =
      doc.text.slice(0, change.rangeOffset) +
      change.text +
      doc.text.slice(change.rangeOffset + change.rangeLength);
    const model = peekModel(uri);
    expect(model, 'the document has a registered tree to update').not.toBeNull();
    const plan = planKnownChange(model, [change], ring);
    if (!plan) return null;
    const rowIdOnScreen = plan.entry.id;
    const applied = applyEntryOps(model, [{ kind: 'replace', rowId: plan.entry.id, record: plan.record }]);
    expect(applied).toHaveLength(1);
    expect(applied[0].kind).toBe('replace');
    return { rowIdOnScreen, entry: (applied[0] as any).entry };
  };

  /**
   * What the host wrote over one entry, and what it wrote over — the pair it remembers so it
   * can recognise the same edit coming back as an undo or a redo.
   *
   * Applies the edit for real (text and model) so the state afterwards is the state an undo
   * would arrive into.
   */
  const hostWrote = (entryName: string, rewrite: (element: string) => string): KnownEdit => {
    const span = findEntrySpan(doc.text, entryName);
    expect(span, `${entryName} has a span in the text`).not.toBeNull();
    const replaced = doc.text.slice(span!.offset, span!.offset + span!.length);
    const written = rewrite(replaced);
    expect(written, 'the edit changed something').not.toBe(replaced);
    const op = type(span!.offset, span!.length, written);
    expect(op, `the ${entryName} edit applied`).not.toBeNull();
    return {
      submitted: { rangeOffset: span!.offset, rangeLength: span!.length, text: written },
      replaced,
    };
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

  return { doc, build, widePaint, narrowPaint, type, known, hostWrote, entryNamed, dispose };
}

const openDocs: Array<() => void> = [];
function open(uri: string) {
  const d = openDoc(uri);
  openDocs.push(d.dispose);
  return d;
}
afterAll(() => openDocs.forEach((d) => d()));

// ---------------------------------------------------------------------------------------
// The scanner: two facts about the text, and nothing else.
// ---------------------------------------------------------------------------------------
describe('jsonEntryScan — finding one entry without parsing', () => {
  const arrayStart = findEntriesArrayStart(text);

  it('anchors on the entries array through the part path', () => {
    expect(arrayStart).toBeGreaterThan(0);
    expect(text[arrayStart]).toBe('[');
    // The `[` it found is the one the parse tree walks to.
    expect(arrayStart).toBe(only(text, '"entries": ['.slice(0, -1)) + '"entries": '.length);
  });

  it('refuses text that does not spell the path', () => {
    expect(findEntriesArrayStart('{}')).toBe(-1);
    // Right keys, wrong shape: a value that merely mentions them is not the path.
    expect(findEntriesArrayStart('{"__MW_TEXT_PARTS__": "__MW_TEXT_PART__/data/chunk0"}')).toBe(-1);
    // The last step must actually open an array.
    expect(
      findEntriesArrayStart(
        '{"__MW_TEXT_PARTS__": {"__MW_TEXT_PART__/data/chunk0": {"__MW_TEXT_content": {"entries": {}}}}}',
      ),
    ).toBe(-1);
  });

  // INVARIANT 2. The cheap locator and the parse tree must agree about every entry, or the
  // narrow repaint would rebuild an entry from another entry's text.
  it('finds the same span as the parse tree, for every entry in the fixture', () => {
    const names = [...text.matchAll(/^ {12}"name": "([^"]+)"/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) {
      const span = findEntrySpan(text, name)!;
      expect(span, `parse tree finds "${name}"`).not.toBeNull();
      // A point one character inside the element — the narrowest change there is.
      const scan = scanEntries(text, arrayStart, { start: span.offset + 1, end: span.offset + 1 });
      expect(scan, `the scan walks the array for "${name}"`).not.toBeNull();
      expect(scan!.hit, `the scan lands in "${name}"`).not.toBeNull();
      expect({ offset: scan!.hit!.offset, length: scan!.hit!.length }).toEqual(span);
      // And it always counts every element, wherever the hit fell.
      expect(scan!.count).toBe(names.length);
    }
  });

  it('counts the elements a value’s braces and brackets sit inside', () => {
    // The fixture holds "Matrix(3,1)\n[1]\n[2]\n[3]" as a string VALUE, which is why the
    // scan skips strings; a value may also hold an UNBALANCED brace, or a quote of its own,
    // and one of those read as structure would close an element early and miscount.
    expect(text).toContain('[1]\\n[2]');
    const scan = scanEntries(text, arrayStart, { start: 0, end: 0 })!;
    expect(scan.hit).toBeNull();
    expect(scan.count).toBe([...text.matchAll(/^ {12}"name": "/gm)].length);

    const tricky =
      '{"__MW_TEXT_PARTS__":{"__MW_TEXT_PART__/data/chunk0":{"__MW_TEXT_content":{"entries":[' +
      '{"name":"A","value":"} ] not structure"},' +
      '{"name":"B","value":"a quote \\" then }"},' +
      '{"name":"C","value":"[[["},' +
      // A value ENDING in an escaped backslash: the quote after it closes the string, and a
      // scanner that read the backslash as escaping that quote would swallow the rest of
      // the file and count one element too few.
      '{"name":"D","value":"ends with \\\\"}' +
      ']}}}}';
    expect(JSON.parse(tricky), 'the tricky document is valid JSON').toBeTruthy();
    const start = findEntriesArrayStart(tricky);
    expect(start).toBeGreaterThan(0);
    expect(scanEntries(tricky, start, { start: 0, end: 0 })!.count).toBe(4);
  });

  it('refuses a change that only touches an element’s edge', () => {
    // The comma between two elements, deleted: the caret that is left sits exactly at one
    // element's `}` and exactly at the next one's `{`, but the change was in NEITHER —
    // it was in the separator, and the document has quietly stopped being valid JSON.
    const first = findEntrySpan(text, 'Array')!;
    const edge = first.offset + first.length;
    expect(scanEntries(text, arrayStart, { start: edge, end: edge })!.hit).toBeNull();
    expect(scanEntries(text, arrayStart, { start: first.offset, end: first.offset })!.hit).toBeNull();
    // But the whole element, replaced — which is how a table cell edit arrives — IS in it.
    expect(scanEntries(text, arrayStart, { start: first.offset, end: edge })!.hit).toEqual({
      offset: first.offset,
      length: first.length,
      index: 0,
      // The element's own name, which is what the splice finders resolve a selector
      // against now that they read this same index (see entrySpliceScan.test.ts).
      name: 'Array',
    });
  });

  it('refuses text it cannot walk to the end of the array', () => {
    const truncated = text.slice(0, text.length / 2);
    expect(locateChangedEntry(truncated, { start: 400, end: 400 })).toBeNull();
    // An unterminated string is the ordinary mid-edit state, and it is not walkable.
    const broken = text.replace('"name": "Number"', '"name": "Number');
    expect(locateChangedEntry(broken, { start: 400, end: 400 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// The sync: one text change, one entry op, one repaint.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd narrow text sync — narrow === wide', () => {
  it('repaints one entry for a value typed in the text view', () => {
    const d = open('test://json-sync-value.sldd');
    const before = d.widePaint();
    const at = only(d.doc.text, '"value": 1\n');

    const op = d.type(at + '"value": '.length, 1, '42');
    expect(op, 'a value typed inside one entry is one entry op').not.toBeNull();
    expect(op!.rowIdOnScreen).toBe(op!.entry.id);

    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow, 'the entry the op names is on screen').not.toBeNull();
    // The edited cell really changed, and the entry is now marked Modified — the two
    // things the user is watching for.
    const row = narrow!.find((r: any) => r.ID === op!.entry.id)!;
    expect(row.Value).toBe('42');
    expect(row.Status).toBe('Modified');
    // Compare LAST: widePaint re-parses and RE-REGISTERS, which replaces the tree the op
    // above was applied to.
    expect(narrow).toEqual(d.widePaint());
  });

  it('repaints one entry for a nested field typed in the text view', () => {
    // A change inside an entry's children is still a change to the ENTRY: the record is
    // the whole element, so nothing here has to know how a struct is built inside.
    const d = open('test://json-sync-nested.sldd');
    const before = d.widePaint();
    const struct = only(d.doc.text, '"name": "NestedStruct"');
    const at = d.doc.text.indexOf('"field2": 4', struct);
    expect(at).toBeGreaterThan(struct);

    const op = d.type(at + '"field2": '.length, 1, '7');
    expect(op).not.toBeNull();
    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow).not.toBeNull();
    expect(narrow).toEqual(d.widePaint());
  });

  it('addresses the PRE-rename row id when a name is typed over', () => {
    const d = open('test://json-sync-rename.sldd');
    const before = d.widePaint();
    const at = only(d.doc.text, '"name": "Number"');

    const op = d.type(at + '"name": "'.length, 'Number'.length, 'Numeral');
    expect(op, 'a rename resolves through the uuid the text still spells').not.toBeNull();
    // The rows on screen carry the OLD id; the rebuilt entry carries the new one.
    expect(op!.rowIdOnScreen).toContain('/Number');
    expect(op!.entry.id).toContain('/Numeral');

    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow, 'the run under the pre-rename id is the one to replace').not.toBeNull();
    expect(narrow!.some((r: any) => r.ID === op!.rowIdOnScreen)).toBe(false);
    expect(narrow!.some((r: any) => r.ID === op!.entry.id)).toBe(true);
    // INVARIANT 3 of the binary path, which holds here for the same reason: the ids the
    // repaint paints must still resolve, or the NEXT edit on that row cannot find it.
    expect(DataModel.findNodeById(op!.entry.id)).toBe(op!.entry);
    expect(DataModel.findNodeById(op!.rowIdOnScreen)).toBeNull();
    expect(narrow).toEqual(d.widePaint());
  });

  it('repaints the same rows for a whole-element replace — a table cell edit', () => {
    // What SlddTextEditorProvider.applyEdit produces: a range replace of the entry's whole
    // `{...}` span with its reserialization. The change touches both braces, so it is only
    // narrow if the scan accepts an exact-span change.
    const d = open('test://json-sync-element.sldd');
    const before = d.widePaint();
    const span = findEntrySpan(d.doc.text, 'PI')!;
    const element = d.doc.text.slice(span.offset, span.offset + span.length);

    const op = d.type(span.offset, span.length, element.replace('3.141592653589793', '3.14'));
    expect(op, 'replacing one element is one entry op').not.toBeNull();
    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow).not.toBeNull();
    expect(narrow!.find((r: any) => r.ID === op!.entry.id)!.Value).toBe('3.14');
    expect(narrow).toEqual(d.widePaint());
  });

  it('leaves every other entry’s rows untouched', () => {
    // The point of the whole path: 317,000 rows do not move because one of them changed.
    const d = open('test://json-sync-untouched.sldd');
    const before = d.widePaint();
    const at = only(d.doc.text, '"value": 1\n');
    const op = d.type(at + '"value": '.length, 1, '9')!;
    const narrow = spliceEntryRows(before, op.rowIdOnScreen, d.narrowPaint(op.entry))!;

    const others = (rows: any[]) => rows.filter((r) => !r.ID.startsWith(op.entry.id));
    expect(others(narrow)).toEqual(others(before));
    expect(narrow.length).toBe(before.length);
  });
});

// ---------------------------------------------------------------------------------------
// An undo or a redo of an edit the host itself wrote.
//
// It arrives as a stranger's change — VS Code says only "these bytes replaced those" — and
// the recovery path answers it by finding the entry again: `document.getText()` (35 ms on a
// 47.8 MB dictionary) plus a full structural walk of it (138 ms). But an undo of a range
// replacement is not a stranger: it writes back, at the same offset, exactly the bytes that
// edit wrote over. So the host remembers the pair — what it submitted, and what it replaced —
// and recognises either direction of it, byte for byte. Then the changed element is the text
// in hand, and nothing has to be looked for.
//
// What makes recognising it safe is the same thing that makes the echo path safe: the event
// must PROVE it is that edit at that offset. A miss costs the scan, which is what an undo
// used to cost always.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd narrow text sync — undo and redo of the host’s own edit', () => {
  /** The change VS Code reports when `written` is undone: the pair, the other way round. */
  const undoOf = (known: KnownEdit): RangeReplacement => ({
    rangeOffset: known.submitted.rangeOffset,
    rangeLength: known.submitted.text.length,
    text: known.replaced,
  });

  it('plans an undo from the bytes it wrote over — narrow === wide', () => {
    const d = open('test://json-known-undo.sldd');
    const before = d.widePaint();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));

    const op = d.known(undoOf(written), [written]);
    expect(op, 'an undo of a remembered edit is one entry op').not.toBeNull();
    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow, 'the entry the op names is on screen').not.toBeNull();
    // Back to the value the file opened with, and back to unmodified with it.
    const row = narrow!.find((r: any) => r.ID === op!.entry.id)!;
    expect(row.Value).toBe('3.141592653589793');
    expect(row.Status).not.toBe('Modified');
    // Compare LAST: widePaint re-parses and re-registers the tree.
    expect(narrow).toEqual(d.widePaint());
  });

  it('plans a redo — the same edit, forwards', () => {
    const d = open('test://json-known-redo.sldd');
    d.widePaint();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    // Undone, then done again: what the second Ctrl-Y reports is the original submission.
    expect(d.known(undoOf(written), [written])).not.toBeNull();
    const before = d.widePaint();

    const op = d.known(written.submitted, [written]);
    expect(op, 'a redo of a remembered edit is one entry op').not.toBeNull();
    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow!.find((r: any) => r.ID === op!.entry.id)!.Value).toBe('3.14');
    expect(narrow).toEqual(d.widePaint());
  });

  it('resolves an undone rename through the uuid, not the name', () => {
    // The one case where the name in hand is NOT the name the model holds: the model was
    // renamed by the edit being undone. The uuid is what survives it (see resolve).
    const d = open('test://json-known-rename.sldd');
    d.widePaint();
    const written = d.hostWrote('Number', (el) => el.replace('"name": "Number"', '"name": "Numeral"'));
    const before = d.widePaint();

    const op = d.known(undoOf(written), [written]);
    expect(op, 'the entry still answers to the uuid the undone text spells').not.toBeNull();
    expect(op!.rowIdOnScreen, 'the rows on screen carry the renamed id').toContain('/Numeral');
    expect(op!.entry.id, 'and the rebuilt entry carries the name that came back').toContain('/Number');
    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow).not.toBeNull();
    expect(narrow).toEqual(d.widePaint());
  });

  it('recognises an older edit in the ring — two edits, undone in reverse', () => {
    // VS Code undoes as far back as the user asks, so one remembered edit is not enough: the
    // second undo is of the FIRST edit, whose offset is only meaningful once the second has
    // been taken back.
    const d = open('test://json-known-ring.sldd');
    const first = d.hostWrote('Number', (el) => el.replace('"value": 1', '"value": 11'));
    const second = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const ring = [first, second];

    expect(d.known(undoOf(second), ring), 'the newest edit comes back first').not.toBeNull();
    const before = d.widePaint();
    const op = d.known(undoOf(first), ring);
    expect(op, 'and then the one before it').not.toBeNull();
    const narrow = spliceEntryRows(before, op!.rowIdOnScreen, d.narrowPaint(op!.entry));
    expect(narrow!.find((r: any) => r.ID === op!.entry.id)!.Value).toBe('1');
    expect(narrow).toEqual(d.widePaint());
  });

  it('refuses a change at an offset the remembered edit does not name', () => {
    // The guard that matters: an edit elsewhere shifts everything after it, so the same undo
    // now lands at a different offset — and an offset that is off by any amount means the
    // bytes in hand describe some other part of the file. Recognition is exact or it is not
    // recognition.
    const d = open('test://json-known-shifted.sldd');
    d.widePaint();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const shifted = { ...undoOf(written), rangeOffset: written.submitted.rangeOffset + 1 };
    expect(d.known(shifted, [written])).toBeNull();
  });

  it('refuses a change that is neither direction of a remembered edit', () => {
    const d = open('test://json-known-other.sldd');
    d.widePaint();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    // Same span, different text: someone typed over the entry the host last wrote.
    const typed: RangeReplacement = {
      rangeOffset: written.submitted.rangeOffset,
      rangeLength: written.submitted.text.length,
      text: written.submitted.text.replace('3.14', '2.72'),
    };
    expect(d.known(typed, [written])).toBeNull();
    expect(d.known(undoOf(written), []), 'and nothing is recognised against an empty ring').toBeNull();
  });

  it('refuses a batch, whose offsets are stated against the text before it', () => {
    const d = open('test://json-known-batch.sldd');
    d.widePaint();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const undo = undoOf(written);
    expect(planKnownChange(peekModel('test://json-known-batch.sldd'), [undo, undo], [written])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// Everything the narrow path refuses. Each of these is answered by the full repaint, which
// is what the user had before this path existed — so the cost of a "no" is latency.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd narrow text sync — what it refuses', () => {
  it('refuses a change outside every entry', () => {
    const d = open('test://json-refuse-header.sldd');
    d.widePaint();
    const at = only(d.doc.text, '"release": "R2026b"');
    expect(d.type(at + '"release": "'.length, 'R2026b'.length, 'R2027a')).toBeNull();
  });

  it('refuses a structural change to the entries array', () => {
    const d = open('test://json-refuse-structural.sldd');
    d.widePaint();
    // Delete a whole element plus its comma — the shape a delete/paste takes.
    const span = findEntrySpan(d.doc.text, 'Number')!;
    const next = findEntrySpan(d.doc.text, 'PI')!;
    expect(d.type(span.offset, next.offset - span.offset, '')).toBeNull();
  });

  it('refuses an element count that no longer matches the model', () => {
    // THE structural guard, exercised directly: one element is one entry, so a count that
    // disagrees with the model proves the array was restructured — whatever the change
    // looked like. Here the model is built from a text with one entry missing.
    const d = open('test://json-refuse-count.sldd');
    d.widePaint();
    const span = findEntrySpan(text, 'Number')!;
    const next = findEntrySpan(text, 'PI')!;
    const shorter = text.slice(0, span.offset) + text.slice(next.offset);
    invalidate('test://json-refuse-count.sldd');
    const model = getModel('test://json-refuse-count.sldd', FIXTURE, shorter);
    const at = only(text, '"value": 3.141592653589793');
    expect(
      planEntrySync(model, text, { rangeOffset: at + '"value": '.length, text: '3.14' }),
    ).toBeNull();
  });

  it('refuses a change that would move the entry to another section', () => {
    // isderived and namespace decide the section (SlddNode.getSectionKey), so changing
    // either is not a replacement in place.
    const d = open('test://json-refuse-section.sldd');
    d.widePaint();
    const number = only(d.doc.text, '"name": "Number"');
    const at = d.doc.text.indexOf('"isderived": "0"', number);
    expect(at).toBeGreaterThan(number);
    expect(d.type(at + '"isderived": "'.length, 1, '1')).toBeNull();
  });

  it('refuses a half-typed element', () => {
    const d = open('test://json-refuse-midedit.sldd');
    d.widePaint();
    const at = only(d.doc.text, '"value": 1\n');
    // The comma after the metadata object, deleted: the element no longer parses, though
    // the document still walks.
    const number = only(d.doc.text, '"name": "Number"');
    const closing = d.doc.text.indexOf('},', number);
    expect(closing).toBeGreaterThan(number);
    expect(d.type(closing + 1, 1, '')).toBeNull();
    expect(at).toBeGreaterThan(0);
  });

  it('refuses an entry it cannot tell apart from another', () => {
    // Two entries answering to one uuid is the case where guessing would repaint the row
    // the user did not touch. The scan and the count are both fine; identity is not.
    const d = open('test://json-refuse-ambiguous.sldd');
    d.widePaint();
    const number = only(d.doc.text, '"name": "Number"');
    const uuidAt = d.doc.text.indexOf('"uuid": "', number) + '"uuid": "'.length;
    const uuid = d.doc.text.slice(uuidAt, d.doc.text.indexOf('"', uuidAt));
    const pi = only(d.doc.text, '"name": "PI"');
    const piUuidAt = d.doc.text.indexOf('"uuid": "', pi) + '"uuid": "'.length;
    // Give PI the same uuid as Number, wide-repaint so the model holds both, then edit PI.
    d.doc.text =
      d.doc.text.slice(0, piUuidAt) + uuid + d.doc.text.slice(piUuidAt + uuid.length);
    d.widePaint();
    const at = only(d.doc.text, '"value": 3.141592653589793');
    expect(d.type(at + '"value": '.length, '3.141592653589793'.length, '3.14')).toBeNull();
  });
});
