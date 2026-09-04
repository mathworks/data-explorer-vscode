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

describe('the gate admits real 2-D matrices and nothing else', () => {
  it('admits a 2x2 double, a 2x2 cell, a 2x2 string and a 2x3 double', () => {
    expect(isGriddable(entry('Matrix'))).toBe(true);
    expect(isGriddable(entry('CellMatrix'))).toBe(true);
    expect(isGriddable(entry('stringMatrix'))).toBe(true);
    expect(isGriddable(variable('M', [2, 3], [1, 2, 3, 4, 5, 6]))).toBe(true);
  });

  it('rejects a scalar, a row vector, a column vector and an empty', () => {
    expect(isGriddable(entry('Number'))).toBe(false);       // 1x1
    expect(isGriddable(entry('Array'))).toBe(false);        // 1x3
    expect(isGriddable(entry('Array1'))).toBe(false);       // 3x1
    expect(isGriddable(entry('CellArray'))).toBe(false);    // 1x3 cell
    expect(isGriddable(variable('E', [0, 0], []))).toBe(false);
  });

  it('rejects a 1x1x4, which extends along one axis and is a vector in MATLAB', () => {
    // The clause this replaced (`dims.length >= 3 || ...`) let this through and
    // rendered a 1x1 grid with four pages — worse than the child rows it replaces.
    expect(isGriddable(variable('Thin', [1, 1, 4], [1, 2, 3, 4]))).toBe(false);
  });

  it('admits a 1x3x2, where the pages are the whole point', () => {
    expect(isGriddable(variable('Pages', [1, 3, 2], [1, 2, 3, 4, 5, 6]))).toBe(true);
  });

  it('rejects char, which is not on the allow-list', () => {
    // A 2-D char array is a MATLAB string matrix whose rows are the strings; a
    // per-character grid would be a worse rendering than the literal it replaces.
    expect(GRIDDABLE_CLASSES.has('char')).toBe(false);
    expect(isGriddable(stub({
      name: 'C', className: 'char', dims: [2, 2],
      cells: [['C(1,1)', 'a'], ['C(1,2)', 'b'], ['C(2,1)', 'c'], ['C(2,2)', 'd']],
    }))).toBe(false);
  });

  it('rejects a node whose children have not all materialized', () => {
    // The only source of cell text is children[i].displayValue. If core ever
    // stops materializing elements the payload disappears rather than inventing
    // a second formatting path over node.elements.
    const short = stub({
      name: 'S', className: 'double', dims: [2, 2],
      cells: [['S(1,1)', '1'], ['S(1,2)', '2'], ['S(2,1)', '3']],
    });
    expect(isGriddable(short)).toBe(false);
    expect(matrixPayload(short)).toBeNull();
  });
});

describe('the allow-list is the rule, not a side effect of a missing accessor', () => {
  // Core v1.0.0 (finding C7) gave StructNode/ObjectNode a `dims` getter, so this
  // node now satisfies EVERY structural clause. Excluding it has to be stated.
  it('a real 2x2 struct array is refused even though its shape is now readable', () => {
    const s = entry('structMatrix');
    expect(s.className).toBe('struct');
    expect(s.dims).toEqual([2, 2]);                  // structural clauses all pass
    expect((s.children ?? []).length).toBe(4);
    expect(isGriddable(s)).toBe(false);              // ...and it is still refused
    expect(matrixPayload(s)).toBeNull();
  });

  it('a 2-D object array is refused for the same reason', () => {
    const objs = stub({
      name: 'w', className: 'Simulink.Parameter', dims: [2, 2],
      cells: [['w(1,1)', '10'], ['w(2,1)', '20'], ['w(1,2)', '30'], ['w(2,2)', '40']],
    });
    expect(matrixPayload(objs)).toBeNull();
  });

  it('a .mat struct ARRAY is refused too, and it is not even a StructNode', () => {
    // Parsed from a .mat it arrives as a MatlabVariableNode with className
    // 'struct', which no node-class check would have caught. One rule catches all.
    const uri = 'mp://structarray.mat';
    DataModel.removeDataSource(uri);
    const mat = DataModel.addMatSourceParsed(uri, {
      header: 'MATLAB 5.0',
      variables: [{
        name: 'SArr', className: 'struct', dimensions: [2, 3], isComplex: false, isLogical: false,
        value: null,
        fields: { a: [1, 2, 3, 4, 5, 6].map((v) => ({
          name: 'a', className: 'double', dimensions: [1, 1],
          isComplex: false, isLogical: false, value: v, fields: null,
        })) },
      }],
    }, { path: uri });
    const sarr = (mat.children ?? [])[0];
    expect(sarr.className).toBe('struct');
    expect(matrixPayload(sarr)).toBeNull();
  });
});

