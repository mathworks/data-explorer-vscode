// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Variable Editor grid asks of every cell whether it reads as a number, to decide the
// whole block's alignment, and the cells are a FILE's text. A binary dictionary's complex
// value is held as the text MATLAB wrote it in (`1.0+2.0i 0.0+0.0i ...`), and core hands
// each element over as that text, so what the grid's numeric pattern is asked about is the
// file's own bytes. Its decimal was `\d+\.?\d*`, which with no dot is `\d+\d*`: a run of
// digits that is not a number in the end is split between the two every way there is
// before the pattern gives up. 100,000 digits and a non-digit took 21 s in the bare
// pattern, and 50,000 of them in one element held the grid's open for 7.5 to 7.7 s here.
//
// The dictionary is test-integration/fixtures/sparse/sparse_binary.sldd, which MATLAB
// wrote, with one value's text lengthened: dComplex's first element gets a long run of
// digits where its real part was. Nothing else in the file changes.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { getModelFromBytes, invalidate } from '../src/view/model/workspace/SlddModel.js';
import { matrixPayload } from '../src/view/model/matrix/matrixPayload.js';
import { DexMatrixGrid, type MatrixPayload } from '../src/view/widgets/variable-editor/dex-matrix-grid.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// import.meta.dirname, not a URL against import.meta.url: under happy-dom that URL is an
// http one (the note in blockSidIdentity.test.ts).
const FIXTURE = join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'sparse', 'sparse_binary.sldd');
const ORIGINAL = '1.0+2.0i 0.0+0.0i 0.5+0.0i';

// Long enough that the old pattern's square is seconds (the grid opened in 7.5 to 7.7 s
// on the machine this was written on) and the new one's line a fraction of a millisecond.
const DIGITS = 50_000;

// The bound is the cost of opening the grid, the pattern included. The new pattern spends
// well under a millisecond on these cells and the render a few more; the old one spent
// seconds. A bound this far from both is a test of the shape of the cost, not of the
// machine it runs on.
const BOUND_MS = 1000;

let grid: DexMatrixGrid | null = null;

afterEach(() => {
  grid?.remove();
  grid = null;
});

/** sparse_binary.sldd with dComplex's first element replaced by `first`. */
function dictionaryWith(first: string): ArrayBuffer {
  const zip = unzipSync(new Uint8Array(readFileSync(FIXTURE)));
  const xml = strFromU8(zip['data/chunk0.xml']);
  // The precondition, so a fixture that changed under this test fails here and not as a
  // timing that means nothing.
  expect(xml.split(ORIGINAL).length - 1, 'dComplex text, exactly once').toBe(1);
  zip['data/chunk0.xml'] = strToU8(xml.replace(ORIGINAL, `${first} 0.0+0.0i 0.5+0.0i`));
  const out = zipSync(zip);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function dComplex(uri: string, bytes: ArrayBuffer): any {
  invalidate(uri);
  const root = getModelFromBytes(uri, 'sparse_binary.sldd', bytes);
  const hits = (root.children ?? []).flatMap((s: any) => (s.children ?? []).filter((e: any) => e.name === 'dComplex'));
  expect(hits.length, 'exactly one dComplex').toBe(1);
  return hits[0];
}

async function openGrid(matrix: MatrixPayload): Promise<{ el: DexMatrixGrid; ms: number }> {
  const start = performance.now();
  grid = new DexMatrixGrid();
  grid.matrix = matrix;
  document.body.appendChild(grid);
  await grid.updateComplete;
  return { el: grid, ms: performance.now() - start };
}

const cellEls = (el: DexMatrixGrid) => Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>('[role="gridcell"]'));

describe("a file's complex text reaches the grid's numeric test as the file spells it", () => {
  it('opens in linear time on a long run of digits in an element', async () => {
    const run = '1'.repeat(DIGITS);
    const node = dComplex('gns://long-real.sldd', dictionaryWith(`${run}.0+2.0i`));
    const payload = matrixPayload(node);
    expect(payload, 'dComplex is griddable').not.toBeNull();
    // The route this test exists for: the element is the file's own text (core drops
    // MATLAB's `.0`), and it is the first cell the grid tests, so nothing before it has
    // already settled the alignment.
    expect(payload!.cells[0]).toBe(`${run}+2i`);

    const { el, ms } = await openGrid(payload!);
    expect(ms, `grid opened in ${ms.toFixed(1)} ms`).toBeLessThan(BOUND_MS);
    // And it is still not a number: a complex value's block stays left-aligned.
    expect(cellEls(el)[0].classList.contains('num')).toBe(false);
  }, 60_000);

  it('opens in linear time when the run of digits is the whole of a part', async () => {
    // `<digits>i` and `<digits>e` are not numbers either, and both reach the pattern the
    // same way: the run is consumed, the next character refuses, and only the split
    // between `\d+` and `\d*` was left to try.
    for (const tail of ['i', 'e']) {
      const run = '1'.repeat(DIGITS);
      const node = dComplex(`gns://tail-${tail}.sldd`, dictionaryWith(`${run}${tail}`));
      const payload = matrixPayload(node)!;
      expect(payload.cells[0]).toBe(`${run}${tail}`);
      const { el, ms } = await openGrid(payload);
      expect(ms, `${tail}: grid opened in ${ms.toFixed(1)} ms`).toBeLessThan(BOUND_MS);
      expect(cellEls(el)[0].classList.contains('num')).toBe(false);
      grid?.remove();
      grid = null;
    }
  }, 60_000);

  it('still reads a long run of digits that IS a number as one', async () => {
    // The success path was never slow — the greedy run matches at once — and this pins
    // that the rewrite left the language alone: these are right-aligned before and after.
    const run = '1'.repeat(DIGITS);
    const { el, ms } = await openGrid({
      name: 'A', className: 'double', nodeId: 'n1', dims: [2, 2],
      cells: [run, `${run}.`, `${run}.5e-3`, `-${run}`],
    });
    expect(ms).toBeLessThan(BOUND_MS);
    expect(cellEls(el)[0].classList.contains('num')).toBe(true);
  }, 60_000);
});

describe('which cells read as numbers is unchanged', () => {
  // One grid per cell, so each cell alone decides its grid's alignment. The pattern's
  // equivalence was checked exhaustively when it was rewritten (every string of up to
  // eight characters over the alphabet below); this is the short list a regression in it
  // would trip first.
  const NUMBERS = ['0', '1', '-2', '+3', '1.', '1.5', '.5', '-.5', '1e5', '1E+5', '1.e-5', '.5e5', '12.34e56', 'Inf', '-Inf', '+NaN', 'NaN'];
  const NOT_NUMBERS = ['', '.', 'e5', '1e', '1e+', '1.2.3', '..5', '1..', '1+2i', '1i', 'i', '--1', '+-1', '1 ', ' 1', 'inf', 'nan', 'Infinity', '1x', '0x10', '1,5'];

  for (const cell of NUMBERS) {
    it(`reads ${JSON.stringify(cell)} as a number`, async () => {
      const { el } = await openGrid({ name: 'A', className: 'double', nodeId: 'n1', dims: [1, 2], cells: [cell, '1'] });
      expect(cellEls(el)[0].classList.contains('num')).toBe(true);
    });
  }
  for (const cell of NOT_NUMBERS) {
    it(`does not read ${JSON.stringify(cell)} as a number`, async () => {
      const { el } = await openGrid({ name: 'A', className: 'double', nodeId: 'n1', dims: [1, 2], cells: [cell, '1'] });
      expect(cellEls(el)[0].classList.contains('num')).toBe(false);
    });
  }
});
