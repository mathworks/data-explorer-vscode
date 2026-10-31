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
// MatlabVariableNode) on a model read through view's document registry. The
// Design↔Arch round-trip, the paste gate and Add Constant are core's, and pinned
// there (data-explorer-core's constantNode.test.ts and constantNodeText.test.ts),
// with the pure ConstantNode/MatlabVariableNode value rules.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pasteEntry } from 'data-explorer-core';
import { buildRows } from 'data-explorer-view/model';
import { getModel, findNode, invalidate } from 'data-explorer-view/host';

// Nodes built through the host (getModel, core's pasteEntry) come from
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
