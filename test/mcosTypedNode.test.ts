// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
// Importing the class map registers the NodeRegistry the adapter routes through.
import '../src/dex/datamodel/node/NodeClassMap.js';
import { buildTypedNodeFromMcos } from '../src/dex/datamodel/node/data/mcosTypedNode.js';
import ParameterNode from '../src/dex/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/dex/datamodel/node/data/SignalNode.js';
import { BusNode } from '../src/dex/datamodel/node/data/BusNode.js';
import LookupTableNode from '../src/dex/datamodel/node/data/LookupTableNode.js';
import NumericTypeNode from '../src/dex/datamodel/node/data/NumericTypeNode.js';
import BreakpointNode from '../src/dex/datamodel/node/data/BreakpointNode.js';
import VariantControlNode from '../src/dex/datamodel/node/data/VariantControlNode.js';

// The binary (.slx / .mat) path decodes an opaque Simulink object; the adapter
// turns it into the SAME node class the SLDD (JSON) path builds, so class and
// icon are consistent across formats — one node class per entry type.
//
// Deliberately CLASS-ONLY: the MCOS decoder's property extraction is unreliable
// (verified against a real model.slx — a Signal decoded with Max="Table", a
// Parameter with an empty Value), so the adapter ignores the decoded property
// bag entirely and builds an EMPTY SHELL from the class name alone. Correct
// class + icon, empty columns, no children. Real property extraction is a
// separate McosParser fix. Because it needs only the class name — which comes
// from the variable's own metadata — it works even for opaque objects the
// decoder cannot locate an anchor for.

describe('buildTypedNodeFromMcos — unifies node class across formats (class only)', () => {
  it('routes Parameter/Signal to their typed classes', () => {
    expect(buildTypedNodeFromMcos('Simulink.Parameter', 'K', null)).toBeInstanceOf(ParameterNode);
    expect(buildTypedNodeFromMcos('Simulink.Signal', 's', null)).toBeInstanceOf(SignalNode);
  });

  it('routes the previously-opaque types to their typed classes too', () => {
    expect(buildTypedNodeFromMcos('Simulink.LookupTable', 'L', null)).toBeInstanceOf(LookupTableNode);
    expect(buildTypedNodeFromMcos('Simulink.NumericType', 'N', null)).toBeInstanceOf(NumericTypeNode);
    expect(buildTypedNodeFromMcos('Simulink.Breakpoint', 'B', null)).toBeInstanceOf(BreakpointNode);
    expect(buildTypedNodeFromMcos('Simulink.VariantControl', 'V', null)).toBeInstanceOf(VariantControlNode);
    expect(buildTypedNodeFromMcos('Simulink.Bus', 'Bus', null)).toBeInstanceOf(BusNode);
  });

  it('builds an EMPTY SHELL — never surfaces any decoded property values', () => {
    const p = buildTypedNodeFromMcos('Simulink.Parameter', 'K', null) as ParameterNode;
    expect(p.Value).toBeUndefined();
    expect(p.Min).toBeUndefined();
    expect(p.Max).toBeUndefined();
    expect(p.Unit).toBe('');
    expect(p.Description).toBe('');
    // An empty Parameter Value formats as MATLAB's empty display '[ ]' — the
    // honest representation of "no value".
    expect(p.displayValue).toBe('[ ]');

    const s = buildTypedNodeFromMcos('Simulink.Signal', 's', null) as SignalNode;
    expect(s.Max).toBeUndefined();
    expect(s.Description).toBe('');
    expect(s.displayValue).toBe('');
  });

  it('builds Bus with no element children (deferred to decoder handle-resolution)', () => {
    const b = buildTypedNodeFromMcos('Simulink.Bus', 'Bus', null) as BusNode;
    expect(b.className).toBe('Simulink.Bus');
    expect(b.children.length).toBe(0);
    expect(b.dataType).toBe('');
  });

  it('returns null for classes with no typed node (stay opaque)', () => {
    // Simulink.DataStore exists in real models but has no typed node in CLASS_MAP.
    expect(buildTypedNodeFromMcos('Simulink.DataStore', 'ds', null)).toBeNull();
    expect(buildTypedNodeFromMcos('SomeUnknown.Class', 'x', null)).toBeNull();
  });

  it('returns null for generic (non-Simulink-object) registry keys', () => {
    // A plain MATLAB variable/struct is handled by its own path, not here.
    expect(buildTypedNodeFromMcos('MatlabVariable', 'v', null)).toBeNull();
    expect(buildTypedNodeFromMcos('MatlabStruct', 'v', null)).toBeNull();
    expect(buildTypedNodeFromMcos('CustomObject', 'v', null)).toBeNull();
    expect(buildTypedNodeFromMcos('', 'v', null)).toBeNull();
  });
});
