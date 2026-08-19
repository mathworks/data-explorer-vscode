// Copyright 2026 The MathWorks, Inc.
//
// The "General" PI group surfaces Kind and Class as two DISTINCT identity rows:
//   Class = the raw class identity (e.g. 'Simulink.Parameter')
//   Kind  = the human-readable label  (e.g. 'Simulink Parameter')
// Both are computed live node getters, so they must resolve through their atoms
// (PropKind/PropClass), never schema hydration. This pins that Kind != Class for
// a mapped class, and that a node overriding kind() (ConstantNode) is respected.
import { describe, it, expect } from 'vitest';
import PropKind from '../../src/dex/datamodel/prop/PropKind.js';
import PropClass from '../../src/dex/datamodel/prop/PropClass.js';
import ParameterNode from '../../src/dex/datamodel/node/data/ParameterNode.js';
import ConstantNode from '../../src/dex/datamodel/node/data/ConstantNode.js';
import { BusNode } from '../../src/dex/datamodel/node/data/BusNode.js';
import '../../src/dex/datamodel/node/NodeClassMap.js';

describe('PropKind / PropClass atoms', () => {
  it('Parameter: Kind is human-readable, Class is the raw identity, and they differ', () => {
    const n = ParameterNode.createDefault('gravity', null) as any;
    expect(PropClass.readValue(n)).toBe('Simulink.Parameter');
    expect(PropKind.readValue(n)).toBe('Simulink Parameter');
    expect(PropKind.readValue(n)).not.toBe(PropClass.readValue(n));
  });

  it('Bus: Kind "Bus" vs Class "Simulink.Bus"', () => {
    const n = BusNode.createDefault('b', null) as any;
    expect(PropClass.readValue(n)).toBe('Simulink.Bus');
    expect(PropKind.readValue(n)).toBe('Bus');
  });

  it('Constant: an overriding kind() getter wins over the class map', () => {
    const n = ConstantNode.createDefault('k', null) as any;
    expect(PropKind.readValue(n)).toBe('Constant');
    // Class stays the raw variable class identity (a data type), never 'Constant'.
    expect(PropKind.readValue(n)).not.toBe(PropClass.readValue(n));
  });

  it('atoms are read-only and PI-only (no table column of their own)', () => {
    expect(PropKind.editor).toBe('label');
    expect(PropClass.editor).toBe('label');
    expect(PropKind.column).toBeNull();
    expect(PropClass.column).toBeNull();
  });
});
