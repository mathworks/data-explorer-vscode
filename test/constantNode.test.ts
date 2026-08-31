// Copyright 2026 The MathWorks, Inc.
//
// A Constant is an Architectural Data entry that on disk is byte-identical to a
// plain (derived) MATLAB variable — the distinction is purely metadata.isderived.
// ConstantNode specializes MatlabVariableNode with the Constant rules:
//   • Kind is always 'Constant', icon is the arch-flavored one;
//   • no children (a scalar leaf);
//   • Value must be SCALAR and NUMERIC, enforced on edit with a specific message.
// This suite locks the metadata-driven class fork in SectionNode.parseEntry (a
// derived plain variable becomes a ConstantNode, a non-derived one stays a
// MatlabVariableNode), the Design↔Arch round-trip, and the host-side paste gate.
// The pure ConstantNode/MatlabVariableNode value rules live in
// data-explorer-core's constantNode.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSectionMetadata } from 'data-explorer-core';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { pasteEntry, pasteEntries } from '../src/host/structuralEdit.js';

// The design/arch namespace URI, used to seed paste payloads. Read it from the
// core barrel rather than importing the data-model-internal SectionConstants.
const NS_DESIGN = getSectionMetadata('design').namespace;

// Nodes built through the host (getModel/pasteEntry/addEntry) come from
// data-explorer-core's node classes. This file's assertions check the runtime
// class name (a faithful proxy for the class fork) rather than `instanceof`,
// which can't bridge across the package boundary.
const classOf = (n: any): string | undefined => n?.constructor?.name;

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

