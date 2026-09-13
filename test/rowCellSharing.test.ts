// Copyright 2026 The MathWorks, Inc.
//
// A table's cells are overwhelmingly repetition. Over a 128,111-row customer dictionary,
// 1.36M cells hold ~200k distinct values, so giving each distinct value ONE object takes
// the row set from 88 MB to 55 MB, and the copy the webview receives from 60 MB to 47 MB
// (structured clone preserves aliasing rather than re-expanding it). Both row builders
// therefore run their output through a core `RowCellPool`.
//
// Sharing is the kind of optimization that is invisible when it works and catastrophic
// when it is wrong — a wrongly shared cell puts one row's value on another row. Two things
// are asserted here, and they pull against each other:
//
//   The rows must be UNCHANGED in value, which is what `equal-by-value` below pins, and
//   what rowUpdates.test.ts already pins from the other side (it asserts the pooled
//   full-table build and the unpooled single-entry repaint agree row for row).
//
//   Cells really are shared, which is the part a value comparison cannot see. Hence the
//   identity assertions, stated over named rows of a real fixture so they cannot pass
//   vacuously.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel } from '../src/host/SlddModel.js';
import { buildRows, buildEntryRows } from '../src/host/rowBuilder.js';
import { buildMatRows } from '../src/host/matRowBuilder.js';

const URI = 'rowshare://numeric_json.sldd';

function dictionary() {
  const path = fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url));
  return getModel(URI, 'numeric_json.sldd', readFileSync(path, 'utf8'));
}

describe('row cell sharing', () => {
  it('gives every row named "a" the same Name cell', () => {
    // The fixture holds a struct, a struct array and a struct matrix, all with a field
    // `a` — nine rows in total, whose Name cells are identical in value and so collapse
    // to one object. Nine, not two, is why this matters at scale.
    const rows = buildRows(dictionary()) as any[];
    const named = rows.filter((r) => r.Name?.label === 'a');
    expect(named.length).toBe(9);
    for (const r of named) expect(r.Name).toBe(named[0].Name);
    // The value is still the right one, and the rows are still distinct rows.
    expect(named[0].Name).toEqual({ label: 'a', iconId: 'wsDefault', disabled: true, editable: true, element: false });
    expect(new Set(named.map((r) => r.ID)).size).toBe(9);
  });

  it('projects exactly the values an unpooled build projects', () => {
    // buildRows pools; buildEntryRows without a pool does not. Same rows either way — this
    // is the assertion that sharing is an allocation change and nothing else.
    const sldd = dictionary();
    const pooled = buildRows(sldd) as any[];
    const plain: any[] = [];
    for (const section of sldd.children as any[]) {
      for (const entry of section.children as any[]) plain.push(...buildEntryRows(entry, section.name));
    }
    // buildRows also emits a section header row per section, which buildEntryRows does not.
    expect(pooled.filter((r) => !String(r.ID).startsWith('section:'))).toEqual(plain);
    // Not vacuous: the pooled side really did share, the plain side really did not.
    const a = (rs: any[]) => rs.filter((r) => r.Name?.label === 'a');
    expect(a(pooled)[0].Name).toBe(a(pooled)[1].Name);
    expect(a(plain)[0].Name).not.toBe(a(plain)[1].Name);
    expect(a(plain)[0].Name).toEqual(a(plain)[1].Name);
  });

  it('freezes a shared cell, so an in-place edit fails loudly', () => {
    // Nothing in this repo mutates a row cell — the clipboard mark copies with
    // `{ ...row.Name }` rather than assigning into it — and freezing is what makes the day
    // that changes a thrown error at the mutation instead of one row silently painting its
    // label onto eight others.
    const row = (buildRows(dictionary()) as any[]).find((r) => r.Name?.label === 'a');
    expect(Object.isFrozen(row.Name)).toBe(true);
    expect(() => { row.Name.label = 'other'; }).toThrow(TypeError);
    // The row itself is not frozen: the host stamps its own columns over it.
    expect(Object.isFrozen(row)).toBe(false);
  });

  it('leaves the _matrix payload alone', () => {
    // A grid payload carries `dims: number[]`, which the pool cannot key, so it declines
    // the cell rather than guessing — an unshared cell costs memory, a wrongly shared one
    // is wrong. Asserted because a matrix is the one row extra big enough to tempt the
    // opposite call.
    const withMatrix = (buildRows(dictionary()) as any[]).filter((r) => r._matrix);
    expect(withMatrix.length).toBeGreaterThan(0);
    for (const r of withMatrix) expect(Object.isFrozen(r._matrix)).toBe(false);
    expect(new Set(withMatrix.map((r) => r._matrix)).size).toBe(withMatrix.length);
  });

  it('shares nothing across two separate builds', () => {
    // A pool is per pass, not a cache. One that outlived the call would keep every cell of
    // every dictionary ever opened alive for the life of the extension host.
    const first = (buildRows(dictionary()) as any[]).find((r) => r.Name?.label === 'a');
    const second = (buildRows(dictionary()) as any[]).find((r) => r.Name?.label === 'a');
    expect(second.Name).not.toBe(first.Name);
    expect(second.Name).toEqual(first.Name);
  });

  it('shares cells in a .mat table too', () => {
    // buildMatRows owns its pool rather than taking one: it has no partial-repaint caller.
    const field = (name: string, value: number) => ({
      name, className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value, fields: null,
    });
    const struct = (name: string) => ({
      name, className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null,
      fields: { gain: field('gain', 2) },
    });
    const uri = 'rowshare://two_structs.mat';
    DataModel.removeDataSource(uri);
    const node = DataModel.addMatSourceParsed(
      uri,
      { header: 'MATLAB 5.0', variables: [struct('one'), struct('two')] },
      { path: uri },
    );
    const gains = (buildMatRows(node) as any[]).filter((r) => r.Name?.label === 'gain');
    expect(gains.length).toBe(2);
    expect(gains[0].Name).toBe(gains[1].Name);
    expect(gains[0].ID).not.toBe(gains[1].ID);
  });
});
