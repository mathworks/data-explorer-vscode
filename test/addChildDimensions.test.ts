// Copyright 2026 The MathWorks, Inc.
//
// "Add Child" must be disabled for 2-D (and higher) matrices: you cannot append
// a single element to a matrix and keep it rectangular. Row/column vectors and
// scalars-that-are-containers stay addable. This drives the real model against
// the fixture and asserts canAddChild() per entry.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
  'utf8',
);

function entryNode(uri: string, name: string): any {
  invalidate(uri);
  const model = getModel(uri, 'data.sldd', fixtureText);
  const id = buildRows(model).find(
    (r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'),
  ).ID;
  return findNode(uri, id);
}

function canAddChildFor(uri: string, name: string): boolean {
  const node = entryNode(uri, name);
  return typeof node.canAddChild === 'function' && node.canAddChild();
}

// A matrix element can be removed only if its parent (the matrix) allows it.
function canRemoveElementFor(uri: string, name: string): boolean {
  const node = entryNode(uri, name);
  return typeof node.canRemoveChild === 'function' && node.canRemoveChild();
}

describe('Add Child is disabled for 2-D+ matrices', () => {
  it('a cell matrix (2x2) cannot add a child', () => {
    expect(canAddChildFor('test://cellmatrix.sldd', 'CellMatrix')).toBe(false);
  });

  it('a string matrix (2x2) cannot add a child', () => {
    expect(canAddChildFor('test://stringmatrix.sldd', 'stringMatrix')).toBe(false);
  });

  it('a numeric matrix (2x2) cannot add a child', () => {
    expect(canAddChildFor('test://matrix.sldd', 'Matrix')).toBe(false);
  });

  it('a struct matrix (2x2) cannot add a child', () => {
    expect(canAddChildFor('test://structmatrix.sldd', 'structMatrix')).toBe(false);
  });

  it('a scalar string cannot add a child', () => {
    expect(canAddChildFor('test://scalarstring.sldd', 'string')).toBe(false);
  });

  it('row/column vectors and containers stay addable', () => {
    expect(canAddChildFor('test://cellrow.sldd', 'CellArray')).toBe(true); // 1x3
    expect(canAddChildFor('test://cellcol.sldd', 'CellArray1')).toBe(true); // 3x1
    expect(canAddChildFor('test://strrow.sldd', 'stringArray')).toBe(true); // 1x3
    expect(canAddChildFor('test://strcol.sldd', 'stringVArray')).toBe(true); // 3x1
    expect(canAddChildFor('test://numrow.sldd', 'Array')).toBe(true); // 1x3
    expect(canAddChildFor('test://struct.sldd', 'Struct')).toBe(true); // 1x1
  });
});

describe('Remove Child is disabled for 2-D+ matrices', () => {
  it('a cell matrix (2x2) cannot remove a child', () => {
    expect(canRemoveElementFor('test://rm-cellmatrix.sldd', 'CellMatrix')).toBe(false);
  });

  it('a string matrix (2x2) cannot remove a child', () => {
    expect(canRemoveElementFor('test://rm-stringmatrix.sldd', 'stringMatrix')).toBe(false);
  });

  it('a numeric matrix (2x2) cannot remove a child', () => {
    expect(canRemoveElementFor('test://rm-matrix.sldd', 'Matrix')).toBe(false);
  });

  it('a struct matrix (2x2) cannot remove a child', () => {
    expect(canRemoveElementFor('test://rm-structmatrix.sldd', 'structMatrix')).toBe(false);
  });

  it('row/column vectors stay removable', () => {
    expect(canRemoveElementFor('test://rm-cellrow.sldd', 'CellArray')).toBe(true); // 1x3
    expect(canRemoveElementFor('test://rm-strrow.sldd', 'stringArray')).toBe(true); // 1x3
    expect(canRemoveElementFor('test://rm-numrow.sldd', 'Array')).toBe(true); // 1x3
  });
});
