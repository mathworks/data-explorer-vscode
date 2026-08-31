// Copyright 2026 The MathWorks, Inc.
//
// General array-expansion rule: a value object with MORE THAN ONE element is a
// vector/matrix of objects and MUST expand in two levels — first into N element
// rows (name(1), name(2), …), then each element into its own rows. This holds for
//   • ANY class: a KNOWN Simulink class (Simulink.Parameter → each element a typed
//     ParameterNode) OR a CUSTOM class (Simulink.VariableUsage → each element a
//     generic ObjectNode), and
//   • ANY source format: JSON .sldd, binary .sldd, .slx, .mat.
// The rule lives in NodeClassMap.parseValue (format-independent), so a single unit
// suite over the value-object shape proves the routing, and per-format fixtures
// prove each parser hands that shape up. The .mat arrays are covered by AUTHENTIC
// MATLAB-generated fixtures in objectExpansion.test.ts (paramArray.mat 3x1
// Simulink.Parameter, variableUsageArray.mat 20x1 Simulink.VariableUsage); the
// shared MCOS decode path (.mat + .slx) by mcosParser.test.ts.
//
// NOTE on the .sldd fixtures below: MATLAB itself REFUSES to store an object array
// of Simulink.Parameter (any dictionary section) or Simulink.VariableUsage (Design
// Data) in a .sldd — a data dictionary is not a container object arrays can occur
// in (verified R2027a). So these two .sldd fixtures are HAND-AUTHORED to exercise
// the parser's multi-<Element> path defensively (guarding the BinarySlddParser
// fix): they assert that IF such XML is ever read, both parsers expand it. The only
// authentic real-world home for an object array is a .mat file (above).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}
function fixtureBytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function expandableIds(rows: any[]): Set<string> {
  return new Set(rows.map((r) => r.parent).filter(Boolean));
}
const label = (r: any) => (typeof r.Name === 'object' ? r.Name.label : r.Name);

// ---- JSON .sldd -----------------------------------------------------------------
describe('general array rule — JSON .sldd (Simulink.Parameter in Design, custom in Other)', () => {
  const sldd = getModel('test://objarr_text', 'object_array_text.sldd', fixture('object_array_text.sldd'));
  const rows = buildRows(sldd);
  const expandable = expandableIds(rows);

  it('KNOWN class (Simulink.Parameter): 3x1 top row expands into 3 typed element rows', () => {
    const topId = 'test://objarr_text/design/paramArray';
    const top = rows.find((r) => r.ID === topId)!;
    expect(top).toBeDefined();
    expect(String(top.Value)).toBe('<3x1 Simulink.Parameter>');
    expect(expandable.has(topId)).toBe(true);
    const elems = rows.filter((r) => r.parent === topId);
    expect(elems.map(label)).toEqual(['paramArray(1)', 'paramArray(2)', 'paramArray(3)']);
    // Each element is a scalar Simulink.Parameter carrying its own Value.
    expect(elems.map((r) => String(r.Value))).toEqual(['10', '20', '30']);
    elems.forEach((r) => expect(r.Class).toBe('Simulink.Parameter'));
  });

  it('CUSTOM class (Simulink.VariableUsage): 2x1 top row expands into 2 element rows, each with its props', () => {
    const topId = 'test://objarr_text/other/usageArray';
    const top = rows.find((r) => r.ID === topId)!;
    expect(top).toBeDefined();
    expect(String(top.Value)).toBe('<2x1 Simulink.VariableUsage>');
    expect(expandable.has(topId)).toBe(true);
    const elems = rows.filter((r) => r.parent === topId);
    expect(elems.map(label)).toEqual(['usageArray(1)', 'usageArray(2)']);
    // Each element expands into its class-property rows.
    elems.forEach((elem) => {
      expect(expandable.has(elem.ID)).toBe(true);
      const props = rows.filter((r) => r.parent === elem.ID).map(label).sort();
      expect(props).toEqual(['Name', 'Source', 'SourceType']);
    });
    const firstName = rows.find(
      (r) => r.parent === elems[0].ID && label(r) === 'Name',
    )!;
    expect(String(firstName.Value)).toContain('Ka');
  });
});

// ---- binary .sldd ---------------------------------------------------------------
describe('general array rule — binary .sldd (Simulink.Parameter in Design, custom in Other)', () => {
  const sldd = getModelFromBytes(
    'test://objarr_bin',
    'object_array_binary.sldd',
    fixtureBytes('object_array_binary.sldd'),
  );
  const rows = buildRows(sldd);
  const expandable = expandableIds(rows);

  it('KNOWN class (Simulink.Parameter): 3x1 top row expands into 3 typed element rows', () => {
    const topId = 'test://objarr_bin/design/paramArray';
    const top = rows.find((r) => r.ID === topId)!;
    expect(top, 'binary SLDD must keep all 3 <Element>s, not just the first').toBeDefined();
    expect(String(top.Value)).toBe('<3x1 Simulink.Parameter>');
    expect(expandable.has(topId)).toBe(true);
    const elems = rows.filter((r) => r.parent === topId);
    expect(elems.map(label)).toEqual(['paramArray(1)', 'paramArray(2)', 'paramArray(3)']);
    expect(elems.map((r) => String(r.Value))).toEqual(['10', '20', '30']);
    elems.forEach((r) => expect(r.Class).toBe('Simulink.Parameter'));
  });

  it('CUSTOM class (Simulink.VariableUsage): 2x1 top row expands into 2 element rows, each with its props', () => {
    const topId = 'test://objarr_bin/other/usageArray';
    const top = rows.find((r) => r.ID === topId)!;
    expect(top).toBeDefined();
    expect(String(top.Value)).toBe('<2x1 Simulink.VariableUsage>');
    expect(expandable.has(topId)).toBe(true);
    const elems = rows.filter((r) => r.parent === topId);
    expect(elems.map(label)).toEqual(['usageArray(1)', 'usageArray(2)']);
    elems.forEach((elem) => {
      expect(expandable.has(elem.ID)).toBe(true);
      const props = rows.filter((r) => r.parent === elem.ID).map(label).sort();
      expect(props).toEqual(['Name', 'Source', 'SourceType']);
    });
    const names = elems.map(
      (elem) => String(rows.find((r) => r.parent === elem.ID && label(r) === 'Name')!.Value),
    );
    expect(names.some((n) => n.includes('Ka'))).toBe(true);
    expect(names.some((n) => n.includes('Kf'))).toBe(true);
  });
});
