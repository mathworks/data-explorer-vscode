// Copyright 2026 The MathWorks, Inc.
//
// Regression coverage for "Add Child" on a Bus in a text (JSON) sldd: the new
// BusElement must (1) grow Elements_internal._dimensions to match the element
// count, and (2) carry a unique _id within the entry's id namespace.
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

function busEntry(uri: string) {
  invalidate(uri);
  const model = getModel(uri, 'params.sldd', fixtureText);
  const id = buildRows(model).find(
    (r: any) => r.Name?.label === 'MyBus' && !String(r.ID).startsWith('section:'),
  ).ID;
  return findNode(uri, id);
}

// Locate the Simulink.Bus value object in a parsed sldd JSON.
function findBusValue(o: any): any {
  if (o && typeof o === 'object') {
    if (o._array_class === 'Simulink.Bus') return o;
    for (const k of Object.keys(o)) {
      const r = findBusValue(o[k]);
      if (r) return r;
    }
  }
  return null;
}

describe('addChild on a Bus (text sldd)', () => {
  it('grows Elements_internal._dimensions and assigns a unique _id to the new element', () => {
    const uri = 'test://bus-add-child.sldd';
    const bus = busEntry(uri);
    expect(bus.canAddChild()).toBe(true);
    const before = bus.children.length;

    const { newText } = addChild(fixtureText, bus);
    expect(() => JSON.parse(newText)).not.toThrow();

    const busVal = findBusValue(JSON.parse(newText));
    const ei = busVal._elements[0]._properties.Elements_internal;

    // The element array grew by one.
    expect(ei._elements.length).toBe(before + 1);
    // Issue 1: _dimensions must track the element count.
    expect(ei._dimensions).toEqual([before + 1, 1]);

    // Issue 2: every element carries a unique, non-empty _id.
    const ids = ei._elements.map((e: any) => e._id);
    expect(ids.every((id: any) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // The new element's _id is also distinct from the bus wrapper's _id.
    expect(ids).not.toContain(busVal._elements[0]._id);
  });
});
