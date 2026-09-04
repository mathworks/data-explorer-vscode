// Copyright 2026 The MathWorks, Inc.
// The host-side rule that decides which values get a grid and where each element
// sits in it. Two properties matter more than any individual case:
//
//   1. cells are placed by each element's OWN subscript label, so a cell/string
//      array (column-major list) and a numeric array (row-major list) both come
//      out in the same canonical order;
//   2. the builder fails CLOSED — anything unexpected yields null, and the row
//      then behaves exactly as it does today.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import {
  matrixPayload, matrixForRow, isGriddable, effectiveDims, subsOf, canonicalIndex,
  MAX_MATRIX_ELEMENTS, GRIDDABLE_CLASSES,
} from '../src/host/matrixPayload.js';

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

function entry(name: string): any {
  const text = readFileSync(fixturePath('numeric_json.sldd'), 'utf8');
  const sldd = getModel('mp://numeric_json.sldd', 'numeric_json.sldd', text);
  const design = (sldd.children ?? []).find((s: any) => s.name === 'design');
  const found = (design.children ?? []).find((e: any) => e.name === name);
  expect(found, `no design entry named ${name}`).toBeTruthy();
  return found;
}

let matSeq = 0;
function variable(name: string, dimensions: number[], value: any[], className = 'double'): any {
  const uri = `mp://mat-${matSeq++}.mat`;
  DataModel.removeDataSource(uri);
  const mat = DataModel.addMatSourceParsed(uri, {
    header: 'MATLAB 5.0',
    variables: [{
      name, className, dimensions, isComplex: false,
      isLogical: className === 'logical', value, fields: null,
    }],
  }, { path: uri });
  return (mat.children ?? [])[0];
}

// A stub node standing in for whatever core does next. Enough surface for the
// gate and the placement rule: className, dims, displayName, children.
function stub(opts: {
  name: string; className: string; dims: unknown;
  cells: [string, string][];       // [label, displayValue]
  displayValue?: string;
}): any {
  return {
    className: opts.className,
    dims: opts.dims,
    displayName: opts.name,
    displayValue: opts.displayValue ?? '',
    children: opts.cells.map(([displayName, displayValue]) => ({ displayName, displayValue })),
  };
}

describe('effectiveDims mirrors MATLAB size()', () => {
  it('drops trailing singletons past the second dimension only', () => {
    expect(effectiveDims([2, 3, 1])).toEqual([2, 3]);
    expect(effectiveDims([2, 3, 1, 1])).toEqual([2, 3]);
    expect(effectiveDims([2, 1, 3])).toEqual([2, 1, 3]); // interior singleton stays
    expect(effectiveDims([1, 1])).toEqual([1, 1]);       // 1x1 is not shortened
  });

  it('normalizes the degenerate inputs the same way core does', () => {
    expect(effectiveDims(undefined)).toEqual([1, 1]);
    expect(effectiveDims([])).toEqual([1, 1]);
    expect(effectiveDims([4])).toEqual([1, 4]);
  });
});

describe('subsOf reads the subscripts core wrote', () => {
  it('accepts both bracket styles and any rank', () => {
    expect(subsOf('Matrix', 'Matrix(2,1)')).toEqual([2, 1]);
    expect(subsOf('CellMatrix', 'CellMatrix{1,2}')).toEqual([1, 2]);
    expect(subsOf('Nd', 'Nd(2,3,2)')).toEqual([2, 3, 2]);
  });

  it('rejects anything that is not exactly that form', () => {
    expect(subsOf('Matrix', 'Other(1,1)')).toBeNull();     // wrong parent
    expect(subsOf('Matrix', 'Matrix[1,1]')).toBeNull();    // wrong bracket
    expect(subsOf('Matrix', 'Matrix(1,1')).toBeNull();     // unterminated
    expect(subsOf('Matrix', 'Matrix(a,1)')).toBeNull();    // non-numeric
    expect(subsOf('Matrix', 'Matrix(-1,1)')).toBeNull();   // signed
    expect(subsOf('Matrix', 'Matrix()')).toBeNull();       // empty
    expect(subsOf('Matrix', 'Matrix')).toBeNull();         // no subscript at all
    expect(subsOf('Matrix', undefined)).toBeNull();
  });
});

describe('canonicalIndex: row-major within a page, pages with dim 3 fastest', () => {
  it('lays a 2x3 out row-major', () => {
    const slots = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]
      .map((s) => canonicalIndex(s, [2, 3]));
    expect(slots).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('puts page 2 of a 2x3x2 immediately after page 1', () => {
    expect(canonicalIndex([1, 1, 1], [2, 3, 2])).toBe(0);
    expect(canonicalIndex([2, 3, 1], [2, 3, 2])).toBe(5);
    expect(canonicalIndex([1, 1, 2], [2, 3, 2])).toBe(6);
    expect(canonicalIndex([2, 3, 2], [2, 3, 2])).toBe(11);
  });

  it('orders a rank-4 stack with dimension 3 varying fastest', () => {
    // dims [2,2,2,3]: page index = (s2-1) + (s3-1)*2, i.e. (:,:,1,1) (:,:,2,1)
    // (:,:,1,2) ... — MATLAB's own linear page order.
    expect(canonicalIndex([1, 1, 1, 1], [2, 2, 2, 3])).toBe(0);
    expect(canonicalIndex([1, 1, 2, 1], [2, 2, 2, 3])).toBe(4);
    expect(canonicalIndex([1, 1, 1, 2], [2, 2, 2, 3])).toBe(8);
    expect(canonicalIndex([2, 2, 2, 3], [2, 2, 2, 3])).toBe(23);
  });

  it('rejects a rank mismatch or an out-of-range subscript', () => {
    expect(canonicalIndex([1, 1], [2, 3, 2])).toBe(-1);
    expect(canonicalIndex([1, 1, 1], [2, 3])).toBe(-1);
    expect(canonicalIndex([3, 1], [2, 3])).toBe(-1);
    expect(canonicalIndex([0, 1], [2, 3])).toBe(-1);
  });
});
