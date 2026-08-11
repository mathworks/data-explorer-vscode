// Copyright 2026 The MathWorks, Inc.
//
// Adding a child to a string array must append a bare empty string element, not
// wrap it in an inner array: ["abc","de","f"] -> ["abc","de","f",""], never
// ["abc","de","f",[""]].
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { addChild } from '../src/host/structuralEdit.js';

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

// Find a String-array value object by its element contents.
function findStringValue(o: any): any {
  if (o && typeof o === 'object') {
    if (o._array_type === 'String' && Array.isArray(o._elements)) return o;
    for (const k of Object.keys(o)) {
      const r = findStringValue(o[k]);
      if (r) return r;
    }
  }
  return null;
}

describe('addChild on a string array (text sldd)', () => {
  it('appends a bare empty string, not a nested array', () => {
    const uri = 'test://string-add-child.sldd';
    const node = entryNode(uri, 'stringArray');
    expect(node.canAddChild()).toBe(true);

    const { newText } = addChild(fixtureText, node);
    expect(() => JSON.parse(newText)).not.toThrow();

    const val = findStringValue(JSON.parse(newText));
    expect(val._elements).toEqual(['abc', 'de', 'f', '']);
    // No element is itself an array.
    expect(val._elements.every((e: unknown) => typeof e === 'string')).toBe(true);
  });
});
