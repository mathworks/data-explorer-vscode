// Copyright 2026 The MathWorks, Inc.
//
// A row whose entry shares its id with another offers no Copy, Cut, Delete or Add Child
// (rowStamp.sharedIdTest).
//
// A node id is a path, so two entries of one name under one parent — a MAT-file holding two
// records of a name, a dictionary section holding two entries of one — are one id, and so is
// every row inside them. Core resolves such an id to neither node, so a copy, a cut, a drag, a
// delete or an add of a child on either row could only say it found nothing. The row says so
// before it is clicked instead: every capability flag false on it and on every row under it, in
// both builders, for the payload, a repaint of the entry and a fetch of the rows under one of its
// children alike. Its siblings, and an entry of the same name in another section (another id),
// offer what they always did.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel, parseMat } from 'data-explorer-core';
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

/** Each row's name and its three capability flags, in order. */
const flags = (rows: any[]) => rows.map((r) => [r.Name?.label ?? r.Name, r._canCopy, r._canDelete, r._canAddChild]);

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

/**
 * A MAT-file read from bytes holding cases.mat's `rowVec` twice with `structScalar` between: the
 * malformed file MATLAB never writes and core keeps both twins of, as read. Read from a file, not
 * parsed from variables, so that core's gate answers for a file a save can write (a struct takes
 * a field, a vector an element).
 */
function twiceNamedMat(): any {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../test-integration/fixtures/mat/cases.mat', import.meta.url))));
  const parsed: any = parseMat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const record = (name: string): Uint8Array => parsed.records.find((r: any) => r.name === name).bytes;
  // The header, saying the file has no subsystem: these records hold no object.
  const header = bytes.slice(0, 128);
  for (let i = 116; i < 124; i++) header[i] = 0x20;
  const parts = [header, record('rowVec'), record('structScalar'), record('rowVec')];
  const file = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.byteLength;
  }
  const srcId = `binedit:file:///work/shared-${opened.length}.mat`;
  opened.push(srcId);
  DataModel.removeDataSource(srcId);
  return DataModel.addMatSource(srcId, file.buffer, { path: 'shared.mat' });
}

describe("a MAT-file's variable whose name the file holds twice", () => {
  const twin = ['rowVec', 'rowVec(1)', 'rowVec(2)', 'rowVec(3)'].map((name) => [name, false, false, false]);

  it('offers nothing on its rows, in the payload, a repaint and a fetch; the others do', () => {
    const node = twiceNamedMat();
    expect(node.readOnly).toBe(false);
    const rows = buildMatRowsPlanned(node, Infinity, undefined, { canCopy: true }).rows;
    expect(flags(rows)).toEqual([
      ...twin,
      // The variable between them, under a name of its own: copied, deleted, a field added, and
      // each field deleted (a MAT-file's struct gives up a field, as MATLAB's rmfield does).
      ['structScalar', true, true, true],
      ['a', true, true, false],
      ['b', true, true, false],
      ...twin,
    ]);
    expect(flags(buildMatVariableRows(node.children[2], Infinity, undefined, { canCopy: true }))).toEqual(twin);
    expect(flags(buildMatRowsPlanned(node.children[0], Infinity, undefined, { canCopy: true }).rows)).toEqual(twin.slice(1));
  });

  it('so its menu offers Copy, Cut, Add Child and Delete disabled, while a sibling’s are enabled', () => {
    const rows = buildMatRowsPlanned(twiceNamedMat(), Infinity, undefined, { canCopy: true }).rows;
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
    const ACTIONS = ['copy', 'cut', 'addChild', 'delete'];
    const state = (rowId: string) => menu(rowId).filter((i) => ACTIONS.includes(i.id)).map((i) => [i.id, !!i.disabled]);
    const top = (name: string) => rows.find((r: any) => r.parent == null && r.Name?.label === name).ID;
    expect(state(top('rowVec'))).toEqual(ACTIONS.map((id) => [id, true]));
    expect(state(top('structScalar'))).toEqual(ACTIONS.map((id) => [id, false]));
  });
});

describe('a dictionary entry whose name its section holds twice', () => {
  it('offers nothing on its rows, in the payload, a repaint and a fetch; the others do', () => {
    const uri = 'test://shared-id-copy.sldd';
    opened.push(uri);
    invalidate(uri);
    const model = getModel(uri, 'twins.sldd', twinsText());
    const rows = buildRows(model);
    const byName = (name: string) => rows.filter((r: any) => r.Name?.label === name && String(r.parent).startsWith('section:'));
    const offersNothing = (r: any) => r._canCopy === false && r._canDelete === false && r._canAddChild === false;
    expect(byName('S').map(offersNothing)).toEqual([true, true]);
    const under = (name: string) => rows.filter((r: any) => String(r.ID).startsWith(`${uri}/design/${name}/`));
    expect(under('S').length).toBeGreaterThan(0);
    expect(under('S').every(offersNothing)).toBe(true);
    // The same struct under a name of its own, for contrast: copied, deleted, a field added.
    expect(flags(byName('myStruct')).map(([, ...f]) => f)).toEqual([[true, true, true]]);
    expect(under('myStruct').some((r: any) => r._canDelete)).toBe(true);
    expect(byName('gravity').map((r: any) => r._canCopy)).toEqual([true]);

    const design = model.children.find((s: any) => s.name === 'design');
    const [s1] = design.children.filter((e: any) => e.name === 'S');
    expect(buildEntryRows(s1, 'design').every(offersNothing)).toBe(true);
    const fetched = buildChildRows(s1).rows;
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every(offersNothing)).toBe(true);
    const myStruct = design.children.find((e: any) => e.name === 'myStruct');
    expect(buildChildRows(myStruct).rows.every((r: any) => r._canCopy === true)).toBe(true);
  });
});
