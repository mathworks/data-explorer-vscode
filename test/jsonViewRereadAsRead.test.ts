// Copyright 2026 The MathWorks, Inc.
//
// An entry the JSON view re-reads from the document's own text is read as the file's read
// reads it (mathworks/data-explorer-core#140, F1-22).
//
// A text dictionary can hold a value no writer would take from anywhere else: dims holding the
// infinity that JSON.parse makes of a hand-typed 1e400. Opened from the file, core records it
// as the file's own, and a save writes it back as read. The JSON view rebuilt an edited entry
// from its element text through `section.parseEntry`, which recorded nothing, so the same text
// was accepted when the file was opened and refused once re-read: serialize() threw, the entry
// read as Modified, and the next table edit of it failed.
//
// core's `parseEntry(record, systemComposer, { asRead: true })` says the record is the file's
// own text. The ops built from the document's text say so (`fromDocumentText`), and only they:
// an undo or redo record and an insert are not the file's text, so a record of theirs that holds
// the infinity is still refused.
//
// The provider's own wiring is driven in VS Code, in test-integration/suite/jsonViewRereadAsRead.test.ts.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import {
  planEntrySync,
  planKnownChange,
  planOwnEdit,
  type HostEdit,
  type KnownEdit,
} from '../src/host/jsonEntrySync.js';
import { applyEntryOps, insertOp, replaceOp, type EntryOp } from '../src/host/entryOps.js';
import { getModel, invalidate } from 'data-explorer-view/model/workspace/SlddModel.js';
import { findEntrySpan } from '../src/host/entrySplice.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = 'numeric_json.sldd';
const NAME = 'hugeExtent';
// A 1x1 struct whose field f is a cell declaring an extent of 1e400 rows, beside a plain field.
const VALUE =
  '{"_array_type": "Struct", "_dimensions": [1, 1], "_elements": [{"f": {"_array_type": "Cell", "_dimensions": [1e400, 0], "_elements": []}, "g": 1}], "_fields": ["f", "g"]}';
const REFUSAL = `Cannot write "${NAME}": ${NAME}.f is a cell declaring dimensions [Infinity,0], a size that is not a count`;

/**
 * The fixture with the entry added as hand-typed text. Its metadata is the fixture's own, in
 * full (lastmod and modifiedby present), so a re-read stamps nothing and its metadata says what
 * the file read's says.
 */
