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
// A bug this file found, now fixed in core (SectionNode.parseEntry): a re-read of the file's own
// text (`{ asRead: true }`, which the narrow path's replace op asks for) stamped a missing
// `lastmod` with the current time and a missing `modifiedby` with '', as a paste is stamped,
// though the file's read leaves both missing. So a keystroke that removed or renamed an entry's
// "lastmod" key — or any keystroke in an entry of a text dictionary written without one, as two
// of the fixtures here are — repainted that entry's Last Modified as now, where a re-parse of the
// same text showed none. The fuzz compares every row whole again, and the end of the file pins
// the one keystroke that showed it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planEntrySync } from '../src/host/jsonEntrySync.js';
import { findEntriesArrayStart } from '../src/host/jsonEntryScan.js';
import { applyEntryOps } from '../src/host/entryOps.js';
import { getModel, invalidate, buildRows } from 'data-explorer-view/model';

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

          applyEntryOps(live, [{ kind: 'replace', rowId: plan.entry.id, record: plan.record, fromDocumentText: true }]);
          const narrow = plain(buildRows(live));
          invalidate(uri);
          const wide = plain(buildRows(getModel(uri, fixture.split('/').pop()!, after)));
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

describe('a re-read entry with no lastmod shows none, as a re-parse of the same text does', () => {
  // See the header. Deleting the "lastmod" line of an entry in the text view is one keystroke
  // (a line delete) that the narrow path takes, and its repaint is the re-parse's.
  //
  // Every step it depends on is asserted as a step, so a fixture that stopped holding a
  // "lastmod" line, or a delete that stopped being planned narrow, fails as that and does not
  // pass for the wrong reason.
  function deleteLastmodLine() {
    const base = read('parity/artifacts/text/params.sldd');
    const uri = 'test://json-sync-lastmod.sldd';
    const line = /\n\t*"lastmod": "[^"]*",/.exec(base);
    expect(line, 'the fixture holds a "lastmod" line').not.toBeNull();
    const after = base.slice(0, line!.index) + base.slice(line!.index + line![0].length);
    invalidate(uri);
    const live = getModel(uri, 'params.sldd', base);
    const plan = planEntrySync(live, after, { rangeOffset: line!.index, text: '' });
    expect(plan, 'the delete is planned narrow').not.toBeNull();
    expect((plan!.record as any).metadata?.lastmod, 'the record it re-reads has no lastmod').toBeUndefined();
    const applied = applyEntryOps(live, [
      { kind: 'replace', rowId: plan!.entry.id, record: plan!.record, fromDocumentText: true },
    ]) as any[];
    expect(applied).toHaveLength(1);
    const rowId = applied[0].entry.id;
    const narrow = (buildRows(live) as any[]).find((r) => r.ID === rowId);
    invalidate(uri);
    const wide = (buildRows(getModel(uri, 'params.sldd', after)) as any[]).find((r) => r.ID === rowId);
    invalidate(uri);
    expect(narrow, 'the narrow repaint has the entry’s row').toBeDefined();
    expect(wide, 'the re-parse has the entry’s row').toBeDefined();
    return { narrow, wide };
  }

  it('(preconditions) the delete is planned narrow, and a re-parse shows no Last Modified', () => {
    const { wide } = deleteLastmodLine();
    expect(wide.lastModified).toBe('');
  });

  it('the narrow repaint shows no Last Modified either, not the time of the keystroke', () => {
    const { narrow, wide } = deleteLastmodLine();
    expect(narrow.lastModified).toBe('');
    expect(narrow.lastModifiedBy).toBe(wide.lastModifiedBy);
    expect(narrow).toEqual(wide);
  });
});
