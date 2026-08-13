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
  it('a Parameter emits Min/Max/Unit as editable text cells carrying the value', () => {
    const p = ParameterNode.createDefault('p', null);
    p.Min = 2;
    p.Max = 9;
    p.Unit = 'm/s';
    const row = p.toRow();
    expect(cell(row, 'Min')).toEqual({ text: '2', editable: true, editor: 'text' });
    expect(cell(row, 'Max')).toEqual({ text: '9', editable: true, editor: 'text' });
    expect(cell(row, 'Unit')).toEqual({ text: 'm/s', editable: true, editor: 'text' });
  });

  it('an unset Min/Max/Unit renders a blank (empty-text) editable cell', () => {
    const p = ParameterNode.createDefault('p', null);
    const row = p.toRow();
    expect(cell(row, 'Min').text).toBe('');
    expect(cell(row, 'Max').text).toBe('');
    expect(cell(row, 'Unit').text).toBe('');
  });

  it('a Signal also emits Min/Max/Unit columns (no Value column, though)', () => {
    const s = SignalNode.createDefault('s', null);
    s.Min = -5;
    s.Unit = 'K';
    const row = s.toRow();
    expect(cell(row, 'Min')).toEqual({ text: '-5', editable: true, editor: 'text' });
    expect(cell(row, 'Unit')).toEqual({ text: 'K', editable: true, editor: 'text' });
    // A Signal carries no scalar value — its Value cell is empty and not editable.
    expect(row.Value).toBe('');
    expect(row._valueEditable).toBe(false);
  });

  it('the PI layout still lists Min/Max/Unit under Value Properties (no duplication)', () => {
    const p = ParameterNode.createDefault('p', null);
    const valueGroup = p.getPILayout().find((g: any) => g.group === 'Value Properties')!;
    const keys = valueGroup.items.map((i: any) => i.key);
    expect(keys).toEqual(['Min', 'Max', 'Unit', 'Description']);
    // The projected schema groups (Data Object / Code Generation) do NOT re-list
    // Min/Max/Unit — they stay node-owned, so the PI shows each exactly once.
    const allPIKeys = p.getPILayout().flatMap((g: any) => g.items.map((i: any) => i.key));
    expect(allPIKeys.filter((k: string) => k === 'Min')).toEqual(['Min']);
  });

  it('editing a Min/Max/Unit column still routes to the node fields', () => {
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Min', '3')).toBe(true);
    expect(p.Min).toBe(3);
    expect(p.setProperty('Unit', 'kg')).toBe(true);
    expect(p.Unit).toBe('kg');
    // Max must not be less than Min — the node validation still fires through the column.
    const r = p.setProperty('Max', '1');
    expect((r as any).error).toBe(true);
  });
});