function dictionaryText(): string {
  const json = JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${FIXTURE}`, import.meta.url)), 'utf8'),
  );
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  const metadata = { ...entries[0].metadata, uuid: '00000000-0000-4000-8000-00000000f122' };
  expect(Object.keys(metadata)).toEqual(['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived']);
  entries.push({ name: NAME, metadata, value: '@@VALUE@@' });
  return JSON.stringify(json, null, 2).replace('"@@VALUE@@"', VALUE);
}

const opened: string[] = [];
afterAll(() => {
  for (const uri of opened) {
    DataModel.removeDataSource(uri);
    invalidate(uri);
  }
});

/** The dictionary opened as the JSON provider opens it, and the element text of the entry. */
function open(uri: string) {
  opened.push(uri);
  invalidate(uri);
  const text = dictionaryText();
  const model = getModel(uri, FIXTURE, text);
  const entry = () =>
    (model.children as any[]).flatMap((s: any) => s.children).find((e: any) => e.name === NAME);
  const span = findEntrySpan(text, NAME);
  expect(span, 'the entry has a span in the text').not.toBeNull();
  const element = text.slice(span!.offset, span!.offset + span!.length);
  expect(element, 'the element text holds the hand-typed extent').toContain('1e400');
  return { model, text, entry, span: span!, element };
}

/** What serialize() makes of an entry, or the refusal it throws. */
function copyOf(entry: any): unknown {
  try {
    return entry.serialize();
  } catch (err: any) {
    return { thrown: err?.name, reason: err?.reason, message: String(err?.message) };
  }
}

describe('the plans built from the document text say so', () => {
  it('planOwnEdit: the echo of the host’s own edit is the document’s text', () => {
    const d = open('test://asread-own-edit.sldd');
    const live = d.entry();
    const hint: HostEdit = {
      entryId: live.id,
      submitted: { rangeOffset: d.span.offset, rangeLength: d.span.length, text: d.element },
      epoch: 0,
    };
    const plan = planOwnEdit([hint.submitted], hint);
    expect(plan).not.toBeNull();
    expect(plan!.op).toMatchObject({ kind: 'replace', rowId: live.id, fromDocumentText: true });
  });

  it('planEntrySync and planKnownChange: an element read out of the document is its text', () => {
    const d = open('test://asread-element.sldd');
    const at = d.text.indexOf('1e400');
    const edited = d.text.slice(0, at) + ' ' + d.text.slice(at);
    const scanned = planEntrySync(d.model, edited, { rangeOffset: at, text: ' ' });
    expect(scanned).not.toBeNull();
    expect(scanned!.entry).toBe(d.entry());
    expect(scanned!.fromDocumentText).toBe(true);

    const rewritten = d.element.replace('1e400', ' 1e400');
    const known: KnownEdit = {
      submitted: { rangeOffset: d.span.offset, rangeLength: d.span.length, text: rewritten },
      replaced: d.element,
    };
    // The undo of that edit: the bytes it wrote over come back over it.
    const undo = { rangeOffset: d.span.offset, rangeLength: rewritten.length, text: d.element };
    const recognised = planKnownChange(d.model, [undo], [known]);
    expect(recognised).not.toBeNull();
    expect(recognised!.fromDocumentText).toBe(true);
  });
});

describe('applyEntryOps: a replace from the document text re-reads as the file read', () => {
  it('rebuilds the entry so its copy is the file read’s, and a later edit of it serializes', () => {
    const d = open('test://asread-replace.sldd');
    const asOpened = copyOf(d.entry());
    // The file read accepts it, and writes the infinity back as JSON.stringify spells it.
    expect(asOpened).toMatchObject({ name: NAME });
    expect(JSON.stringify((asOpened as any).value)).toContain('"_dimensions":[null,0]');

    const op: EntryOp = {
      kind: 'replace',
      rowId: d.entry().id,
      record: JSON.parse(d.element),
      fromDocumentText: true,
    };
    const [applied] = applyEntryOps(d.model, [op]);
    const fresh = (applied as any).entry;
    expect(fresh).toBe(d.entry());
    expect(copyOf(fresh)).toEqual(asOpened);

    // A table edit after it: the field next to the extent.
    const g = (fresh.children as any[]).find((c: any) => c.name === 'g');
    expect(g?.setProperty('Value', '2')).toBe(true);
    const edited = copyOf(fresh) as any;
    expect(edited.thrown).toBeUndefined();
    expect(JSON.stringify(edited.value)).toContain('"g":2');
  });
});

describe('control: a record that is not the document text is still refused', () => {
  it('a replace that does not say so (an undo or redo record) and an insert (a paste’s redo) refuse it', () => {
    const refused = { thrown: 'MatBudgetError', reason: 'not-a-count' };

    const replaced = open('test://asread-control-replace.sldd');
    const [r] = applyEntryOps(replaced.model, [
      { kind: 'replace', rowId: replaced.entry().id, record: JSON.parse(replaced.element) },
    ]);
    const rCopy = copyOf((r as any).entry) as any;
    expect(rCopy).toMatchObject(refused);
    expect(rCopy.message).toContain(REFUSAL);

    const inserted = open('test://asread-control-insert.sldd');
    const live = inserted.entry();
    const section = live.parent;
    const record = JSON.parse(inserted.element);
    record.name = `${NAME}Pasted`;
    record.metadata = { ...record.metadata, uuid: '00000000-0000-4000-8000-00000000f123' };
    const [i] = applyEntryOps(inserted.model, [
      { kind: 'insert', sectionName: section.name, index: -1, record },
    ]);
    const iCopy = copyOf((i as any).entry) as any;
    expect(iCopy).toMatchObject(refused);
    expect(iCopy.message).toContain(`Cannot write "${NAME}Pasted": ${NAME}Pasted.f is a cell`);
  });

  it('the ops an undo stack keeps for a live entry do not say so', () => {
    const d = open('test://asread-control-snapshot.sldd');
    const live = d.entry();
    expect(replaceOp(live, live.id)).not.toHaveProperty('fromDocumentText');
    expect(insertOp(live)).not.toHaveProperty('fromDocumentText');
  });
});
