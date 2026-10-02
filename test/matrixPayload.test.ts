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
import { DataModel, effectiveDims as coreEffectiveDims } from 'data-explorer-core';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import {
  matrixPayload, matrixDescriptor, matrixForRow, isGriddable, effectiveDims, subsOf, canonicalIndex,
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
// gate and the placement rule: id, className, dims, displayName, displayElements.
//
// `displayElements()` is the accessor the cells now come from, and `children` is
// built from the SAME list because that is what a real node does — core returns its
// element children where it has them and derives the identical pairs where it does
// not (data-explorer-core test/displayElements.test.ts pins the agreement). Set
// `expanded: false` to model the node this whole mechanism exists for: a matrix past
// core's MAX_EXPANDED_ELEMENTS, which has every element and no children at all.
function stub(opts: {
  name: string; className: string; dims: unknown;
  cells: [string, string][];       // [label, displayValue]
  displayValue?: string;
  expanded?: boolean;
  id?: string;
}): any {
  const children = opts.cells.map(([displayName, displayValue]) => ({ displayName, displayValue }));
  return {
    id: opts.id ?? `stub:${opts.name}`,
    className: opts.className,
    dims: opts.dims,
    displayName: opts.name,
    displayValue: opts.displayValue ?? '',
    children: opts.expanded === false ? [] : children,
    displayElements: () => opts.cells.map(([label, value]) => ({ label, value })),
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

  it('IS core’s function now, not a second copy of the rule', () => {
    // The local implementation is gone; core exports `effectiveDims` and this file
    // calls it. Comparing the two over the cases that used to be duplicated is what
    // fails if a rule of our own ever grows back here, because drift between them
    // shows up as a good matrix silently getting no grid rather than as an error.
    for (const dims of [[2, 3, 1], [2, 3, 1, 1], [2, 1, 3], [1, 1], [], [4], [2, 2, 2, 3]]) {
      expect(effectiveDims(dims)).toEqual(coreEffectiveDims(dims));
    }
  });

  it('coerces what a duck-typed node hands it, which core’s number[] cannot', () => {
    // All this wrapper still adds. `dims` is read off an untyped node, so anything
    // that is not an array of numbers has to normalize like an absent one — core's
    // signature is number[] and stays that way rather than widening for us.
    expect(effectiveDims(['2', '3', '1'])).toEqual([2, 3]);
    expect(effectiveDims('2x3')).toEqual([1, 1]);
    expect(effectiveDims(null)).toEqual([1, 1]);
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

  it('rejects a node that cannot list its elements at all', () => {
    // displayElements is the only source of cell text. A node without it is not a
    // MatlabVariableNode — or is one from a core pin older than the accessor — and
    // either way the affordance disappears rather than the host inventing a second
    // formatting path over `node.Value`. The numeric precision, the char budget and
    // the `<unavailable>` sentinel are core's rules; a copy of them here would be a
    // grid cell that disagrees with the element row beside it.
    const mute = stub({ name: 'M', className: 'double', dims: [2, 2], cells: [] });
    delete mute.displayElements;
    expect(isGriddable(mute)).toBe(false);
    expect(matrixPayload(mute)).toBeNull();
  });

  it('does NOT require element children, which is the whole point', () => {
    // The gate used to demand `children.length === elementCount`. That tied the grid
    // to a decision made for the TABLE — core stops expanding past
    // MAX_EXPANDED_ELEMENTS — so raising this cap above core's would have produced
    // matrices that pass every clause and have nothing to draw. The two limits are
    // now independent, and this is the test that says so.
    const unexpanded = stub({
      name: 'U', className: 'double', dims: [2, 2], expanded: false,
      cells: [['U(1,1)', '1'], ['U(1,2)', '2'], ['U(2,1)', '3'], ['U(2,2)', '4']],
    });
    expect(unexpanded.children.length).toBe(0);
    expect(isGriddable(unexpanded)).toBe(true);
    expect(matrixPayload(unexpanded)!.cells).toEqual(['1', '2', '3', '4']);
  });

  it('still fails closed when the element list is short, however it arrived', () => {
    // The old gate caught this by counting children. Counting is gone, so the
    // placement loop is what has to catch it — a slot left unfilled voids the
    // payload, exactly as a duplicate or an out-of-range subscript does.
    const short = stub({
      name: 'S', className: 'double', dims: [2, 2], expanded: false,
      cells: [['S(1,1)', '1'], ['S(1,2)', '2'], ['S(2,1)', '3']],
    });
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
  it('is the renderer’s budget now, and not core’s expansion limit', () => {
    // Measured against the shipped dex-matrix-grid in real Chromium, one page at a
    // time in a 640x420 scrolling popup: 4,096 cells build in 25 ms for 7 MB of
    // renderer heap, 99,856 in 581 ms for 63 MB, 1,000,000 in ~6 s for ~594 MB — and
    // scroll latency stays flat at 21-28 ms the whole way, which is what makes a
    // cap this high a question of BUILD cost rather than of usability.
    //
    // 1,000,000 is 1000x1000, the shape that prompted this: the entry a customer
    // dictionary actually held. The cost is paid on an explicit open and by nothing
    // else, which is the point of fetching on open rather than stamping every row.
    //
    // It no longer has to stay under core's MAX_EXPANDED_ELEMENTS (10,000) — the
    // comment that used to say so is gone along with the coupling, because the cells
    // come from displayElements and not from element children.
    expect(MAX_MATRIX_ELEMENTS).toBe(1000000);
  });

  it('admits exactly MAX_MATRIX_ELEMENTS and refuses one more', () => {
    // Duck-typed: the boundary is arithmetic over dims, and building two real
    // million-element matrices to assert one `>` would measure core instead.
    const fake = (count: number) => ({
      id: 'x', className: 'double', dims: [1000, count / 1000],
      displayName: 'X', displayValue: '', children: [],
      displayElements: () => [],
    });
    expect(isGriddable(fake(MAX_MATRIX_ELEMENTS))).toBe(true);
    expect(isGriddable(fake(MAX_MATRIX_ELEMENTS + 1000))).toBe(false);
  });

  it('grids a real matrix that core refused to expand', () => {
    // 40,000 elements: past core's MAX_EXPANDED_ELEMENTS of 10,000, so this node has
    // every element and no children. The end-to-end case the cap exists to admit,
    // through the real parse rather than a stub.
    const big = variable('Big', [200, 200], Array.from({ length: 40000 }, (_, i) => i));
    expect(big.children.length).toBe(0);
    const p = matrixPayload(big)!;
    expect(p).toBeTruthy();
    expect(p.cells.length).toBe(40000);
    // Every slot filled, exactly once — asserted as distinctness rather than as a
    // hand-written order, which is the property the placement rule actually owes.
    expect(new Set(p.cells).size).toBe(40000);
  });
});

describe('the descriptor is what a row carries', () => {
  const m = () => stub({
    name: 'A', className: 'double', dims: [2, 2], id: 'sldd:design/A',
    cells: [['A(1,1)', '1'], ['A(1,2)', '2'], ['A(2,1)', '3'], ['A(2,2)', '4']],
  });

  it('says everything the glyph and the panel title need, and carries no cells', () => {
    // The glyph's aria-label and tooltip and the panel's title line are the only
    // things read before the panel opens, and they need the name, the class and the
    // shape. Cells on the row would be 4 MB per million-element entry crossing a
    // postMessage for a panel nobody opened.
    const d = matrixDescriptor(m())!;
    expect(d).toEqual({ name: 'A', className: 'double', dims: [2, 2], nodeId: 'sldd:design/A' });
    expect('cells' in d).toBe(false);
  });

  it('names the node the request should repeat the resolution from', () => {
    // The node the descriptor was computed FROM, not the matrix's owner: a property
    // row's matrix lives on its Value child, and matrixForRow is the one rule that
    // resolves that. Sending the row's own node id means the host re-runs that same
    // rule instead of a second one agreeing with it.
    invalidate('mp://desc.sldd');
    const root = getModelFromBytes('mp://desc.sldd', 'desc.sldd', bytes('mcos/all.sldd'));
    const p = descend(root).find((n) => n.name === 'ParamMat');
    const d = matrixDescriptor(p)!;
    expect(d.nodeId).toBe(p.id);
    expect(d.name).toBe('ParamMat.Value');       // the title still names the property
    expect(matrixForRow(p).name).toBe('Value');  // while the cells come from the child
  });

  it('answers to the same gate as the payload, so the glyph tracks the grid', () => {
    // Everything matrixForRow refuses, both of them refuse. It is deliberately NOT a
    // promise that the cells will lay out — a label anomaly is only discoverable by
    // building them, which is the work the descriptor exists to skip, so the fetch
    // is allowed to come back empty-handed and the panel says so.
    for (const n of [null, undefined, {}, entry('structMatrix'),
      stub({ name: 'V', className: 'double', dims: [1, 3], cells: [] }),
      stub({ name: 'C', className: 'char', dims: [2, 2], cells: [['C(1,1)', 'a']] })]) {
      expect(matrixDescriptor(n)).toBeNull();
      expect(matrixPayload(n)).toBeNull();
    }
  });

  it('is refused for a node with no id, which nothing could ever ask about', () => {
    // The glyph's whole job is to open a panel, and the panel is filled by asking
    // for this id. Without one the affordance would be a dead end, so both answers
    // go away together — the payload too, which keeps the two in lockstep.
    const anon = m();
    delete anon.id;
    expect(matrixDescriptor(anon)).toBeNull();
    expect(matrixPayload(anon)).toBeNull();
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
