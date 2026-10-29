// Copyright 2026 The MathWorks, Inc.
//
// One row stamper, two builders. rowBuilder.ts (dictionary, model, project) and
// matRowBuilder.ts (MAT-file) each make a row from a node's `toRow()` and then stamp it:
// the context-menu flags, the Status answer from the last save, the clipboard mark, the
// grid-view payload, the deferred mark, the cell pool. They used to do it with two copies
// of that chain, and the copies had drifted — one guarded its capability checks and one
// did not; one could carry a clip mark and one could not. This file pins the chain itself
// (rowStamp.ts) and then that BOTH builders produce what it produces, so a stamp added to
// one builder and not the other fails here rather than shipping as a row with a feature
// quietly absent in one format.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel, RowCellPool } from 'data-explorer-core';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';
import { capabilityFlags, stampRow, clipMarkKey, type ClipMark } from '../src/view/model/rows/rowStamp.js';
import { buildChildRows, buildEntryRows, clipMarkKey as reexportedKey } from '../src/view/model/rows/rowBuilder.js';
import { buildMatRowsPlanned, buildMatVariableRows } from '../src/view/model/rows/matRowBuilder.js';
import { rowPlannerFor } from '../src/view/model/rows/rowPlanner.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const src = (p: string) =>
  blankCommentsAndKeepLines(readFileSync(fileURLToPath(new URL(`../src/view/model/rows/${p}`, import.meta.url)), 'utf8'));

const mark = (mode: 'cut' | 'copy', ...pairs: Array<[string, string]>): ClipMark => ({
  keys: new Set(pairs.map(([s, n]) => clipMarkKey(s, n))),
  mode,
});

// A duck-typed node: the stamper reads only toRow's output, isEntry, canAddChild(),
// parent.canRemoveChild(), and whatever stampMatrix asks of the node (nothing, here).
function duck(id: string, extra: Record<string, any> = {}): any {
  return {
    id,
    name: id,
    children: [],
    toRow: () => ({ ID: id, parent: null, Status: '', Name: { label: id, iconId: 'x', editable: true }, Value: '1' }),
    ...extra,
  };
}

describe('capabilityFlags', () => {
  it('reads the node and its parent, and takes `_canCopy` from the caller', () => {
    const parent = { canRemoveChild: () => true };
    expect(capabilityFlags(duck('a', { parent, canAddChild: () => true }), { canCopy: true })).toEqual({
      _canCopy: true,
      _canDelete: true,
      _canAddChild: true,
    });
    expect(capabilityFlags(duck('a', { parent }), { canCopy: false })).toEqual({
      _canCopy: false,
      _canDelete: true,
      _canAddChild: false,
    });
  });

  it('an entry is deletable whatever its parent says', () => {
    expect(capabilityFlags(duck('e', { isEntry: true, parent: { canRemoveChild: () => false } }), { canCopy: true })._canDelete).toBe(true);
  });

  it('a check that throws offers nothing, and does not take the row down with it', () => {
    // The guard the MAT builder always had. The dictionary builder had none, so a throwing
    // check there escaped buildRows and blanked the WHOLE table instead of one row's menu.
    const n = duck('t', {
      parent: { canRemoveChild: () => { throw new Error('boom'); } },
      canAddChild: () => { throw new Error('boom'); },
    });
    expect(capabilityFlags(n, { canCopy: true })).toEqual({ _canCopy: true, _canDelete: false, _canAddChild: false });
  });

  it('answers booleans, never the truthy value a check happened to return', () => {
    expect(capabilityFlags(duck('v', { canAddChild: () => 'yes' as any }), { canCopy: true })._canAddChild).toBe(true);
    expect(capabilityFlags(duck('v', { canAddChild: () => undefined as any }), { canCopy: true })._canAddChild).toBe(false);
  });
});

