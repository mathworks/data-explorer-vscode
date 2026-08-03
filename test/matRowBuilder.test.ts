// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import '../src/dex/datamodel/node/NodeClassMap.js';
import MatNode from '../src/dex/datamodel/node/container/MatNode.js';
import { buildMatRows } from '../src/host/matRowBuilder.js';

// Build a MatNode from parsed variables (scalar + a struct with fields).
function makeNode() {
  return MatNode.fromParsed(
    {
      header: 'MATLAB 5.0',
      variables: [
        { name: 'Kp', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 3, fields: null },
        {
          name: 'cfg', className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null,
          fields: { gain: { name: 'gain', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 2, fields: null } },
        },
      ],
    } as any,
    'simple.mat',
  );
}

describe('buildMatRows', () => {
  it('emits a top-level row per variable', () => {
    const rows = buildMatRows(makeNode());
    const names = rows.filter((r: any) => r.parent == null).map((r: any) => r.Name?.label ?? r.Name);
    expect(names).toContain('Kp');
    expect(names).toContain('cfg');
  });

  it('flattens struct fields as child rows', () => {
    const rows = buildMatRows(makeNode());
    const labels = rows.map((r: any) => r.Name?.label ?? r.Name);
    expect(labels).toContain('gain'); // nested field surfaced
  });

  it('returns an empty array for a MatNode with no variables', () => {
    const node = MatNode.fromParsed({ header: 'MATLAB 5.0', variables: [] } as any, 'empty.mat');
    expect(buildMatRows(node)).toEqual([]);
  });

  it('emits a row with an ID for every variable (rows are addressable)', () => {
    const rows = buildMatRows(makeNode());
    for (const r of rows) {
      expect(r.ID != null || (r as any).id != null).toBe(true);
    }
  });

  it('produces a struct field row nested under its parent variable (parent set)', () => {
    const rows = buildMatRows(makeNode());
    const gain = rows.find((r: any) => (r.Name?.label ?? r.Name) === 'gain');
    expect(gain).toBeTruthy();
    // The nested field is not a top-level row.
    expect(gain.parent != null).toBe(true);
  });

  it('returns [] when the node has no children property', () => {
    expect(buildMatRows({})).toEqual([]);
  });

  it('treats a variable without flatten() as a single node', () => {
    const node = { children: [{ toRow: () => ({ ID: 'v', parent: null, Name: 'v' }) }] };
    expect(buildMatRows(node).map((r: any) => r.ID)).toEqual(['v']);
  });

  it('skips a variable whose toRow returns null', () => {
    const node = { children: [{ flatten() { return [this]; }, toRow: () => null }] };
    expect(buildMatRows(node)).toEqual([]);
  });

  it('does not throw if a child node lacks toRow (defensive skip)', () => {
    // Inject a fake variable child whose toRow throws; buildMatRows must skip it.
    const node: any = MatNode.fromParsed(
      { header: 'MATLAB 5.0', variables: [{ name: 'ok', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 1, fields: null }] } as any,
      'x.mat',
    );
    node.children.push({
      flatten() { return [this]; },
      toRow() { throw new Error('boom'); },
    });
    expect(() => buildMatRows(node)).not.toThrow();
    const labels = buildMatRows(node).map((r: any) => r.Name?.label ?? r.Name);
    expect(labels).toContain('ok'); // the good variable still renders
  });
});
