// Copyright 2026 The MathWorks, Inc.
// Characterization of the data-explorer-core behaviours the Variable Editor's
// payload builder reads. None of this is OUR logic — it is core's, pinned here so
// that a core pin bump which changes an element order, a subscript label, or a
// dims-reporting convention fails with the fact that moved rather than with a
// silently absent grid.
//
// Read `docs/superpowers/specs/2026-09-02-variable-editor-design.md`, Data fact 3,
// before changing any expectation in this file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fixturePath(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function descend(node: any): any[] {
  return [node, ...(node.children ?? []).flatMap(descend)];
}

// The design-section entry with this name, from the JSON .sldd fixture.
function entry(name: string): any {
  const text = readFileSync(fixturePath('numeric_json.sldd'), 'utf8');
  const sldd = getModel('facts://numeric_json.sldd', 'numeric_json.sldd', text);
  const design = (sldd.children ?? []).find((s: any) => s.name === 'design');
  const found = (design.children ?? []).find((e: any) => e.name === name);
  expect(found, `no design entry named ${name}`).toBeTruthy();
  return found;
}

// label -> displayValue, in node.children LIST order (which is the thing that
// varies by container kind).
function labelled(node: any): [string, string][] {
  return (node.children ?? []).map((c: any) => [c.displayName, c.displayValue]);
}

let matSeq = 0;
function matVariables(variables: any[]): any {
  const uri = `facts://mat-${matSeq++}.mat`;
  DataModel.removeDataSource(uri);
  return DataModel.addMatSourceParsed(uri, { header: 'MATLAB 5.0', variables }, { path: uri });
}

function variable(name: string, dimensions: number[], value: any[], className = 'double'): any {
  const node = matVariables([
    { name, className, dimensions, isComplex: false, isLogical: className === 'logical', value, fields: null },
  ]);
  return (node.children ?? [])[0];
}