describe('stampRow', () => {
  const ctx = { canCopy: true, deferred: false };

  it('adds the flags and touches nothing else on a non-entry row', () => {
    const n = duck('a');
    expect(stampRow(n.toRow(), n, ctx)).toEqual({ ...n.toRow(), _canCopy: true, _canDelete: false, _canAddChild: false });
  });

  it('never writes the object toRow handed it', () => {
    const n = duck('a');
    const built = n.toRow();
    const before = structuredClone(built);
    stampRow(built, n, { ...ctx, entry: { section: 's', name: 'a', status: 'Modified', clipMark: mark('cut', ['s', 'a']) } });
    expect(built).toEqual(before);
  });

  it("an entry's status, when the caller has one, replaces core's; undefined keeps it", () => {
    const n = duck('a', { toRow: () => ({ ID: 'a', parent: null, Status: 'Modified', Name: { label: 'a' } }) });
    expect(stampRow(n.toRow(), n, { ...ctx, entry: { section: '', name: 'a', status: '' } }).Status).toBe('');
    expect(stampRow(n.toRow(), n, { ...ctx, entry: { section: '', name: 'a' } }).Status).toBe('Modified');
    // And only an ENTRY's: a nested row has no entry stamps to apply.
    expect(stampRow(n.toRow(), n, ctx).Status).toBe('Modified');
  });

  it('marks an entry on the clipboard, keyed by section and name', () => {
    const n = duck('a');
    const on = (section: string, m: ClipMark) => stampRow(n.toRow(), n, { ...ctx, entry: { section, name: 'a', clipMark: m } }).Name;
    expect(on('design', mark('cut', ['design', 'a'])).clipboardMode).toBe('cut');
    expect(on('design', mark('copy', ['design', 'a'])).clipboardMode).toBe('copy');
    expect(on('arch', mark('cut', ['design', 'a'])).clipboardMode, 'another section’s same name').toBeUndefined();
    // A MAT-file has no sections: its key's section half is ''.
    expect(on('', mark('copy', ['', 'a'])).clipboardMode).toBe('copy');
  });

  it('stamps the deferred mark last, and shares the finished row through the pool', () => {
    const n = duck('a');
    const row = stampRow(n.toRow(), n, { ...ctx, deferred: true });
    expect(row._lazy).toBe(true);
    expect(Object.keys(row).at(-1)).toBe('_lazy');
    const pool = new RowCellPool();
    const one = stampRow(n.toRow(), n, { ...ctx, pool });
    const two = stampRow(n.toRow(), n, { ...ctx, pool });
    expect(one.Name).toBe(two.Name);
  });
});

describe('the clip-mark key has one home', () => {
  it('rowBuilder re-exports it rather than spelling it again', () => {
    // The providers import it from rowBuilder; both must be the function the stamper reads.
    expect(reexportedKey).toBe(clipMarkKey);
  });
});

// ── both builders call the one stamper ────────────────────────────────────────────
describe('rowBuilder and matRowBuilder stamp through rowStamp.ts and nowhere else', () => {
  // Read as source, the way multiSelectInvariants.test.ts reads table-main: what is pinned is
  // the SHAPE — the chain is called, not re-implemented — which a behavioural test of one
  // format could not see drift in the other.
  for (const file of ['rowBuilder.ts', 'matRowBuilder.ts']) {
    it(`${file} calls stampRow and stamps nothing itself`, () => {
      const s = src(file);
      expect(s).toContain('stampRow(');
      for (const own of ['stampMatrix(', 'stampLazy(', 'capabilityFlags(', '.share(', 'clipboardMode']) {
        expect(s, `${file} still does ${own} itself`).not.toContain(own);
      }
    });
  }
});

// A MatNode built through the core barrel, the way the extension builds one.
let seq = 0;
function matOf(variables: any[]): any {
  const uri = `rowstamp://${seq++}.mat`;
  DataModel.removeDataSource(uri);
  return DataModel.addMatSourceParsed(uri, { header: 'MATLAB 5.0', variables }, { path: uri });
}
const scalar = (name: string, value: number) => ({
  name, className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value, fields: null,
});
const struct = (name: string, fields: Record<string, any>) => ({
  name, className: 'struct', dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields,
});

