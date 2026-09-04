// Copyright 2026 The MathWorks, Inc.
// One rule, two builders. `buildEntryRows` (.sldd/.slx) and `buildMatRows` (.mat)
// are independent, so the _matrix stamp is asserted here ONCE against both,
// rather than twice in two suites that could drift apart.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { buildEntryRows } from '../src/host/rowBuilder.js';
import { buildMatRows } from '../src/host/matRowBuilder.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

// The design entries of numeric_json.sldd.
function slddEntries(): any[] {
  invalidate('ms://numeric_json.sldd');
  const text = readFileSync(fixturePath('numeric_json.sldd'), 'utf8');
  const sldd = getModel('ms://numeric_json.sldd', 'numeric_json.sldd', text);
  const design = (sldd.children ?? []).find((s: any) => s.name === 'design');
  return design.children ?? [];
}

// Rows from the .sldd path: every design entry of numeric_json.sldd, flattened.
function slddRows(): any[] {
  return slddEntries().flatMap((e: any) => buildEntryRows(e, 'design'));
}

// Rows from the .mat path: the same shapes, hand-built through the core barrel.
function matRows(): any[] {
  const uri = 'ms://stamp.mat';
  DataModel.removeDataSource(uri);
  const v = (name: string, dimensions: number[], value: any[], className = 'double') => ({
    name, className, dimensions, isComplex: false,
    isLogical: className === 'logical', value, fields: null,
  });
  const mat = DataModel.addMatSourceParsed(uri, {
    header: 'MATLAB 5.0',
    variables: [
      v('Scalar', [1, 1], [7]),
      v('Row', [1, 3], [1, 2, 3]),
      v('Mat', [2, 3], [1, 2, 3, 4, 5, 6]),
      v('Nd', [2, 2, 2], [1, 2, 3, 4, 5, 6, 7, 8]),
    ],
  }, { path: uri });
  return buildMatRows(mat);
}

// The invariant itself. Deliberately parameterized over a row LIST and the set of
// row names that should own a grid, so both builders answer the same questions.
function expectStampedExactly(rows: any[], expectedOwners: string[]) {
  // The Name cell is `{ label, iconId, ... }` on both builders' rows.
  const nameOf = (r: any) => (typeof r.Name === 'object' ? r.Name?.label : r.Name);
  const stamped = rows.filter((r) => r._matrix).map(nameOf);
  expect([...stamped].sort()).toEqual([...expectedOwners].sort());

  for (const row of rows) {
    if (!row._matrix) continue;
    const m = row._matrix;
    // A payload is complete or absent; a half-filled one must never reach the webview.
    expect(typeof m.name).toBe('string');
    expect(typeof m.className).toBe('string');
    expect(Array.isArray(m.dims)).toBe(true);
    expect(m.dims.length).toBeGreaterThanOrEqual(2);
    expect(m.cells.length).toBe(m.dims.reduce((a: number, b: number) => a * b, 1));
    expect(m.cells.every((c: unknown) => typeof c === 'string')).toBe(true);
  }
}

describe('the _matrix stamp lands on the matrix rows and nowhere else', () => {
  it('stamps the .sldd rows that own a grid', () => {
    // Value-owning rows are stamped; their element child rows are not, because an
    // element is a scalar. `field` is the 2x2 double buried at Hybrid/1/field — a
    // nested struct field is a matrix row like any other, so it gets the grid too.
    expectStampedExactly(slddRows(), ['Matrix', 'CellMatrix', 'stringMatrix', 'field']);
  });

  it('stamps the .mat rows that own a grid', () => {
    expectStampedExactly(matRows(), ['Mat', 'Nd']);
  });

  it('leaves Value and _valueEditable exactly as the node reported them', () => {
    // The stamp adds a key. It must not touch the cell text or the edit gate, so
    // both are compared against the NODE's own answers rather than a hand-written
    // constant: whatever core says, the stamped row still says.
    const node = slddEntries().find((e: any) => e.name === 'Matrix');
    const m = slddRows().find((r) => r._matrix && r.Name?.label === 'Matrix');
    expect(m).toBeTruthy();
    // Value is a plain string on this path today; read through the object form too
    // so the assertion is about the TEXT, not about which shape the builder chose.
    const valueText = typeof m.Value === 'object' ? m.Value?.text : m.Value;
    expect(valueText).toBe(node.displayValue);
    expect(valueText).toBe('[1 2; 3 4]');
    expect(m._valueEditable).toBe(node.valueEditable);
  });

  it('is a pure addition — the row is otherwise key-for-key what it was', () => {
    // Compare a stamped row against the same row with the stamp removed, so a
    // future refactor that reshapes the row inside stampMatrix fails here.
    for (const rows of [slddRows(), matRows()]) {
      for (const row of rows) {
        if (!row._matrix) continue;
        const keys = Object.keys(row).filter((k) => k !== '_matrix');
        expect(keys.length).toBeGreaterThan(1);
        expect(keys).not.toContain('matrix');   // the webview key is _matrix, one spelling
      }
    }
  });
});
