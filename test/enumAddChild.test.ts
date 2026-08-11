// Copyright 2026 The MathWorks, Inc.
//
// Regression coverage for "Add Child" on an EnumType in a text (JSON) sldd: the
// new enumeral must (1) grow Enumerals._dimensions to match the element count,
// and (2) carry a STRING Value ("3"), never a numeric one (3), to match how
// existing enumerals store their value.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { addChild } from '../src/host/structuralEdit.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('./parity/artifacts/text/params.sldd', import.meta.url)),
  'utf8',
);

function enumEntry(uri: string) {
  invalidate(uri);
  const model = getModel(uri, 'params.sldd', fixtureText);
  const id = buildRows(model).find(
    (r: any) => r.Name?.label === 'MyEnum' && !String(r.ID).startsWith('section:'),
  ).ID;
  return findNode(uri, id);
}

// Locate the Enumerals struct in a parsed sldd JSON.
function findEnumerals(o: any): any {
  if (o && typeof o === 'object') {
    if (o._array_class === 'Simulink.data.dictionary.EnumTypeDefinition') {
      return o._elements[0]._properties.Enumerals;
    }
    for (const k of Object.keys(o)) {
      const r = findEnumerals(o[k]);
      if (r) return r;
    }
  }
  return null;
}

describe('addChild on an EnumType (text sldd)', () => {
  it('grows Enumerals._dimensions and gives the new enumeral a string Value', () => {
    const uri = 'test://enum-add-child.sldd';
    const en = enumEntry(uri);
    expect(en.canAddChild()).toBe(true);
    const before = en.children.length;

    const { newText } = addChild(fixtureText, en);
    expect(() => JSON.parse(newText)).not.toThrow();

    const enumerals = findEnumerals(JSON.parse(newText));
    // The element array grew by one.
    expect(enumerals._elements.length).toBe(before + 1);
    // Issue 1: _dimensions must track the element count (row vector).
    expect(enumerals._dimensions).toEqual([1, before + 1]);

    // Issue 2: every enumeral Value is a string, including the new one.
    const values = enumerals._elements.map((e: any) => e.Value);
    expect(values.every((v: unknown) => typeof v === 'string')).toBe(true);
  });
});
