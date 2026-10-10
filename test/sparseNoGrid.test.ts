// Copyright 2026 The MathWorks, Inc.
// A sparse array gets no Variable Editor grid from any of the three builders that stamp
// one, and its dense twin of the same shape still does — over core's own sparse fixtures,
// read the way the extension reads them.
//
// What changed is core's, in 1.36.3: a sparse array is held as its non-zeros, its
// `displayElements()` answers null, and the new `isSparse` getter is true on every sparse
// node. matrixPayload's gate asks that getter (its stub tests are in matrixPayload.test.ts).
// This file is the same rule over real nodes, so a core that stops marking a sparse array,
// or a builder that stops asking, fails here with the variable named.
//
// The fixtures are data-explorer-core's MATLAB-written reference files (its
// test/fixtures/sparse at v1.36.2, made by make_sparse_fixtures.m there). They live in
// test-integration/fixtures/sparse, where the integration suite opens the same four
// through the real editors. Each holds every sparse variable beside a dense twin of the
// same class and shape, which is what lets one file say both halves.
//
// The no-grid half needs core 1.36.3, and is skipped on an older core: there a sparse array
// has no `isSparse`, still lists every element, and its grid still opens. The dense half
// runs on any core.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { isGriddable, matrixPayload } from '../src/host/matrixPayload.js';
import { matrixCellsMessage } from '../src/host/matrixRequest.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { buildMatRows } from '../src/host/matRowBuilder.js';
import { buildPropertyGroups } from '../src/host/piBuilder.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../test-integration/fixtures/sparse/${name}`, import.meta.url));
}

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fixturePath(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// The core this suite is linked against, read off the package it resolves rather than
// off package.json's pin: a tarball installed over the pin is the core under test.
function coreVersion(): string {
  const pkg = fileURLToPath(new URL('../node_modules/data-explorer-core/package.json', import.meta.url));
  const version = String(JSON.parse(readFileSync(pkg, 'utf8')).version);
  // Unreadable is an error, not "older": a gate that read garbage as old would skip the
  // half of this file that matters, and say nothing.
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`unreadable data-explorer-core version: ${version}`);
  return version;
}

function atLeast(version: string, min: string): boolean {
  const have = version.split(/[.-]/).slice(0, 3).map(Number);
  const want = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
}

const SPARSE_HAS_NO_GRID = atLeast(coreVersion(), '1.36.3');

// 2-D, within MAX_MATRIX_ELEMENTS, and sparse: class and shape alone would admit each of
// these, so the flag is the only clause that can refuse them. Paths are by name from the
// entry down. The Parameters' grids would sit on two rows each — the entry row, which
// shows its Value's literal, and the Value row itself.
const SPARSE = [
  'spAllZero', 'spBig', 'spComplex', 'spDiag', 'spLogical', 'spNonFinite', 'spSingle',
  'pSp', 'pSp/Value', 'pSpComplex', 'pSpComplex/Value', 'pSpLogical', 'pSpLogical/Value',
  'st/sp',
];

// The dense twins, with the cell count of each grid: the same classes and shapes.
const DENSE: Record<string, number> = {
  dAllZero: 12, dComplex: 12, dDiag: 100, dLogical: 6, dNonFinite: 4, dSingle: 6,
  pDense: 9, 'pDense/Value': 9,
};

// The nodes the paths name, which are MatlabVariableNodes: an entry row's own grid lives on
// its Value child, so the node to ask about `pSp` is `pSp/Value`.
const owner = (path: string) => (/^p[A-Z]/.test(path) && !path.endsWith('/Value') ? `${path}/Value` : path);

interface Venue {
  file: string;
  root: () => any;
  rows: (root: any) => any[];
}

const VENUES: Venue[] = [
  {
    file: 'sparse_values.mat',
    root: () => getModelFromBytes('sng://sparse_values.mat', 'sparse_values.mat', bytes('sparse_values.mat')),
    rows: (root) => buildMatRows(root),
  },
  {
    file: 'sparse_text.sldd',
    root: () => getModel('sng://sparse_text.sldd', 'sparse_text.sldd', readFileSync(fixturePath('sparse_text.sldd'), 'utf8')),
    rows: (root) => buildRows(root),
  },
  {
    file: 'sparse_binary.sldd',
    root: () => getModelFromBytes('sng://sparse_binary.sldd', 'sparse_binary.sldd', bytes('sparse_binary.sldd')),
    rows: (root) => buildRows(root),
  },
  {
    file: 'sparse_ws.slx',
    root: () => getModelFromBytes('sng://sparse_ws.slx', 'sparse_ws.slx', bytes('sparse_ws.slx')),
    rows: (root) => buildRows(root),
  },
];

function load(venue: Venue): any {
  invalidate(`sng://${venue.file}`);
  return venue.root();
}