describe('cells are placed by label, so every container kind comes out canonical', () => {
  it('a row-major numeric list lands in reading order', () => {
    const p = matrixPayload(entry('Matrix'))!;
    expect(p).toBeTruthy();
    expect(p.name).toBe('Matrix');
    expect(p.className).toBe('double');
    expect(p.dims).toEqual([2, 2]);
    expect(p.cells).toEqual(['1', '2', '3', '4']);
  });

  it('a COLUMN-major cell list lands in the same reading order, not transposed', () => {
    // children are 1, 3, 2, 4 in list order. A positional read would give that.
    const c = entry('CellMatrix');
    expect((c.children ?? []).map((k: any) => k.displayValue)).toEqual(['1', '3', '2', '4']);
    const p = matrixPayload(c)!;
    expect(p.cells).toEqual(['1', '2', '3', '4']);
    expect(p.className).toBe('cell'); // NOT arrayType, which reports 'double'
  });

  it('a COLUMN-major string list lands in reading order too', () => {
    const p = matrixPayload(entry('stringMatrix'))!;
    expect(p.cells).toEqual(['"abc"', '"de"', '"f"', '"gh i"']);
    expect(p.className).toBe('string');
  });

  it('re-joining the canonical cells reproduces core’s OWN literal', () => {
    // The strongest available check: two independently-computed renderings of the
    // same data agreeing beats either matching a hand-written expectation.
    const join2d = (cells: string[], dims: number[], open: string, close: string, sep: string) => {
      const rows: string[] = [];
      for (let r = 0; r < dims[0]; r++) {
        rows.push(cells.slice(r * dims[1], (r + 1) * dims[1]).join(sep));
      }
      return open + rows.join('; ') + close;
    };
    const s = entry('stringMatrix');
    const sp = matrixPayload(s)!;
    expect(join2d(sp.cells, sp.dims, '[', ']', ' ')).toBe(s.displayValue);
    const c = entry('CellMatrix');
    const cp = matrixPayload(c)!;
    expect(join2d(cp.cells, cp.dims, '{', '}', ', ')).toBe(c.displayValue);
    const m = entry('Matrix');
    const mp = matrixPayload(m)!;
    expect(join2d(mp.cells, mp.dims, '[', ']', ' ')).toBe(m.displayValue);
  });

  it('every cell is exactly its element row’s own display string', () => {
    const m = entry('Matrix');
    const byLabel = new Map<string, string>(
      (m.children ?? []).map((k: any) => [k.displayName, k.displayValue]),
    );
    const p = matrixPayload(m)!;
    for (let r = 1; r <= 2; r++) {
      for (let c = 1; c <= 2; c++) {
        expect(p.cells[canonicalIndex([r, c], p.dims)]).toBe(byLabel.get(`Matrix(${r},${c})`));
      }
    }
  });

  it('a logical matrix keeps core’s true/false spelling', () => {
    const p = matrixPayload(variable('Lg', [2, 2], [true, false, false, true], 'logical'))!;
    expect(p.className).toBe('logical');
    expect(p.cells).toEqual(['true', 'false', 'false', 'true']);
  });
});