describe('core fact: a numeric array lists its elements ROW-major within a page', () => {
  it('a 2x2 double from a .sldd labels children (1,1) (1,2) (2,1) (2,2)', () => {
    const m = entry('Matrix');
    expect(m.className).toBe('double');
    expect(m.dims).toEqual([2, 2]);
    expect(labelled(m)).toEqual([
      ['Matrix(1,1)', '1'],
      ['Matrix(1,2)', '2'],
      ['Matrix(2,1)', '3'],
      ['Matrix(2,2)', '4'],
    ]);
  });

  it('a rank-3 double pages with dimension 3 varying slowest across the list', () => {
    const nd = variable('Nd', [2, 3, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(nd.dims).toEqual([2, 3, 2]);
    expect(labelled(nd).map(([l]) => l)).toEqual([
      'Nd(1,1,1)', 'Nd(1,2,1)', 'Nd(1,3,1)', 'Nd(2,1,1)', 'Nd(2,2,1)', 'Nd(2,3,1)',
      'Nd(1,1,2)', 'Nd(1,2,2)', 'Nd(1,3,2)', 'Nd(2,1,2)', 'Nd(2,2,2)', 'Nd(2,3,2)',
    ]);
    // And the container summarizes rather than printing page 1 as the whole array.
    expect(nd.displayValue).toBe('<2x3x2 double>');
    expect(nd.valueEditable).toBe(false);
  });
});

describe('core fact: cell / string arrays list their elements COLUMN-major', () => {
  it('a 2x2 cell uses brace subscripts and column-major list order', () => {
    const c = entry('CellMatrix');
    expect(c.className).toBe('cell');
    expect(labelled(c)).toEqual([
      ['CellMatrix{1,1}', '1'],
      ['CellMatrix{2,1}', '3'],
      ['CellMatrix{1,2}', '2'],
      ['CellMatrix{2,2}', '4'],
    ]);
    // The literal the tree shows is the row-major reading: {1, 2; 3, 4}. A
    // positional read of `children` would render its transpose.
    expect(c.displayValue).toBe('{1, 2; 3, 4}');
  });

  it('a 2x2 string array is column-major too, with parenthesis subscripts', () => {
    const s = entry('stringMatrix');
    expect(s.className).toBe('string');
    expect(labelled(s)).toEqual([
      ['stringMatrix(1,1)', '"abc"'],
      ['stringMatrix(2,1)', '"f"'],
      ['stringMatrix(1,2)', '"de"'],
      ['stringMatrix(2,2)', '"gh i"'],
    ]);
    expect(s.displayValue).toBe('["abc" "de"; "f" "gh i"]');
  });

  it('a cell array reports arrayType of its ELEMENTS, so only className names it', () => {
    const c = entry('CellMatrix');
    expect(c.arrayType).toBe('double'); // would title a 2x2 cell "2x2 double"
    expect(c.className).toBe('cell');
  });
});

describe('core fact: a struct array now reports dims, and its elements are indistinguishable', () => {
  // This is core finding C7's fix. It is why the payload gate is a className
  // allow-list and not a structural `Array.isArray(node.dims)` check.
  it('structMatrix is a 2x2 with four identical <1x1 struct> children', () => {
    const s = entry('structMatrix');
    expect(s.className).toBe('struct');
    expect(s.dims).toEqual([2, 2]);
    expect(labelled(s)).toEqual([
      ['structMatrix(1,1)', '<1x1 struct>'],
      ['structMatrix(2,1)', '<1x1 struct>'],
      ['structMatrix(1,2)', '<1x1 struct>'],
      ['structMatrix(2,2)', '<1x1 struct>'],
    ]);
  });
});

describe('core fact: dims are RAW; MATLAB size() semantics have to be mirrored', () => {
  it('a [2,3,1] double reports three dims but labels two subscripts', () => {
    const sq = variable('Squeeze', [2, 3, 1], [1, 2, 3, 4, 5, 6]);
    expect(sq.dims).toEqual([2, 3, 1]);              // raw
    expect(sq.displayValue).toBe('[1 2 3; 4 5 6]');  // but displayed as 2-D
    expect(labelled(sq).map(([l]) => l)).toEqual([
      'Squeeze(1,1)', 'Squeeze(1,2)', 'Squeeze(1,3)',
      'Squeeze(2,1)', 'Squeeze(2,2)', 'Squeeze(2,3)',
    ]);
  });

  it('an array extending along one axis only is labelled with a LINEAR subscript', () => {
    // core's own `spread <= 1` branch (Subscript.ts:74-79). The payload's gate
    // uses the same test, so the gate and the label form are one condition.
    const thin = variable('Thin', [1, 1, 4], [1, 2, 3, 4]);
    expect(labelled(thin).map(([l]) => l)).toEqual(['Thin(1)', 'Thin(2)', 'Thin(3)', 'Thin(4)']);
    const vec = variable('Vec', [1, 3], [7, 8, 9]);
    expect(labelled(vec).map(([l]) => l)).toEqual(['Vec(1)', 'Vec(2)', 'Vec(3)']);
  });
});

describe('core fact: an object property row displays its Value child’s literal', () => {
  it('ParamMat has no dims of its own; its Value child is the 2x3 matrix', () => {
    invalidate('facts://all.sldd');
    const root = getModelFromBytes('facts://all.sldd', 'all.sldd', bytes('mcos/all.sldd'));
    const p = descend(root).find((n) => n.name === 'ParamMat');
    expect(p).toBeTruthy();
    expect(p.dims).toBeUndefined();
    expect(p.displayValue).toBe('[1 2 3; 4 5 6]');
    const value = (p.children ?? [])[0];
    expect(value.name).toBe('Value');
    expect(value.className).toBe('double');
    expect(value.dims).toEqual([2, 3]);
    // The entry row and the child row show the SAME string — which is what makes
    // it safe to put the entry row's glyph on the child's matrix.
    expect(value.displayValue).toBe(p.displayValue);
    expect(labelled(value).map(([l]) => l)).toEqual([
      'Value(1,1)', 'Value(1,2)', 'Value(1,3)', 'Value(2,1)', 'Value(2,2)', 'Value(2,3)',
    ]);
  });
});
