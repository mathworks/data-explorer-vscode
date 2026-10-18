// Copyright 2026 The MathWorks, Inc.
// Every cell data-explorer-core sends for a Simulink.VariantBank's or a
// Simulink.VariantBankCoderInfo's row has a column to be shown in, under a label and a picker
// group (C-168B and C-169B, ruled 2026-10-18, group F).
//
// Core 1.41.0 reads these classes' own fields and sends each as an editable cell keyed by its
// column. A cell whose key is not in COLUMNS is never drawn: the table shows only the columns
// the host lists, so before this the fields were sent, and could be neither seen nor edited.
// Driven through the real host modules over core's MATLAB-written fixtures, in both formats:
// SlddModel reads the file as a tab does, and rowBuilder builds the rows as a paint does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, getModelFromBytes } from '../src/host/SlddModel.js';
import { buildEntryRows, COLUMNS, COLUMN_GROUPS, COLUMN_LABELS } from '../src/host/rowBuilder.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../test-integration/fixtures/classes/${name}`, import.meta.url)));

function entries(format: 'JSON' | 'binary'): Map<string, any> {
  const uri = `file:///variantBankColumns/${format}.sldd`;
  DataModel.removeDataSource(uri);
  let root: any;
  if (format === 'JSON') {
    root = getModel(uri, 'variantbank_r2027a_text.sldd', fixture('variantbank_r2027a_text.sldd').toString('utf8'));
  } else {
    const bytes = fixture('variantbank_r2027a_binary.sldd');
    root = getModelFromBytes(
      uri,
      'variantbank_r2027a_binary.sldd',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  }
  const out = new Map<string, any>();
  for (const section of root.children) for (const entry of section.children) out.set(entry.name, entry);
  return out;
}

/** The entry's own row, as a paint builds it. */
const rowOf = (entry: any) => buildEntryRows(entry, entry.parent.name)[0];

/** The keys of the cells this row offers an editor for, but the entry's Name, which every row has. */
const editableCells = (row: any): string[] =>
  Object.keys(row).filter(
    (k) => k !== 'Name' && row[k] !== null && typeof row[k] === 'object' && row[k].editable === true,
  );

// The labels and groups the ruling names. The labels are the ones core's own Property
// Inspector shows for these fields, so a column and its PI row read alike.
const EXPECTED: Record<string, [string, string]> = {
  bankName: ['Bank Name', 'Variant Bank'],
  variantConditions: ['Variant Conditions', 'Variant Bank'],
  allChoicesCoderInfo: ['All Choices Coder Info', 'Variant Bank'],
  activeChoiceCoderInfo: ['Active Choice Coder Info', 'Variant Bank'],
  headerFile: ['Header File', 'Code Generation'],
  definitionFile: ['Definition File', 'Code Generation'],
  preStatement: ['Pre Statement', 'Code Generation'],
  postStatement: ['Post Statement', 'Code Generation'],
  qualifier: ['Qualifier', 'Code Generation'],
};

describe.each(['JSON', 'binary'] as const)('a %s dictionary of VariantBanks and VariantBankCoderInfos', (format) => {
  const byName = entries(format);

  it('the fixture holds the rows this is about, with the cells core sends for them', () => {
    // Guards: what core sends is the premise, so a core that stopped sending a cell would show
    // here rather than as a vacuous pass below.
    expect(editableCells(rowOf(byName.get('vbN'))).sort()).toEqual(
      ['activeChoiceCoderInfo', 'allChoicesCoderInfo', 'bankName', 'variantConditions'],
    );
    expect(editableCells(rowOf(byName.get('ciA'))).sort()).toEqual(
      ['definitionFile', 'headerFile', 'postStatement', 'preStatement', 'qualifier'],
    );
  });

  for (const name of ['vbN', 'vb1', 'vbD', 'ciA', 'ciB']) {
    it(`every editable cell of ${name}'s row has a column, a label and a picker group`, () => {
      const row = rowOf(byName.get(name));
      const cells = editableCells(row);
      expect(cells.length).toBeGreaterThan(0);
      for (const column of cells) {
        expect(COLUMNS, `${column} is a column`).toContain(column);
        expect([COLUMN_LABELS[column], COLUMN_GROUPS[column]], `${column}'s label and group`).toEqual(EXPECTED[column]);
      }
    });
  }

  it("the Pre and Post Statement cells ask for the textArea editor, and Qualifier is a choice of MATLAB's four", () => {
    const ciA = rowOf(byName.get('ciA'));
    expect(ciA.preStatement.editor).toBe('textArea');
    expect(ciA.postStatement.editor).toBe('textArea');
    expect(ciA.qualifier).toEqual({
      text: 'Const',
      editable: true,
      editor: 'select',
      options: ['None', 'Const', 'Volatile', 'ConstVolatile'],
    });
    expect(ciA._descriptionEditable).toBe(false);
  });
});

describe('the new columns in COLUMNS', () => {
  it('sit in their picker groups, each group in one run, before the dictionary metadata', () => {
    // The column picker draws a group header wherever the group changes, so a group split by
    // another column would be drawn twice.
    const groups = COLUMNS.map((c) => COLUMN_GROUPS[c] ?? null);
    const runs = groups.filter((g, i) => g !== null && g !== groups[i - 1]);
    expect(runs).toEqual(['Data Object', 'Code Generation', 'Variant Bank', 'Data Dictionary']);
  });
});