describe('rank >= 3 and the effectiveDims mirror', () => {
  it('pages a 2x3x2 into two contiguous windows', () => {
    const p = matrixPayload(variable('Nd', [2, 3, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))!;
    expect(p.dims).toEqual([2, 3, 2]);
    expect(p.cells.slice(0, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(p.cells.slice(6)).toEqual(['7', '8', '9', '10', '11', '12']);
  });

  it('places a rank-4 array with dimension 3 varying fastest', () => {
    const values = Array.from({ length: 24 }, (_, i) => i + 1);
    const p = matrixPayload(variable('R4', [2, 2, 2, 3], values))!;
    expect(p.dims).toEqual([2, 2, 2, 3]);
    expect(p.cells.length).toBe(24);
    expect(p.cells[canonicalIndex([1, 1, 2, 1], p.dims)]).toBe('5');
    expect(p.cells[canonicalIndex([1, 1, 1, 2], p.dims)]).toBe('9');
  });

  it('treats a [2,3,1] as the 2x3 MATLAB says it is', () => {
    // Its labels carry two subscripts. Without the effectiveDims mirror the rank
    // check would disagree with them and this good matrix would get no grid.
    const sq = variable('Squeeze', [2, 3, 1], [1, 2, 3, 4, 5, 6]);
    expect(sq.dims).toEqual([2, 3, 1]);
    const p = matrixPayload(sq)!;
    expect(p.dims).toEqual([2, 3]);
    expect(p.cells).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

describe('the size cap', () => {
  it('admits exactly MAX_MATRIX_ELEMENTS and refuses one more', () => {
    const n = MAX_MATRIX_ELEMENTS;
    const at = variable('Big', [64, 64], Array.from({ length: n }, (_, i) => i));
    expect(matrixPayload(at)!.cells.length).toBe(n);
    const over = variable('Over', [64, 65], Array.from({ length: 64 * 65 }, (_, i) => i));
    expect(matrixPayload(over)).toBeNull();
  });
});

describe('matrixForRow resolves the owner the same way for every builder', () => {
  it('finds the matrix on the Value child of an object property row', () => {
    invalidate('mp://all.sldd');
    const root = getModelFromBytes('mp://all.sldd', 'all.sldd', bytes('mcos/all.sldd'));
    const p = descend(root).find((n) => n.name === 'ParamMat');
    expect(matrixForRow(p).name).toBe('Value');
    const payload = matrixPayload(p)!;
    expect(payload.name).toBe('ParamMat.Value');   // qualified: says which property
    expect(payload.dims).toEqual([2, 3]);
    expect(payload.cells).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('gives the Value child row itself an unqualified payload', () => {
    invalidate('mp://all2.sldd');
    const root = getModelFromBytes('mp://all2.sldd', 'all2.sldd', bytes('mcos/all.sldd'));
    const value = descend(root).find((n) => n.name === 'ParamMat').children[0];
    expect(matrixPayload(value)!.name).toBe('Value');
  });

  it('does NOT reach into a Value field whose literal the row is not showing', () => {
    // A struct row shows `<1x1 struct>`; a glyph there opening a field's grid
    // would be an affordance on a value that is not on screen.
    const holder = {
      className: 'struct', dims: [1, 1], displayName: 'S', displayValue: '<1x1 struct>',
      children: [stub({
        name: 'Value', className: 'double', dims: [2, 2], displayValue: '[1 2; 3 4]',
        cells: [['Value(1,1)', '1'], ['Value(1,2)', '2'], ['Value(2,1)', '3'], ['Value(2,2)', '4']],
      })],
    };
    (holder.children[0] as any).name = 'Value';
    expect(matrixPayload(holder)).toBeNull();
  });

  it('returns null for the nodes a builder actually hands it, without throwing', () => {
    expect(matrixPayload(null)).toBeNull();
    expect(matrixPayload({})).toBeNull();
    expect(matrixPayload({ className: 'double', get dims(): never { throw new Error('boom'); } })).toBeNull();
  });
});

describe('the builder fails closed on every label anomaly', () => {
  const four: [string, string][] = [['A(1,1)', '1'], ['A(1,2)', '2'], ['A(2,1)', '3'], ['A(2,2)', '4']];

  it('one unparseable label voids the whole payload', () => {
    const bad = [...four];
    bad[2] = ['A[2,1]', '3'];
    expect(matrixPayload(stub({ name: 'A', className: 'double', dims: [2, 2], cells: bad }))).toBeNull();
  });

  it('a subscript out of range voids it', () => {
    const bad = [...four];
    bad[3] = ['A(3,1)', '4'];
    expect(matrixPayload(stub({ name: 'A', className: 'double', dims: [2, 2], cells: bad }))).toBeNull();
  });

  it('two elements claiming one slot voids it, rather than one silently winning', () => {
    const bad = [...four];
    bad[3] = ['A(1,1)', '4'];
    expect(matrixPayload(stub({ name: 'A', className: 'double', dims: [2, 2], cells: bad }))).toBeNull();
  });

  it('a good payload of the same shape still succeeds (the tests above are not vacuous)', () => {
    const p = matrixPayload(stub({ name: 'A', className: 'double', dims: [2, 2], cells: four }))!;
    expect(p.cells).toEqual(['1', '2', '3', '4']);
  });
});
