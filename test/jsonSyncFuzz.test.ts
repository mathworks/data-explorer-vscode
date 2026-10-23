// Copyright 2026 The MathWorks, Inc.
//
// The JSON .sldd text view's narrow repaint, under keystrokes nobody chose.
//
// Each keystroke in the text view is handed to planEntrySync (jsonEntrySync.ts), which scans for
// the one element the change landed in (jsonEntryScan.ts), re-parses that element alone, and
// replaces that one entry in the model already built. Its promise is "every doubt is a no": a
// plan is made only when the change is narrow beyond argument, and anything else repaints wide.
// So what a plan produces must be exactly what the wide path would have built from the same
// text, and a plan must never be made for text the wide path cannot read at all.
//
// jsonEntryScopedSync.test.ts pins that for edits chosen to hit each rule. Here the edits are
// random — single insertions, deletions and replacements of structural characters (quotes,
// braces, brackets, commas, colons, backslashes) and of ordinary text, anywhere in the entries
// of a real dictionary — from fixed seeds, so a failure names a reproducible keystroke.
//
// KNOWN BUG, found by this file (data-explorer-core v1.45.4, SectionNode.parseEntry): a re-read
// of the file's own text (`{ asRead: true }`, which the narrow path's replace op asks for) still
// stamps a missing `lastmod` with the current time and a missing `modifiedby` with '', as a paste
// is stamped, though the file's read leaves both missing. So a keystroke that removes or renames
// an entry's "lastmod" key — or any keystroke in an entry of a text dictionary written without
// one, as two of the fixtures here are — repaints that entry's Last Modified as now, where a
// re-parse of the same text shows none. Pinned as an `it.fails` at the end. In the fuzz, only
// that row's `lastModified` / `lastModifiedBy`, and only for a keystroke whose record lacks the
// key, is set aside, so any other difference still fails. Remove both once core reads an asRead
// record's metadata as the file's read does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planEntrySync } from '../src/host/jsonEntrySync.js';
import { findEntriesArrayStart } from '../src/host/jsonEntryScan.js';
import { applyEntryOps } from '../src/host/entryOps.js';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const read = (p: string) => readFileSync(fileURLToPath(new URL(`./${p}`, import.meta.url)), 'utf8');

// A dictionary MATLAB wrote as text (40 entries of every kind), one with architectural data, one
// of numeric shapes, and two of objects that a fixture script wrote without lastmod or modifiedby.
const FIXTURES = [
  'parity/artifacts/text/params.sldd',
  'fixtures/arch.sldd',
  'fixtures/numeric_json.sldd',
  'fixtures/object_props_text.sldd',
  'fixtures/object_array_text.sldd',
];

// mulberry32: small, seedable, and the same sequence on every platform.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRUCTURAL = ['"', '{', '}', '[', ']', ',', ':', '\\', '\\"', '},{', '"name"', '"x":1,'];
const ORDINARY = ['a', 'Z', '7', '.', '-', ' ', '\n', 'e5', 'true', 'null'];

interface Keystroke {
  offset: number;
  length: number;
  text: string;
}

function keystroke(next: () => number, text: string, from: number): Keystroke {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const offset = from + Math.floor(next() * (text.length - from));
  const kind = next();
  if (kind < 0.25) return { offset, length: 1 + Math.floor(next() * 3), text: '' };
  const insert = next() < 0.5 ? pick(STRUCTURAL) : pick(ORDINARY);
  return { offset, length: kind < 0.5 ? 1 : 0, text: insert };
}

const plain = (rows: unknown) => JSON.parse(JSON.stringify(rows));

/** Set aside what the known bug changes in the row of the entry `record` rebuilt, and only that. */
function setAsideKnownBug(rows: any[], rowId: string, record: any): void {
  const md = record?.metadata;
  if (!md || typeof md !== 'object') return;
  for (const row of rows) {
    if (row.ID !== rowId) continue;
    if (md.lastmod == null) row.lastModified = '(set aside: known bug)';
    if (md.modifiedby == null) row.lastModifiedBy = '(set aside: known bug)';
  }
}

describe('a planned keystroke repaints exactly what a re-parse would', () => {
  for (const fixture of FIXTURES) {
    const base = read(fixture);
    // Several seeds, so one unlucky sequence cannot hide the rest.
    for (const seed of [1, 2, 3]) {
      it(`${fixture}, seed ${seed}: 150 keystrokes`, () => {
        const next = rng(seed);
        const uri = `test://json-sync-fuzz/${fixture}/${seed}`;
        // Edits land in the entries array, where every rule of the narrow path is asked; an edit
        // to the header above it is refused by the first of them.
        const from = findEntriesArrayStart(base);
        expect(from).toBeGreaterThan(0);
        let planned = 0;
        for (let n = 0; n < 150; n++) {
          const k = keystroke(next, base, from);
          const after = base.slice(0, k.offset) + k.text + base.slice(k.offset + k.length);
          const where = `keystroke ${n}: ${JSON.stringify(k)}`;

          invalidate(uri);
          const live = getModel(uri, fixture.split('/').pop()!, base);
          const plan = planEntrySync(live, after, { rangeOffset: k.offset, text: k.text });
          if (!plan) continue;
          planned++;

          // A plan is never made for text the wide path cannot read.
          expect(() => JSON.parse(after), where).not.toThrow();

          const [applied] = applyEntryOps(live, [
            { kind: 'replace', rowId: plan.entry.id, record: plan.record, fromDocumentText: true },
          ]) as any[];
          const narrow = plain(buildRows(live));
          invalidate(uri);
          const wide = plain(buildRows(getModel(uri, fixture.split('/').pop()!, after)));
          setAsideKnownBug(narrow, applied.entry.id, plan.record);
          setAsideKnownBug(wide, applied.entry.id, plan.record);
          expect(narrow, where).toEqual(wide);
        }
        invalidate(uri);
        // (control) The keystrokes do reach the narrow path, so the equality above is about
        // something: many of them land inside a string or a number of one entry.
        expect(planned).toBeGreaterThan(5);
      });
    }
  }
});

describe('KNOWN BUG: a re-read entry with no lastmod is stamped with the current time', () => {
  // See the header. Deleting the "lastmod" line of an entry in the text view is one keystroke
  // (a line delete) that the narrow path takes, and its repaint should be the re-parse's.
  it.fails('deleting an entry’s "lastmod" line repaints the Last Modified a re-parse shows', () => {
    const base = read('parity/artifacts/text/params.sldd');
    const uri = 'test://json-sync-lastmod.sldd';
    const line = /\n\t*"lastmod": "[^"]*",/.exec(base)!;
    const after = base.slice(0, line.index) + base.slice(line.index + line[0].length);
    invalidate(uri);
    const live = getModel(uri, 'params.sldd', base);
    const plan = planEntrySync(live, after, { rangeOffset: line.index, text: '' });
    expect(plan, 'the delete is planned narrow').not.toBeNull();
    const [applied] = applyEntryOps(live, [
      { kind: 'replace', rowId: plan!.entry.id, record: plan!.record, fromDocumentText: true },
    ]) as any[];
    const narrow = (buildRows(live) as any[]).find((r) => r.ID === applied.entry.id);
    invalidate(uri);
    const wide = (buildRows(getModel(uri, 'params.sldd', after)) as any[]).find((r) => r.ID === applied.entry.id);
    invalidate(uri);
    expect(wide.lastModified).toBe('');
    // Fails today: the narrow row shows the time of the keystroke.
    expect(narrow.lastModified).toBe(wide.lastModified);
  });
});
