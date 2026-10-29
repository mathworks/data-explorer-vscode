// Copyright 2026 The MathWorks, Inc.
//
// Where a Paste on a row lands, asked of both halves for EVERY row of real dictionaries.
//
// The webview has no model, so it answers from the rows: sectionRowIdOf walks `parent` to the
// owning entry and takes that entry's section (operands.ts). The host answers from the model:
// resolveSectionForPaste takes the owning entry's parent, or looks a header row's section up by
// name (structuralEdit.ts). The menu enables Paste, and runs the target's allow-check, against
// the webview's answer; the host pastes into its own. If the two ever named different sections
// for one row, the menu would vouch for a paste the host then refuses, or lands elsewhere —
// this repo's "one rule, two paths" bug class — so they are compared row by row here, at every
// depth, on both .sldd formats.
//
// And the menu's Cut and Delete each read the capability flag of the row they act on: Cut the
// owning ENTRY's (it deletes the entry it copied), Delete the selected row's. Pinned on a child
// of an entry that may not be deleted, with the menu naming the row its reason is about.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, DATA_PART_XML, parseBinarySlddParts } from 'data-explorer-core';
import { buildRows, buildSectionRowId, sectionRowIdOf } from 'data-explorer-view/model';
import { getModel, invalidate, findNode } from 'data-explorer-view/host';
import { resolveSectionForPaste } from '../src/host/structuralEdit.js';
import { buildContextMenuItems, type MenuRow } from 'data-explorer-view/tree-table';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (p: string) => fileURLToPath(new URL(`./${p}`, import.meta.url));

const JSON_FIXTURES = [
  'parity/artifacts/text/params.sldd',
  'fixtures/params.sldd',
  'fixtures/arch.sldd',
  'fixtures/object_props_text.sldd',
  'fixtures/object_array_text.sldd',
];
const BINARY_FIXTURES = [
  'parity/artifacts/binary/params.sldd',
  'fixtures/arch_binary.sldd',
  'fixtures/nested_objects.sldd',
  'fixtures/sldd-stream-objects/stream_objects_binary.sldd',
];

function agreeOnEveryRow(model: any, find: (id: string) => any): number {
  const rows = buildRows(model) as MenuRow[];
  expect(rows.length).toBeGreaterThan(0);
  let deep = 0;
  for (const row of rows) {
    const node = find(row.ID);
    const host = resolveSectionForPaste(model, node, row.ID);
    const fromHost = host ? buildSectionRowId(host.name) : null;
    expect(sectionRowIdOf(row.ID, rows), `row ${row.ID}`).toBe(fromHost);
    if (typeof row.parent === 'string' && !row.parent.startsWith('section:')) deep++;
  }
  return deep;
}

describe('sectionRowIdOf and resolveSectionForPaste name the same section for every row', () => {
  for (const file of JSON_FIXTURES) {
    it(`JSON ${file}`, () => {
      const uri = `test://paste-agree/${file}`;
      invalidate(uri);
      const model = getModel(uri, file.split('/').pop()!, readFileSync(fixture(file), 'utf8'));
      agreeOnEveryRow(model, (id) => findNode(uri, id));
      invalidate(uri);
    });
  }

  for (const file of BINARY_FIXTURES) {
    it(`binary ${file}`, () => {
      const zip = unzipSync(new Uint8Array(readFileSync(fixture(file))));
      const xml = new TextDecoder().decode(zip[DATA_PART_XML]);
      const meta: Record<string, Uint8Array> = {};
      for (const [k, v] of Object.entries(zip)) if (k !== DATA_PART_XML) meta[k] = v;
      const srcId = `binedit:test://paste-agree/${file}`;
      const model = DataModel.addDataSource(srcId, parseBinarySlddParts(xml, meta), { path: 'x.sldd' });
      agreeOnEveryRow(model, (id) => (DataModel as any).findNodeById(id));
      DataModel.removeDataSource(srcId);
    });
  }

  it('reaches nested rows, so the agreement is not only about entries', () => {
    const uri = 'test://paste-agree/deep';
    invalidate(uri);
    const model = getModel(uri, 'params.sldd', readFileSync(fixture('parity/artifacts/text/params.sldd'), 'utf8'));
    expect(agreeOnEveryRow(model, (id) => findNode(uri, id))).toBeGreaterThan(0);
    invalidate(uri);
  });

  it('a row id that is not a string, or that the table does not hold, names no section on either side', () => {
    expect(sectionRowIdOf(undefined as any, [])).toBeNull();
    expect(sectionRowIdOf(42 as any, [])).toBeNull();
    expect(resolveSectionForPaste(null, null, 42 as any)).toBeNull();
    // A MAT-file's rows have no section rows above them.
    expect(sectionRowIdOf('v', [{ ID: 'v' }])).toBeNull();
    expect(resolveSectionForPaste(null, null, 'v')).toBeNull();
  });
});

describe('Cut reads the owning entry’s flag, Delete the row’s', () => {
  const ROWS: MenuRow[] = [
    { ID: 'section:design', Name: { label: 'Design Data' } },
    // An entry that may not be deleted (say, one a reference holds), with a removable child.
    { ID: 'u/design/Locked', parent: 'section:design', Name: { label: 'Locked' }, _canCopy: true, _canDelete: false },
    { ID: 'u/design/Locked/f', parent: 'u/design/Locked', Name: 'f', _canCopy: true, _canDelete: true },
    { ID: 'u/design/Free', parent: 'section:design', Name: { label: '' }, _canCopy: true, _canDelete: true },
  ];
  const menu = (selected: string[]) =>
    buildContextMenuItems({
      rows: ROWS,
      selectedRowIds: selected,
      anchorRowId: selected[0],
      clipboard: { canPaste: false, mode: null, items: [] },
      editable: true,
      hasTextView: false,
      pasteTarget: null,
    });
  const item = (items: any[], id: string) => items.find((i) => i.id === id);

  it('on the child: Cut is refused naming the entry, Copy and Delete are offered', () => {
    const items = menu(['u/design/Locked/f']);
    expect(item(items, 'cut')).toMatchObject({ label: 'Cut "Locked"', disabled: true, reason: '"Locked" can\'t be cut' });
    expect(item(items, 'copy')).toMatchObject({ label: 'Copy "Locked"', disabled: false });
    // A Name that is a plain string is the name too.
    expect(item(items, 'delete')).toMatchObject({ label: 'Delete "f"', disabled: false });
  });

  it('a row with no name is called by its id', () => {
    const items = menu(['u/design/Free']);
    expect(item(items, 'copy').label).toBe('Copy "u/design/Free"');
    expect(item(items, 'cut').disabled).toBe(false);
  });

  it('with a deletable entry in the selection, the undeletable one is still the one named', () => {
    const items = menu(['u/design/Free', 'u/design/Locked/f']);
    expect(item(items, 'cut')).toMatchObject({ label: 'Cut 2 Entries', disabled: true, reason: '"Locked" can\'t be cut' });
  });
});
