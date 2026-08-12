// Copyright 2026 The MathWorks, Inc.
//
// A Constant is an Architectural Data entry that on disk is byte-identical to a
// plain (derived) MATLAB variable — the distinction is purely metadata.isderived.
// ConstantNode specializes MatlabVariableNode with the Constant rules:
//   • Kind is always 'Constant', icon is the arch-flavored one;
//   • no children (a scalar leaf);
//   • Value must be SCALAR and NUMERIC, enforced on edit with a specific message.
// This suite locks those rules down, plus the metadata-driven class fork in
// SectionNode.parseEntry (a derived plain variable becomes a ConstantNode, a
// non-derived one stays a MatlabVariableNode) and the Design↔Arch round-trip.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ConstantNode from '../src/dex/datamodel/node/data/ConstantNode.js';
import MatlabVariableNode from '../src/dex/datamodel/node/data/MatlabVariableNode.js';
import { BusNode } from '../src/dex/datamodel/node/data/BusNode.js';
import { parsedIsScalarNumeric } from '../src/dex/datamodel/parser/MatlabValueParser.js';
import MatlabValueParser from '../src/dex/datamodel/parser/MatlabValueParser.js';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { pasteEntry, pasteEntries } from '../src/host/structuralEdit.js';
import { NS_DESIGN } from '../src/dex/datamodel/SectionConstants.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

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

describe('parsedIsScalarNumeric truth table', () => {
  const scalarNumeric = ['5', '3.14', '-2', 'true', 'false', '1+2i'];
  for (const expr of scalarNumeric) {
    it(`accepts scalar numeric ${expr}`, () => {
      expect(parsedIsScalarNumeric(MatlabValueParser.parse(expr))).toBe(true);
    });
  }
  const notScalarNumeric = ["'hello'", '"world"', '[1 2 3]', '[1 2; 3 4]', '{1, 2}'];
  for (const expr of notScalarNumeric) {
    it(`rejects non-scalar-numeric ${expr}`, () => {
      expect(parsedIsScalarNumeric(MatlabValueParser.parse(expr))).toBe(false);
    });
  }
  it('rejects a null parse (unparseable expression)', () => {
    expect(parsedIsScalarNumeric(null)).toBe(false);
  });
});

describe('MatlabVariableNode.isScalarNumeric', () => {
  it('is true for a scalar double', () => {
    expect(MatlabVariableNode.parse(3.14, 'x', null).isScalarNumeric).toBe(true);
  });
  it('is true for a scalar logical', () => {
    expect(MatlabVariableNode.parse(true, 'b', null).isScalarNumeric).toBe(true);
  });
  it('is false for a char', () => {
    expect(MatlabVariableNode.parse('hi', 'c', null).isScalarNumeric).toBe(false);
  });
  it('is false for a numeric array', () => {
    expect(MatlabVariableNode.parse([1, 2, 3], 'v', null).isScalarNumeric).toBe(false);
  });
  it('is false for a struct', () => {
    const s = MatlabVariableNode.parse(0, 's', null);
    s._kind = 'scalar';
    s._scalarType = 'struct';
    expect(s.isScalarNumeric).toBe(false);
  });
});

describe('ConstantNode identity and structure', () => {
  it('reports Kind "Constant" and the typeConstant icon', () => {
    const c = ConstantNode.createDefault('Const', null);
    expect(c).toBeInstanceOf(ConstantNode);
    expect(c.kind).toBe('Constant');
    expect(c.icon).toBe('typeConstant');
  });

  it('never allows children (a scalar leaf)', () => {
    const c = ConstantNode.createDefault('Const', null);
    expect(c.canAddChild()).toBe(false);
  });

  it('defaultName is "Const"', () => {
    expect(ConstantNode.defaultName).toBe('Const');
  });
});

describe('ConstantNode value validation on edit', () => {
  it('accepts a scalar numeric value', () => {
    const c = ConstantNode.createDefault('K', null);
    expect(c.setProperty('Value', '42')).toBe(true);
    expect(c.displayValue).toBe('42');
  });

  it('rejects a non-scalar (array) value with the exact message', () => {
    const c = ConstantNode.createDefault('K', null);
    const result = c.setProperty('Value', '[1 2 3]');
    expect(result).not.toBe(true);
    expect((result as any).error).toBe(true);
    expect((result as any).reason).toBe("The value for constant 'K' must be scalar and numeric.");
    // Rejected edits leave the value untouched.
    expect(c.displayValue).toBe('0');
  });

  it('rejects a char value with the exact message', () => {
    const c = ConstantNode.createDefault('MyConst', null);
    const result = c.setProperty('Value', "'hello'");
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe("The value for constant 'MyConst' must be scalar and numeric.");
  });

  it('rejects an unparseable value as an invalid expression', () => {
    const c = ConstantNode.createDefault('K', null);
    const result = c.setProperty('Value', 'int8(5)');
    expect(result).not.toBe(true);
    expect((result as any).reason).toBe('Invalid MATLAB expression');
  });

  it('a well-formed scalar Constant is value-editable', () => {
    const c = ConstantNode.createDefault('K', null);
    expect(c.valueEditable).toBe(true);
  });
});

describe('SectionNode.parseEntry forks on isderived', () => {
  it('a derived scalar variable parses as a ConstantNode', () => {
    const uri = 'test://const-fork.sldd';
    const m = model(uri);
    const c = entryNode(uri, m, 'Constant');
    expect(c).toBeInstanceOf(ConstantNode);
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
    expect(copy).toBeInstanceOf(MatlabVariableNode);
    expect(copy).not.toBeInstanceOf(ConstantNode);
    expect(copy.kind).toBe('MATLAB Variable');
  });

  it('a derived Bus stays a BusNode (only plain variables become Constants)', () => {
    const uri = 'test://bus-fork.sldd';
    const m = model(uri);
    const di = entryNode(uri, m, 'DataInterface');
    expect(di).toBeInstanceOf(BusNode);
    expect(di).not.toBeInstanceOf(ConstantNode);
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
    expect(designVar).toBeInstanceOf(MatlabVariableNode);
    expect(designVar).not.toBeInstanceOf(ConstantNode);
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
    expect(archConst).toBeInstanceOf(ConstantNode);
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
    expect(pasted).toBeInstanceOf(ConstantNode);
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
    expect(pasted).toBeInstanceOf(MatlabVariableNode);
    expect(pasted).not.toBeInstanceOf(ConstantNode);
  });
});

describe('Add Constant via addEntry', () => {
  it('adds a scalar-numeric Constant to the arch section', () => {
    const uri = 'test://add-const.sldd';
    const m = model(uri);
    const arch = sectionOf(m, 'arch');
    const node = arch.addEntry('Constant');
    expect(node).toBeInstanceOf(ConstantNode);
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
