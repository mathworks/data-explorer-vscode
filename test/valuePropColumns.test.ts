// Copyright 2026 The MathWorks, Inc.
//
// Min / Max / Unit are node-owned value properties that surface BOTH in the
// Property Inspector (via getPILayout) AND as editable table columns. Giving the
// Prop classes a `column` key makes toRow emit them; this pins that column
// surface (editable text cells, blank when absent) for Parameter and Signal, and
// confirms the PI layout is unchanged (no duplication) and edits still route.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/dex/datamodel/node/data/ParameterNode.js';
import SignalNode from '../src/dex/datamodel/node/data/SignalNode.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

// An editable generic cell is the object shape { text, editable, editor }; a
// skipped/absent column is simply not a key on the row.
function cell(row: any, key: string): any {
  return row[key];
}

describe('Min / Max / Unit table columns', () => {
  it('a Parameter emits Min/Max as editable text cells and Unit as a read-only label', () => {
    const p = ParameterNode.createDefault('p', null);
    p.Min = 2;
    p.Max = 9;
    p.Unit = 'm/s';
    const row = p.toRow();
    expect(cell(row, 'Min')).toEqual({ text: '2', editable: true, editor: 'text' });
    expect(cell(row, 'Max')).toEqual({ text: '9', editable: true, editor: 'text' });
    // Unit is conservatively read-only (Simulink runs it through a unit-expression
    // parser we can't replicate), so toRow emits it as a plain string, not a cell.
    expect(cell(row, 'Unit')).toBe('m/s');
  });

  it('an unset Min/Max renders a blank editable cell; Unit is a blank string', () => {
    const p = ParameterNode.createDefault('p', null);
    const row = p.toRow();
    expect(cell(row, 'Min').text).toBe('');
    expect(cell(row, 'Max').text).toBe('');
    expect(cell(row, 'Unit')).toBe('');
  });

  it('a Signal also emits Min (editable) and Unit (read-only) columns (no Value column, though)', () => {
    const s = SignalNode.createDefault('s', null);
    s.Min = -5;
    s.Unit = 'K';
    const row = s.toRow();
    expect(cell(row, 'Min')).toEqual({ text: '-5', editable: true, editor: 'text' });
    expect(cell(row, 'Unit')).toBe('K');
    // A Signal carries no scalar value — its Value cell is empty and not editable.
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('the PI layout lists Min/Max/Unit under Value Properties (no duplication)', () => {
    const p = ParameterNode.createDefault('p', null);
    const valueGroup = p.getPILayout().find((g: any) => g.group === 'Value Properties')!;
    const keys = valueGroup.items.map((i: any) => i.key);
    // MATLAB-parity Value Properties: Dimensions/Complexity fold in here (no
    // separate Data Object group), then the value bounds/unit/description.
    expect(keys).toEqual(['dimensions', 'complexity', 'Min', 'Max', 'storedIntMin', 'storedIntMax', 'Unit', 'Description']);
    // Min/Max/Unit appear exactly once across the whole PI — no other group
    // re-lists them, so the PI shows each once.
    const allPIKeys = p.getPILayout().flatMap((g: any) => g.items.map((i: any) => i.key));
    expect(allPIKeys.filter((k: string) => k === 'Min')).toEqual(['Min']);
  });

  it('editing a Min/Max column routes to the node fields', () => {
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Min', '3')).toBe(true);
    expect(p.Min).toBe(3);
    expect(p.setProperty('Max', '9')).toBe(true);
    expect(p.Max).toBe(9);
  });

  it('accepts Min > Max — MATLAB does not enforce the ordering, so neither do we', () => {
    // Verified against MATLAB (BR2025ad): setPropValue('Min','5') then
    // setPropValue('Max','1') is accepted (Min=5, Max=1). We must not be stricter.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Min', '5')).toBe(true);
    expect(p.setProperty('Max', '1')).toBe(true);
    expect(p.Min).toBe(5);
    expect(p.Max).toBe(1);
  });
});
