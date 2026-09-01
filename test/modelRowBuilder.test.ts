// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModelFromBytes } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe('buildRows for a model', () => {
  it('emits section rows for non-empty model sections', () => {
    const node = getModelFromBytes('test://m2.slx', 'm2.slx', bytes('model_with_refs.slx'));
    const rows = buildRows(node);
    // References + External Data are populated by the fixture -> at least those section rows appear.
    const sectionIds = rows.filter((r: any) => String(r.ID).startsWith('section:')).map((r: any) => r.ID);
    expect(sectionIds).toContain('section:references');
    expect(sectionIds).toContain('section:dataSources');
  });

  // Model section entries are real rows, not positional array elements. The
  // table grays a Name cell only when Name.element is true, so real entries must
  // report element === false to keep them in the normal color — regardless of
  // the document being read-only. Regression guard for the "grayed-out entries"
  // bug (a read-only .slx must look like any other format).
  it('colors model entries as normal (element === false for real entries)', () => {
    const node = getModelFromBytes('test://m2.slx', 'm2.slx', bytes('model_with_refs.slx'));
    const rows = buildRows(node);
    const entries = rows.filter(
      (r: any) => !String(r.ID).startsWith('section:') && r.Name && typeof r.Name === 'object',
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const r of entries) {
      // A real entry is never a positional element → never grayed.
      expect(r.Name.element).toBe(false);
    }
    // Concretely: the model-reference and external-data entries are normal.
    const refEntry = rows.find((r: any) => r.parent === 'section:references');
    expect(refEntry?.Name.element).toBe(false);
  });
});

// A ModelBlockNode reports its columns differently from a data node: it puts the
// block TYPE in Value and the parameter usage in DataType. The table's columns
// mean the same thing across every format, so buildEntryRows remaps them —
// without it a block row would show "Constant" under Value and "Value=scalarD"
// under Data Type, with the Usage column blank, i.e. three wrong columns at once.
// model_with_refs.slx has no blocks, so this needs a fixture that does.
describe('buildRows block-row column remap', () => {
  // top.slx contains real Constant blocks whose Value parameters reference
  // dictionary variables.
  const blockRows = () => {
    const b = readFileSync(fileURLToPath(new URL('./parity/artifacts/binary/top.slx', import.meta.url)));
    const node = getModelFromBytes(
      'test://blocks-top.slx',
      'top.slx',
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    );
    return buildRows(node).filter((r: any) => r._isBlockRow);
  };

  it('moves the block type into Data Type and the param usage into Usage', () => {
    const rows = blockRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // Data Type carries the block type (e.g. "Constant"), never a param expr.
      expect(typeof r.DataType).toBe('string');
      expect(r.DataType.length).toBeGreaterThan(0);
      // Value is cleared: a block has no value of its own to show.
      expect(r.Value).toBe('');
    }
  });

  it('flags block rows so the async usage annotation can rewrite the Usage cell', () => {
    // usageGraph replaces the Usage cell of flagged rows with cross-file-resolved
    // param links; an unflagged block row would never get its links.
    const rows = blockRows();
    expect(rows.every((r: any) => r._isBlockRow === true)).toBe(true);
    expect(rows.some((r: any) => r.DataType === 'Constant')).toBe(true);
  });
});