describe('the same nodes come out of both builders as the same rows', () => {
  // The sectioned fetch (buildChildRows) and the MAT walk (buildMatRowsPlanned) both plan the
  // children of one node and stamp each. Handed the same node they must agree row for row,
  // save the one input that legitimately differs: whether the format copies.
  const mat = () => matOf([struct('cfg', { gain: scalar('gain', 2), bias: scalar('bias', 0) }), scalar('Kp', 3)]);

  it('agree exactly when given the same canCopy', () => {
    const cfg = mat().children.find((v: any) => v.name === 'cfg');
    expect(buildMatRowsPlanned(cfg, Infinity, undefined, { canCopy: true }).rows).toEqual(buildChildRows(cfg).rows);
  });

  it('differ only in `_canCopy` by default, which a MAT-file does not yet offer', () => {
    const cfg = mat().children.find((v: any) => v.name === 'cfg');
    const matRows = buildMatRowsPlanned(cfg).rows;
    const sectioned = buildChildRows(cfg).rows;
    expect(matRows.map((r: any) => r._canCopy)).toEqual(matRows.map(() => false));
    expect(matRows.map(({ _canCopy, ...rest }: any) => rest)).toEqual(sectioned.map(({ _canCopy, ...rest }: any) => rest));
  });

  it('a throwing capability check costs one row its menu, in either builder', () => {
    const thrower = {
      id: 'p',
      children: [duck('c', { canAddChild: () => { throw new Error('boom'); } })],
    };
    expect(buildChildRows(thrower).rows.map((r: any) => r._canAddChild)).toEqual([false]);
    expect(buildMatRowsPlanned(thrower).rows.map((r: any) => r._canAddChild)).toEqual([false]);
  });
});

describe("a MAT-file's variables take the clipboard mark, keyed ('', name)", () => {
  const node = () => matOf([scalar('Kp', 3), struct('cfg', { gain: scalar('gain', 2) })]);
  const label = (r: any) => r.Name?.label;

  it('the whole payload marks the variables named, and nothing under them', () => {
    const rows = buildMatRowsPlanned(node(), Infinity, undefined, { clipMark: mark('cut', ['', 'cfg']) }).rows;
    expect(rows.filter((r: any) => r.Name?.clipboardMode).map(label)).toEqual(['cfg']);
    expect(rows.find((r: any) => label(r) === 'cfg').Name.clipboardMode).toBe('cut');
  });

  it("a dictionary section's key does not mark a variable of the same name", () => {
    const rows = buildMatRowsPlanned(node(), Infinity, undefined, { clipMark: mark('copy', ['design', 'Kp']) }).rows;
    expect(rows.some((r: any) => r.Name?.clipboardMode)).toBe(false);
  });

  it("one variable's repaint carries it as the payload does", () => {
    const mat = node();
    const cfg = mat.children.find((v: any) => v.name === 'cfg');
    const opts = { clipMark: mark('copy', ['', 'cfg']), canCopy: true };
    const whole = buildMatRowsPlanned(mat, Infinity, undefined, opts).rows.filter((r: any) => r.ID === cfg.id || r.parent === cfg.id);
    expect(buildMatVariableRows(cfg, Infinity, undefined, opts)).toEqual(whole);
    expect(whole[0].Name.clipboardMode).toBe('copy');
    expect(whole.every((r: any) => r._canCopy === true)).toBe(true);
  });

  it('the MAT planner passes the mark and canCopy through, payload and fetch alike', () => {
    const planner = rowPlannerFor('d.mat');
    const mat = node();
    const opts = { clipMark: mark('cut', ['', 'Kp']), canCopy: true };
    expect(planner.payload(mat, Infinity, opts).rows).toEqual(buildMatRowsPlanned(mat, Infinity, undefined, opts).rows);
    const cfg = mat.children.find((v: any) => v.name === 'cfg');
    expect(planner.children(cfg, Infinity, opts).rows.every((r: any) => r._canCopy === true)).toBe(true);
    expect(planner.children(cfg, Infinity).rows.every((r: any) => r._canCopy === false)).toBe(true);
  });
});

describe("a dictionary entry's stamps are unchanged by the move", () => {
  it('the entry row: status, metadata, mark and flags, in that order of keys', () => {
    const entry = {
      ...duck('E', { isEntry: true }),
      lastModified: '2026-10-23',
      lastModifiedBy: 'me',
    };
    const [row] = buildEntryRows(entry, 'design', new Set(['E']), mark('cut', ['design', 'E']));
    expect(row).toEqual({
      ID: 'E',
      parent: 'section:design',
      Status: 'Modified',
      Name: { label: 'E', iconId: 'x', editable: true, clipboardMode: 'cut' },
      Value: '1',
      lastModified: '2026-10-23',
      lastModifiedBy: 'me',
      _canCopy: true,
      _canDelete: true,
      _canAddChild: false,
    });
    expect(Object.keys(row)).toEqual([
      'ID', 'parent', 'Status', 'Name', 'Value', 'lastModified', 'lastModifiedBy', '_canCopy', '_canDelete', '_canAddChild',
    ]);
  });
});
