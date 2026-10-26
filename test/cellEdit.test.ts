// Copyright 2026 The MathWorks, Inc.
// A dictionary editor's cell edit (entryOps.cellEdit) says when the setter took the text the cell
// already showed: core answers that `true` having changed nothing, as it answers an edit it made,
// and both dictionary editors wrote the entry anyway, so an edit repeating a cell's text dirtied
// the document and respelled the entry. On MATLAB's own dictionary of multi-line Descriptions
// (test-integration/fixtures/multiline), where an <input> that dropped a line break made the
// repeated text a different one.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel } from 'data-explorer-core';
import { cellEdit } from '../src/host/entryOps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const srcId = 'cellEdit-test.sldd';
afterEach(() => DataModel.removeDataSource(srcId));

function entry(name: string): any {
  const text = readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'multiline', 'multiline_r2027a_text.sldd'), 'utf8');
  const dict: any = DataModel.addDataSource(srcId, JSON.parse(text), { path: 'multiline.sldd' });
  return (dict.children as any[]).flatMap((s) => s.children ?? []).find((e) => e.name === name);
}

describe('cellEdit', () => {
  it('a Description set to the text it shows is unchanged, and stays so', () => {
    const p = entry('pLF');
    const shown = p.toRow().Description;
    expect(cellEdit(p, p, 'Description', shown)).toEqual({ result: true, unchanged: true });
    expect(p.toRow().Description).toBe(shown);
  });

  it("the shown text is judged by core before the setter, which is not called for it", () => {
    // A setter may change the model for the text the cell shows (an object given the empty
    // Description it had none of); read off its `true`, that change would go unwritten.
    const p = entry('pLF');
    let calls = 0;
    const setProperty = p.setProperty.bind(p);
    p.setProperty = (...args: unknown[]) => {
      calls++;
      return setProperty(...args);
    };
    expect(cellEdit(p, p, 'Description', p.toRow().Description).unchanged).toBe(true);
    expect(calls).toBe(0);
    expect(cellEdit(p, p, 'Description', 'other').unchanged).toBe(false);
    expect(calls).toBe(1);
  });

  it('a Description with its line break dropped is an edit', () => {
    const p = entry('pLF');
    const flattened = String(p.toRow().Description).replace('\n', '');
    expect(cellEdit(p, p, 'Description', flattened)).toEqual({ result: true, unchanged: false });
    expect(p.toRow().Description).toBe(flattened);
  });

  it('a Value set to the text it shows is unchanged, a new one is not', () => {
    const p = entry('pOne');
    const cell = p.toRow().Value;
    expect(cellEdit(p, p, 'Value', typeof cell === 'object' ? cell.text : cell).unchanged).toBe(true);
    expect(cellEdit(p, p, 'Value', '6').unchanged).toBe(false);
  });

  it('a refusal comes back as the setter gave it, and is not unchanged', () => {
    const p = entry('pOne');
    const { result, unchanged } = cellEdit(p, p, 'Value', '[1 2');
    expect(result).toMatchObject({ error: true });
    expect(typeof result.reason).toBe('string');
    expect(unchanged).toBe(false);
  });
});
