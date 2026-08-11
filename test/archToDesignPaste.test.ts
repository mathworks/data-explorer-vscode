// Copyright 2026 The MathWorks, Inc.
//
// The escape hatch for read-only Arch Data: copy an arch (derived) entry and
// paste it into Design Data. The paste must:
//   1. Rewrite metadata so the copy belongs to the target section — both
//      namespace AND isderived (arch and design share one namespace; the
//      section split is purely isderived), so an arch entry pasted into design
//      becomes a genuine, editable, non-derived design entry.
//   2. Make the name unique across the COMBINED design+arch namespace, not just
//      the target section's own children (they share a namespace, so a name
//      collision across the two would be invalid).
//   3. Reject a payload whose type is not allowed in the target section — e.g.
//      a ServiceInterface (Simulink.ServiceBus) has no design-data equivalent.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { pasteEntry } from '../src/host/structuralEdit.js';
import { NS_DESIGN } from '../src/dex/datamodel/SectionConstants.js';

const archText = readFileSync(
  '/System/Volumes/Data/mathworks/devel/sandbox/weiwang/work/dex/data/arch.sldd',
  'utf8',
);

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

describe('paste an arch entry into design data', () => {
  it('DataInterface -> design becomes a non-derived, editable design entry with a fresh uuid', () => {
    const uri = 'test://arch-to-design.sldd';
    const m = model(uri);
    const arch = entryNode(uri, m, 'DataInterface');
    expect(arch.isDerived).toBe(true);
    const payload = arch.serialize() as Record<string, unknown>;
    const sourceUuid = (payload.metadata as any).uuid as string;

    const design = m.children.find((s: any) => s.name === 'design');
    expect(design).toBeTruthy();

    const { newText } = pasteEntry(archText, design, payload);
    expect(() => JSON.parse(newText)).not.toThrow();

    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const designSection = m2.children.find((s: any) => s.name === 'design');
    const copy = designSection.children.find((c: any) => c.name === 'DataInterface1');
    expect(copy).toBeTruthy();
    // Landed in design as a non-derived entry.
    expect((copy.metadata as any).isderived).toBe('0');
    expect((copy.metadata as any).namespace).toBe(NS_DESIGN);
    expect(copy.isDerived).toBe(false);
    // Fully editable now (not read-only).
    expect(copy.canAddChild()).toBe(true);
    expect(copy.nameEditable).toBe(true);
    // Fresh uuid.
    expect((copy.metadata as any).uuid).not.toBe(sourceUuid);
    expect((copy.metadata as any).uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('name uniqueness spans the combined design+arch namespace', () => {
    // The source arch entry is named "NumericType"; there is no design entry by
    // that name, but because design and arch share a namespace the paste must
    // still avoid colliding with the arch "NumericType" -> it becomes NumericType1.
    const uri = 'test://arch-to-design-name.sldd';
    const m = model(uri);
    const arch = entryNode(uri, m, 'NumericType');
    const payload = arch.serialize() as Record<string, unknown>;
    const design = m.children.find((s: any) => s.name === 'design');

    const { newText } = pasteEntry(archText, design, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const allNsNames = m2.children
      .filter((s: any) => s.name === 'design' || s.name === 'arch')
      .flatMap((s: any) => s.children.map((c: any) => c.name));
    // The original arch NumericType still present, plus a uniquely-named copy.
    expect(allNsNames.filter((n: string) => n === 'NumericType').length).toBe(1);
    expect(allNsNames).toContain('NumericType1');
  });

  it('rejects pasting a Simulink.Parameter into arch (design-only type)', () => {
    // A Simulink.Parameter belongs in Design Data, not Architectural Data.
    const uri = 'test://param-into-arch.sldd';
    const m = model(uri);
    const arch = m.children.find((s: any) => s.name === 'arch');
    const payload = {
      name: 'K',
      metadata: { uuid: 'x', namespace: NS_DESIGN, isderived: '0' },
      value: { _array_class: 'Simulink.Parameter' },
    } as Record<string, unknown>;
    expect(() => pasteEntry(archText, arch, payload)).toThrow(/not allowed|Simulink\.Parameter/i);
  });

  it('rejects pasting a ServiceInterface (Simulink.ServiceBus) into design', () => {
    const uri = 'test://arch-to-design-svc.sldd';
    const m = model(uri);
    const svc = entryNode(uri, m, 'ServiceInterface');
    const payload = svc.serialize() as Record<string, unknown>;
    const design = m.children.find((s: any) => s.name === 'design');

    expect(() => pasteEntry(archText, design, payload)).toThrow(/not allowed|cannot|Simulink\.ServiceBus/i);
  });

  it('pasting back INTO arch keeps it derived, with a unique name+uuid across both sections', () => {
    // Paste into Architectural Data is allowed: the copy stays derived (arch),
    // gets a fresh uuid, and a name unique across the combined design+arch
    // namespace. The new uuid is simply not yet referenced by the interface
    // mapping — the same benign desync add-child already produces.
    const uri = 'test://paste-into-arch.sldd';
    const m = model(uri);
    const src = entryNode(uri, m, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;
    const sourceUuid = (payload.metadata as any).uuid as string;
    const arch = m.children.find((s: any) => s.name === 'arch');

    const { newText } = pasteEntry(archText, arch, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const archSection = m2.children.find((s: any) => s.name === 'arch');
    const copy = archSection.children.find((c: any) => c.name === 'DataInterface1');
    expect(copy).toBeTruthy();
    // Stays Architectural Data.
    expect((copy.metadata as any).isderived).toBe('1');
    expect((copy.metadata as any).namespace).toBe(NS_DESIGN);
    // Fresh, unique uuid across all entries in the combined namespace.
    const allUuids = m2.children
      .filter((s: any) => s.name === 'design' || s.name === 'arch')
      .flatMap((s: any) => s.children.map((c: any) => (c.metadata as any)?.uuid));
    expect((copy.metadata as any).uuid).not.toBe(sourceUuid);
    expect(allUuids.filter((u: string) => u === (copy.metadata as any).uuid).length).toBe(1);
  });
});

describe('pasted entries derive the right Kind from the target section', () => {
  // The user-facing Kind of an arch entry normally comes from the SystemComposer
  // catalog (keyed by name). A pasted entry has a fresh name absent from the
  // catalog, so its Kind must fall back to the class + derived state, NOT to the
  // raw class kind. A derived Simulink.Bus is a "Data Interface", not a "Bus".
  it('a Bus pasted into arch shows Kind "Data Interface" (not "Bus")', () => {
    const uri = 'test://kind-arch.sldd';
    const m = model(uri);
    const src = entryNode(uri, m, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;
    const arch = m.children.find((s: any) => s.name === 'arch');

    const { newText } = pasteEntry(archText, arch, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = m2.children
      .find((s: any) => s.name === 'arch')
      .children.find((c: any) => c.name === 'DataInterface1');
    expect(copy.className).toBe('Simulink.Bus');
    expect(copy.kind).toBe('Data Interface');
  });

  it('the SAME Bus pasted into design shows Kind "Bus" (non-derived)', () => {
    const uri = 'test://kind-design.sldd';
    const m = model(uri);
    const src = entryNode(uri, m, 'DataInterface');
    const payload = src.serialize() as Record<string, unknown>;
    const design = m.children.find((s: any) => s.name === 'design');

    const { newText } = pasteEntry(archText, design, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = m2.children
      .find((s: any) => s.name === 'design')
      .children.find((c: any) => c.name === 'DataInterface1');
    expect(copy.isDerived).toBe(false);
    expect(copy.kind).toBe('Bus');
  });

  it('a ValueType pasted into arch is accepted (arch allows Simulink.ValueType)', () => {
    // The fixture's arch section already contains a ValueType, so the arch
    // allow-list must accept Simulink.ValueType — pasting one must not throw.
    const uri = 'test://vt-arch.sldd';
    const m = model(uri);
    const src = entryNode(uri, m, 'ValueType');
    expect(src.className).toBe('Simulink.ValueType');
    const payload = src.serialize() as Record<string, unknown>;
    const arch = m.children.find((s: any) => s.name === 'arch');

    const { newText } = pasteEntry(archText, arch, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = m2.children
      .find((s: any) => s.name === 'arch')
      .children.find((c: any) => c.name === 'ValueType2');
    expect(copy).toBeTruthy();
    expect((copy.metadata as any).isderived).toBe('1');
  });

  it('a NumericType pasted into arch is accepted (arch allows Simulink.NumericType)', () => {
    const uri = 'test://nt-arch.sldd';
    const m = model(uri);
    const src = entryNode(uri, m, 'NumericType');
    expect(src.className).toBe('Simulink.NumericType');
    const payload = src.serialize() as Record<string, unknown>;
    const arch = m.children.find((s: any) => s.name === 'arch');

    const { newText } = pasteEntry(archText, arch, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = m2.children
      .find((s: any) => s.name === 'arch')
      .children.find((c: any) => c.name === 'NumericType1');
    expect(copy).toBeTruthy();
  });

  it('a derived MATLAB variable (arch Constant) shows Kind "Constant"', () => {
    const uri = 'test://kind-const.sldd';
    const m = model(uri);
    const c = entryNode(uri, m, 'Constant');
    expect(c.isDerived).toBe(true);
    expect(c.kind).toBe('Constant');
  });

  it('a MATLAB variable pasted from design into arch shows Kind "Constant"', () => {
    // Seed a design MATLAB variable (paste the arch Constant into design, where
    // it becomes non-derived -> Kind "MATLAB Variable"), then paste THAT into
    // arch, where it becomes derived -> Kind "Constant".
    const uri = 'test://kind-const-paste.sldd';
    const m = model(uri);
    const seed = (entryNode(uri, m, 'Constant').serialize()) as Record<string, unknown>;
    const design = m.children.find((s: any) => s.name === 'design');
    const { newText } = pasteEntry(archText, design, seed);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const designCopy = m2.children
      .find((s: any) => s.name === 'design')
      .children[0];
    expect(designCopy.isDerived).toBe(false);
    expect(designCopy.kind).toBe('MATLAB Variable');

    // Now paste the design variable into arch.
    const arch2 = m2.children.find((s: any) => s.name === 'arch');
    const { newText: t3 } = pasteEntry(newText, arch2, designCopy.serialize() as Record<string, unknown>);
    invalidate(uri);
    const m3 = getModel(uri, 'arch.sldd', t3);
    const archCopy = m3.children
      .find((s: any) => s.name === 'arch')
      .children.find((c: any) => c.className === 'double' && c.name !== 'Constant');
    expect(archCopy).toBeTruthy();
    expect(archCopy.isDerived).toBe(true);
    expect(archCopy.kind).toBe('Constant');
  });

  it('a ConnectionBus pasted into arch shows Kind "Physical Interface"', () => {
    const uri = 'test://kind-pi.sldd';
    const m = model(uri);
    const src = entryNode(uri, m, 'PhysicalInterface');
    const payload = src.serialize() as Record<string, unknown>;
    const arch = m.children.find((s: any) => s.name === 'arch');

    const { newText } = pasteEntry(archText, arch, payload);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const copy = m2.children
      .find((s: any) => s.name === 'arch')
      .children.find((c: any) => c.name === 'PhysicalInterface1');
    expect(copy.className).toBe('Simulink.ConnectionBus');
    expect(copy.kind).toBe('Physical Interface');
  });
});

describe('renaming an entry checks the combined design+arch namespace', () => {
  it('rejects renaming a design entry to a name already used in arch', () => {
    // "DataInterface" lives in arch. A design entry renamed to it must be
    // refused even though no design sibling has that name — the two sections
    // share a namespace.
    const uri = 'test://rename-clash.sldd';
    const m = model(uri);
    // Paste a design entry to rename (the fixture has no design entries).
    const seed = entryNode(uri, m, 'NumericType').serialize() as Record<string, unknown>;
    const design = m.children.find((s: any) => s.name === 'design');
    const { newText } = pasteEntry(archText, design, seed);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const designSection = m2.children.find((s: any) => s.name === 'design');
    const entry = designSection.children[0];

    const result = entry.setProperty('Name', 'DataInterface');
    expect(result).not.toBe(true);
    expect((result as any).reason).toMatch(/already exists/i);
    expect(entry.name).not.toBe('DataInterface');
  });

  it('allows a rename that is unique across both sections', () => {
    const uri = 'test://rename-ok.sldd';
    const m = model(uri);
    const seed = entryNode(uri, m, 'NumericType').serialize() as Record<string, unknown>;
    const design = m.children.find((s: any) => s.name === 'design');
    const { newText } = pasteEntry(archText, design, seed);
    invalidate(uri);
    const m2 = getModel(uri, 'arch.sldd', newText);
    const entry = m2.children.find((s: any) => s.name === 'design').children[0];

    expect(entry.setProperty('Name', 'AFreshUniqueName')).toBe(true);
    expect(entry.name).toBe('AFreshUniqueName');
  });
});
