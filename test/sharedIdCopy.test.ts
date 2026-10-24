// Copyright 2026 The MathWorks, Inc.
//
// A row whose entry shares its id with another offers no Copy or Cut (rowStamp.sharedIdTest).
//
// A node id is a path, so two entries of one name under one parent — a MAT-file holding two
// records of a name, a dictionary section holding two entries of one — are one id, and so is
// every row inside them. Core resolves such an id to neither node, so a copy, a cut or a drag of
// either row could only say it found nothing. The row says so before it is clicked instead:
// `_canCopy` false on it and on every row under it, in both builders, for the payload, a repaint
// of the entry and a fetch of the rows under one of its children alike. Its siblings, and an
// entry of the same name in another section (another id), copy as ever.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { sharedIdTest } from '../src/host/rowStamp.js';
import { buildRows, buildEntryRows, buildChildRows } from '../src/host/rowBuilder.js';
import { buildMatRowsPlanned, buildMatVariableRows } from '../src/host/matRowBuilder.js';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { buildContextMenuItems } from '../src/webview/menuItems.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../test-integration/fixtures/workspace/params.sldd', import.meta.url)), 'utf8'),
);
const entriesOf = (doc: any): any[] => doc.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

/** params.sldd with two structs named S in Design Data, each its own uuid, as MATLAB would write two. */
function twinsText(): string {
  const doc = structuredClone(fixture);
  const struct = entriesOf(doc).find((e: any) => e.name === 'myStruct');
  const twin = (uuid: string) => ({ ...structuredClone(struct), name: 'S', metadata: { ...struct.metadata, uuid } });
  entriesOf(doc).unshift(twin('twin-s-1'), twin('twin-s-2'));
  return JSON.stringify(doc, null, '\t');
}

const opened: string[] = [];
afterEach(() => {
  for (const id of opened.splice(0)) {
    invalidate(id);
    DataModel.removeDataSource(id);
  }
});

const scalar = (name: string, value = 1) => ({ name, className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value, fields: null });
const struct = (name: string) => ({
  name,
  className: 'struct',
  dimensions: [1, 1],
  isComplex: false,
  isLogical: false,
  value: null,
  fields: { gain: scalar('gain', 2) },
});

function mat(variables: any[]): any {
  const srcId = `binedit:file:///work/shared-${opened.length}.mat`;
  opened.push(srcId);
  DataModel.removeDataSource(srcId);
  return DataModel.addMatSourceParsed(srcId, { header: 'MATLAB 5.0', variables }, { path: 'shared.mat' });
}

/** Each row's name and `_canCopy`, in order. */
const copies = (rows: any[]) => rows.map((r) => [r.Name?.label ?? r.Name, r._canCopy]);

describe('sharedIdTest', () => {
  const parent = (...names: string[]): any[] => {
    const p: any = { children: [] };
    for (const name of names) p.children.push({ name, isEntry: true, parent: p });
    return p.children;
  };

  it('is true of two entries of one name under one parent, and of nothing else', () => {
    const [a1, b, a2] = parent('a', 'b', 'a');
    const test = sharedIdTest();
    expect([test(a1), test(b), test(a2)]).toEqual([true, false, true]);
    // Under different parents the names are different ids.
    const [x] = parent('a');
    expect(test(x)).toBe(false);
    expect(test(null)).toBe(false);
    expect(test({ name: 'loose', isEntry: true })).toBe(false);
  });

  it('counts only entries: a non-entry child of one name is not a twin', () => {
    const p: any = { children: [] };
    const entry = { name: 'a', isEntry: true, parent: p };
    p.children.push(entry, { name: 'a', isEntry: false, parent: p });
    expect(sharedIdTest()(entry)).toBe(false);
  });
});

describe("a MAT-file's variable whose name the file holds twice", () => {
  it('offers no Copy on its rows, in the payload, a repaint and a fetch; the others do', () => {
    const node = mat([struct('x'), scalar('str'), struct('x')]);
    const rows = buildMatRowsPlanned(node, Infinity, undefined, { canCopy: true }).rows;
    expect(copies(rows)).toEqual([
      ['x', false],
      ['gain', false],
      ['str', true],
      ['x', false],
      ['gain', false],
    ]);
    expect(copies(buildMatVariableRows(node.children[2], Infinity, undefined, { canCopy: true }))).toEqual([
      ['x', false],
      ['gain', false],
    ]);
    expect(copies(buildMatRowsPlanned(node.children[0], Infinity, undefined, { canCopy: true }).rows)).toEqual([['gain', false]]);
  });

  it('so its menu offers Copy and Cut disabled, while a sibling’s are enabled', () => {
    const node = mat([scalar('x'), scalar('str'), scalar('x')]);
    const rows = buildMatRowsPlanned(node, Infinity, undefined, { canCopy: true }).rows;
    const menu = (rowId: string) =>
      buildContextMenuItems({
        rows,
        selectedRowIds: [rowId],
        anchorRowId: rowId,
        clipboard: { canPaste: false, mode: null, items: [] },
        editable: true,
        hasTextView: false,
        pasteTarget: null,
      });
    const state = (rowId: string) => menu(rowId).filter((i) => i.id === 'copy' || i.id === 'cut').map((i) => [i.id, !!i.disabled]);
    expect(state(rows[0].ID)).toEqual([
      ['copy', true],
      ['cut', true],
    ]);
    expect(state(rows[1].ID)).toEqual([
      ['copy', false],
      ['cut', false],
    ]);
  });
});

describe('a dictionary entry whose name its section holds twice', () => {
  it('offers no Copy on its rows, in the payload, a repaint and a fetch; the others do', () => {
    const uri = 'test://shared-id-copy.sldd';
    opened.push(uri);
    invalidate(uri);
    const model = getModel(uri, 'twins.sldd', twinsText());
    const rows = buildRows(model);
    const byName = (name: string) => rows.filter((r: any) => r.Name?.label === name && String(r.parent).startsWith('section:'));
    expect(byName('S').map((r: any) => r._canCopy)).toEqual([false, false]);
    expect(rows.filter((r: any) => String(r.ID).startsWith(`${uri}/design/S/`)).every((r: any) => r._canCopy === false)).toBe(true);
    expect(byName('myStruct').map((r: any) => r._canCopy)).toEqual([true]);
    expect(byName('gravity').map((r: any) => r._canCopy)).toEqual([true]);

    const design = model.children.find((s: any) => s.name === 'design');
    const [s1] = design.children.filter((e: any) => e.name === 'S');
    expect(buildEntryRows(s1, 'design').every((r: any) => r._canCopy === false)).toBe(true);
    const fetched = buildChildRows(s1).rows;
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((r: any) => r._canCopy === false)).toBe(true);
    const myStruct = design.children.find((e: any) => e.name === 'myStruct');
    expect(buildChildRows(myStruct).rows.every((r: any) => r._canCopy === true)).toBe(true);
  });
});
