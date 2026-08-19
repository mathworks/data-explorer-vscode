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
// The adapter takes an optional decoded `properties` bag (SLDD-shaped, produced by
// the McosParser table walk) and feeds it through the SAME NodeRegistry.parseValue
// the SLDD path uses, so decoded values populate the typed node. When no properties
// are supplied it falls back to an EMPTY SHELL from the class name alone — correct
// class + icon, empty columns, no children — which is what happens for objects the
// decoder could not resolve with confidence (never guess). The class always comes
// from the variable's own metadata, so class unification holds either way. The
// end-to-end property-value parity across formats is covered in
// test/mcosCrossFormat.test.ts.

describe('buildTypedNodeFromMcos — unifies node class + values across formats', () => {
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

  it('builds an EMPTY SHELL when no decoded properties are supplied', () => {
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

  it('surfaces decoded SLDD-shaped properties when supplied', () => {
    // The bag the McosParser table walk produces (binary exposes DocUnits; the
    // typed node maps it to Unit) fed through the same NodeRegistry.parseValue path.
    const p = buildTypedNodeFromMcos('Simulink.Parameter', 'K', null, {
      Value: 42,
      Min: -1,
      Max: 100,
      DocUnits: 'm/s',
      Description: 'hello',
    }) as ParameterNode;
    expect(p.displayValue).toBe('42');
    expect(p.Min).toBe(-1);
    expect(p.Max).toBe(100);
    expect(p.Unit).toBe('m/s');
    expect(p.Description).toBe('hello');
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

// The .slx and .mat paths both enter object expansion HERE: the MCOS decoder hands
// buildTypedNodeFromMcos a per-element `_properties` list plus the real dimensions,
// and the adapter must apply the SAME general array rule the SLDD paths do — expand
// a multi-element array into an ObjectNode container whose children are one scalar
// node per element (a KNOWN class → its typed node; a CUSTOM class → an ObjectNode).
// This is the format-independent proof for .slx/.mat known-class arrays; the raw
// decode of a real object handle into these elements is covered by
// mcosParser.test.ts (variableUsageArray.mat, 20x1) and mcosCrossFormat.test.ts.
describe('buildTypedNodeFromMcos — object ARRAYS (the .slx/.mat entry point)', () => {
  it('KNOWN class: a 3x1 Simulink.Parameter array becomes an ObjectNode of 3 ParameterNodes', () => {
    const node = buildTypedNodeFromMcos(
      'Simulink.Parameter',
      'p',
      null,
      null,
      [{ Value: 10 }, { Value: 20 }, { Value: 30 }],
      [3, 1],
    )!;
    expect(node.constructor.name).toBe('ObjectNode');
    expect(node.displayValue).toBe('<3x1 Simulink.Parameter>');
    expect(node.children).toHaveLength(3);
    node.children.forEach((child: any, i: number) => {
      expect(child).toBeInstanceOf(ParameterNode);
      expect(child._displayName).toBe(`p(${i + 1})`);
    });
    expect((node.children[0] as ParameterNode).Value).toBe(10);
    expect((node.children[2] as ParameterNode).Value).toBe(30);
  });

  it('CUSTOM class: a 2x1 Simulink.VariableUsage array becomes an ObjectNode of 2 ObjectNodes', () => {
    const node = buildTypedNodeFromMcos(
      'Simulink.VariableUsage',
      'u',
      null,
      null,
      [{ Name: 'Ka' }, { Name: 'Kf' }],
      [2, 1],
    )!;
    expect(node.constructor.name).toBe('ObjectNode');
    expect(node.displayValue).toBe('<2x1 Simulink.VariableUsage>');
    expect(node.children).toHaveLength(2);
    node.children.forEach((child: any, i: number) => {
      expect(child.constructor.name).toBe('ObjectNode');
      expect(child._displayName).toBe(`u(${i + 1})`);
    });
  });

  it('a SINGLE-element decode stays a scalar typed node (no array wrapper)', () => {
    const node = buildTypedNodeFromMcos(
      'Simulink.Parameter',
      'p',
      null,
      null,
      [{ Value: 7 }],
      [1, 1],
    )!;
    expect(node).toBeInstanceOf(ParameterNode);
    expect((node as ParameterNode).Value).toBe(7);
  });
});
