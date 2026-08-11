// Copyright 2026 The MathWorks, Inc.
//
// Regression coverage for "Add Child" on a ServiceBus (Architectural Data
// ServiceInterface). Adding a child must create a new Simulink.FunctionElement
// whose JSON matches the existing function-element structure:
//   - Prototype "y = fn(u,v)" where n is an increasing number (unique name fn),
//   - an Arguments BusElement array [u, v, y],
//   - Asynchronous: false,
//   - a unique _id on the element AND on each argument (no collision with the
//     ids already consumed by sibling elements' nested arguments),
// and the parent Elements_internal._dimensions must track the element count.
import { describe, it, expect } from 'vitest';
import { ServiceBusNode } from '../src/dex/datamodel/node/data/ServiceBusNode.js';

// One Simulink.BusElement argument.
function arg(id: string, name: string): Record<string, unknown> {
  return {
    _id: id,
    _properties: { Complexity: 'real', Dimensions: 1, DimensionsMode: 'Fixed', DocUnits: '', Name: name },
  };
}

// One Simulink.FunctionElement, mirroring the arch.sldd ServiceInterface shape.
function funcElem(
  id: string,
  name: string,
  prototype: string,
  args: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    _id: id,
    _properties: {
      Arguments: { _array_class: 'Simulink.BusElement', _dimensions: [args.length, 1], _elements: args },
      Asynchronous: false,
      Name: name,
      Prototype: prototype,
    },
  };
}

// A ServiceBus value carrying two function elements (f, f1) exactly like the
// arch.sldd ServiceInterface entry: f uses ids 2/3/4/5, f1 uses 6/7/8/9/10.
function serviceBusRaw(): Record<string, unknown> {
  return {
    _array_class: 'Simulink.ServiceBus',
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [
      {
        _id: '1',
        _properties: {
          Description: '',
          Elements_internal: {
            _array_class: 'Simulink.FunctionElement',
            _dimensions: [2, 1],
            _elements: [
              funcElem('2', 'f', 'y = f(u,v)', [arg('3', 'u'), arg('4', 'v'), arg('5', 'y')]),
              funcElem('6', 'f1', 'y = f1(u,v,w,y)', [
                arg('7', 'u'),
                arg('8', 'v'),
                arg('9', 'w'),
                arg('10', 'y'),
              ]),
            ],
          },
        },
      },
    ],
  };
}

// Collect every _id string found anywhere in a serialized value.
function collectIds(o: unknown, out: string[] = []): string[] {
  if (o && typeof o === 'object') {
    const rec = o as Record<string, unknown>;
    if (typeof rec._id === 'string') out.push(rec._id);
    for (const k of Object.keys(rec)) collectIds(rec[k], out);
  }
  return out;
}

describe('addChild on a ServiceBus (arch ServiceInterface)', () => {
  it('creates a FunctionElement with Prototype y = fn(u,v) and a full Arguments array', () => {
    const bus = ServiceBusNode.parse(serviceBusRaw(), 'MyService', null);
    expect(bus.canAddChild()).toBe(true);
    const before = bus.children.length;

    const child = bus.addChildNode();
    expect(child).toBeTruthy();
    // The number increases past the existing f/f1, so the new function is f2.
    expect(child!.name).toBe('f2');

    const value = bus.serializeValue() as Record<string, unknown>;
    // Must be JSON-serializable.
    expect(() => JSON.parse(JSON.stringify(value))).not.toThrow();

    const ei = ((value._elements as Record<string, unknown>[])[0]._properties as Record<string, unknown>)
      .Elements_internal as Record<string, unknown>;
    const elems = ei._elements as Record<string, unknown>[];
    // Element count grew and _dimensions tracks it (column vector).
    expect(elems.length).toBe(before + 1);
    expect(ei._dimensions).toEqual([before + 1, 1]);

    const newElem = elems[elems.length - 1];
    const props = newElem._properties as Record<string, unknown>;
    expect(props.Name).toBe('f2');
    expect(props.Prototype).toBe('y = f2(u,v)');
    expect(props.Asynchronous).toBe(false);

    // Arguments must be a Simulink.BusElement array [u, v, y].
    const argsWrap = props.Arguments as Record<string, unknown>;
    expect(argsWrap._array_class).toBe('Simulink.BusElement');
    expect(argsWrap._dimensions).toEqual([3, 1]);
    const argEls = argsWrap._elements as Record<string, unknown>[];
    expect(argEls.map((a) => (a._properties as Record<string, unknown>).Name)).toEqual(['u', 'v', 'y']);
    for (const a of argEls) {
      const ap = a._properties as Record<string, unknown>;
      expect(ap).toMatchObject({ Complexity: 'real', Dimensions: 1, DimensionsMode: 'Fixed', DocUnits: '' });
    }

    // Every _id across the whole entry must be unique — the new element and its
    // arguments must not collide with the ids already used by f/f1's arguments.
    const ids = collectIds(value);
    expect(new Set(ids).size).toBe(ids.length);
    // The new element + its 3 args added 4 fresh ids beyond the original 10.
    expect(ids.length).toBe(10 + 4);
  });
});