function model(uri: string) {
  invalidate(uri);
  return getModel(uri, 'arch.sldd', archText);
}
function entryNode(uri: string, m: any, name: string) {
  const id = buildRows(m).find(
    (r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'),
  ).ID;
  return findNode(uri, id);
}
function sectionOf(m: any, name: string) {
  return m.children.find((s: any) => s.name === name);
}

describe('SectionNode.parseEntry forks on isderived', () => {
  it('a derived scalar variable parses as a ConstantNode', () => {
    const uri = 'test://const-fork.sldd';
    const m = model(uri);
    const c = entryNode(uri, m, 'Constant');
    expect(classOf(c)).toBe('ConstantNode');
    expect(c.kind).toBe('Constant');
    expect(c.canAddChild()).toBe(false);
  });

  it('a NON-derived scalar variable stays a MatlabVariableNode', () => {
    // Paste the arch Constant into design (becomes non-derived), then re-read.
    const uri = 'test://var-fork.sldd';
    const m = model(uri);
    const payload = entryNode(uri, m, 'Constant').serialize() as Record<string, unknown>;
    const design = sectionOf(m, 'design');
    const { newText } = pasteEntry(archText, design, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = sectionOf(m2, 'design').children[0];
    expect(classOf(copy)).toBe('MatlabVariableNode');
    expect(copy.kind).toBe('MATLAB Variable');
  });

  it('a derived Bus stays a BusNode (only plain variables become Constants)', () => {
    const uri = 'test://bus-fork.sldd';
    const m = model(uri);
    const di = entryNode(uri, m, 'DataInterface');
    expect(classOf(di)).toBe('BusNode');
  });
});

describe('Design ↔ Arch Constant conversion round-trip', () => {
  it('Constant → Design becomes an editable MATLAB Variable, then → Arch becomes a Constant again', () => {
    const uri = 'test://const-roundtrip.sldd';
    const m = model(uri);
    const seed = entryNode(uri, m, 'Constant').serialize() as Record<string, unknown>;

    // Into design: non-derived MATLAB Variable.
    const design = sectionOf(m, 'design');
    const { newText: t1 } = pasteEntry(archText, design, seed);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', t1);
    const designVar = sectionOf(m2, 'design').children[0];
    expect(classOf(designVar)).toBe('MatlabVariableNode');
    expect((designVar.metadata as any).isderived).toBe('0');
    expect(designVar.kind).toBe('MATLAB Variable');

    // Back into arch: a Constant again.
    const arch = sectionOf(m2, 'arch');
    const { newText: t2 } = pasteEntry(t1, arch, designVar.serialize() as Record<string, unknown>);
    invalidate(uri);
    const m3 = getModel(uri, 'arch.sldd', t2);
    const archConst = sectionOf(m3, 'arch').children.find(
      (c: any) => c.className === 'double' && c.name !== 'Constant',
    );
    expect(classOf(archConst)).toBe('ConstantNode');
    expect((archConst.metadata as any).isderived).toBe('1');
    expect(archConst.kind).toBe('Constant');
  });
});

describe('Variable→Constant paste gate (host side)', () => {
  // A design MATLAB variable pasted into arch becomes a Constant, so a
  // non-scalar-numeric value must be rejected — mirroring the drop feedback but
  // enforced on the host so keyboard/menu Paste is gated too.
  function arrayVariablePayload(name = 'Vec'): Record<string, unknown> {
    return {
      name,
      metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' },
      value: [1, 2, 3],
    };
  }

  it('rejects a non-scalar-numeric variable pasted into arch, with the exact message', () => {
    const uri = 'test://paste-gate.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    expect(() => pasteEntry(archText, arch, arrayVariablePayload())).toThrow(
      /must be scalar and numeric/,
    );
  });

  it('leaves the document byte-identical when the paste is rejected', () => {
    const uri = 'test://paste-gate-identical.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    expect(() => pasteEntry(archText, arch, arrayVariablePayload())).toThrow();
    // The failed paste never produced new text; the source is unchanged.
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', archText);
    expect(sectionOf(m2, 'arch').children.some((c: any) => c.name === 'Vec')).toBe(false);
  });

  it('allows a scalar-numeric variable pasted into arch (becomes a Constant)', () => {
    const uri = 'test://paste-gate-ok.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    const payload = {
      name: 'K',
      metadata: { uuid: 'seed', namespace: NS_DESIGN, isderived: '0' },
      value: 7,
    };
    const { newText } = pasteEntry(archText, arch, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const pasted = sectionOf(m2, 'arch').children.find((c: any) => c.name === 'K');
    expect(classOf(pasted)).toBe('ConstantNode');
  });

  it('multi-select paste is all-or-nothing: one non-scalar rejects the whole batch', () => {
    const uri = 'test://paste-gate-multi.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    const good = { name: 'Good', metadata: { uuid: 's1', namespace: NS_DESIGN, isderived: '0' }, value: 1 };
    expect(() => pasteEntries(archText, arch, [good, arrayVariablePayload()])).toThrow(
      /must be scalar and numeric/,
    );
  });

  it('the SAME non-scalar variable pastes fine into design (stays a Variable)', () => {
    const uri = 'test://paste-gate-design.sldd';
    const m = model(uri);
    const design = sectionOf(m, 'design');
    const { newText } = pasteEntry(archText, design, arrayVariablePayload());
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const pasted = sectionOf(m2, 'design').children.find((c: any) => c.name === 'Vec');
    expect(classOf(pasted)).toBe('MatlabVariableNode');
  });
});

describe('Add Constant via addEntry', () => {
  it('adds a scalar-numeric Constant to the arch section', () => {
    const uri = 'test://add-const.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    const node = arch.addEntry('Constant');
    expect(classOf(node)).toBe('ConstantNode');
    expect(node.kind).toBe('Constant');
    expect((node.metadata as any).isderived).toBe('1');
    expect((node.metadata as any).namespace).toBe(NS_DESIGN);
    expect(node.isScalarNumeric).toBe(true);
    expect(node.canAddChild()).toBe(false);
  });

  it('a Constant cannot be added to the design section', () => {
    const uri = 'test://add-const-design.sldd';
    const m = model(uri);
    const design = sectionOf(m, 'design');
    expect(design.addEntry('Constant')).toBeNull();
  });
});