// The node at an entry path. A .mat's variables are its root's children; a dictionary's and
// a model's entries are one level further down, under their section.
function nodeAt(root: any, path: string): any {
  const [first, ...rest] = path.split('/');
  const entries: any[] = (root.children ?? []).flatMap((c: any) =>
    c.name === first ? [c] : (c.children ?? []).filter((e: any) => e.name === first),
  );
  expect(entries.length, `exactly one entry named ${first}`).toBe(1);
  let node = entries[0];
  for (const name of rest) {
    node = (node.children ?? []).find((c: any) => c.name === name);
    expect(node, `${path}: no child named ${name}`).toBeTruthy();
  }
  return node;
}

// Each row by its path of Name labels from the entry down. Section headers are not part of
// a path; a .mat has none.
function rowsByPath(rows: any[]): Map<string, any> {
  const byId = new Map(rows.map((r) => [r.ID, r]));
  const pathOf = (row: any): string => {
    const parent = byId.get(row.parent);
    const label = String(row.Name?.label ?? row.Name);
    return parent && !String(parent.ID).startsWith('section:') ? `${pathOf(parent)}/${label}` : label;
  };
  const out = new Map<string, any>();
  for (const row of rows) if (!String(row.ID).startsWith('section:')) out.set(pathOf(row), row);
  return out;
}

const stampedPaths = (rows: any[]) =>
  [...rowsByPath(rows)].filter(([, r]) => r._matrix).map(([p]) => p).sort();

// The Value property's matrix descriptor, as the Properties panel builds it for `node`.
const piMatrix = (node: any) =>
  buildPropertyGroups(node).flatMap((g) => g.properties).find((p) => p.name === 'Value')?.matrix;

describe('the sparse fixtures are the ones these tests were written against', () => {
  it('reads the core version it gates on', () => {
    expect(coreVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  for (const venue of VENUES) {
    it(`${venue.file} holds every path named above`, () => {
      const root = load(venue);
      for (const path of [...SPARSE, ...Object.keys(DENSE)]) expect(nodeAt(root, path)).toBeTruthy();
    });
  }
});

describe('a sparse array gets no grid, in every format it arrives in (core >= 1.36.3)', () => {
  for (const venue of VENUES) {
    it.skipIf(!SPARSE_HAS_NO_GRID)(`${venue.file}: core marks it sparse, and the flag alone refuses it`, () => {
      const root = load(venue);
      for (const path of SPARSE) {
        const node = nodeAt(root, owner(path));
        expect(node.isSparse, `${path} isSparse`).toBe(true);
        expect(node.displayElements(), `${path} displayElements`).toBeNull();
        expect(isGriddable(node), `${path} griddable`).toBe(false);
        // The same node with the flag hidden passes the gate: what refuses it is the
        // flag, not its shape or its class.
        const unflagged = Object.create(node, { isSparse: { value: undefined } });
        expect(isGriddable(unflagged), `${path} griddable without the flag`).toBe(true);
      }
      // And a dense array answers false, not undefined, which the gate must not read as sparse.
      for (const path of Object.keys(DENSE)) expect(nodeAt(root, owner(path)).isSparse, path).toBe(false);
    });

    it.skipIf(!SPARSE_HAS_NO_GRID)(`${venue.file}: no row, no property and no fetch offers a grid of it`, () => {
      const root = load(venue);
      const rows = rowsByPath(venue.rows(root));
      // The rows are there — what is missing is only the glyph.
      for (const path of SPARSE) expect(rows.get(path), `a row for ${path}`).toBeTruthy();
      // EXACTLY the dense twins are stamped: no sparse row, and nothing else either.
      expect(stampedPaths(venue.rows(root))).toEqual(Object.keys(DENSE).sort());
      for (const path of SPARSE) {
        const node = nodeAt(root, path);
        // A fetch for it — from a panel opened before a repaint, say — answers with the
        // reason, never with cells.
        const answer = matrixCellsMessage(node.id, node);
        expect(answer.matrix, `${path} fetch`).toBeUndefined();
        expect(answer.message).toBe('This value could not be read as a table.');
      }
      for (const name of ['pSp', 'pSpComplex', 'pSpLogical']) {
        expect(piMatrix(nodeAt(root, name)), `${name} in the Properties panel`).toBeUndefined();
      }
    });
  }
});

describe('a dense array of the same shape keeps its grid, on any core', () => {
  for (const venue of VENUES) {
    it(`${venue.file}: every dense twin is stamped, fetches its cells, and has its Properties glyph`, () => {
      const root = load(venue);
      const stamped = stampedPaths(venue.rows(root));
      for (const [path, cells] of Object.entries(DENSE)) {
        expect(stamped, `${path} is stamped`).toContain(path);
        const node = nodeAt(root, path);
        expect(matrixPayload(node)?.cells.length, `${path} cells`).toBe(cells);
        expect(matrixCellsMessage(node.id, node).matrix?.cells.length, `${path} fetch`).toBe(cells);
      }
      expect(piMatrix(nodeAt(root, 'pDense'))?.name).toBe('pDense.Value');
    });
  }
});
