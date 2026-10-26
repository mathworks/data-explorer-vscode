// Copyright 2026 The MathWorks, Inc.
// The host's answer to a table's `requestEditText` (editTextRequest.ts), on rows core builds from a
// MATLAB-written MAT-file: the whole text of a Value shown as a summary for its size, which seeds
// the editor the user is opening; none where the row shows its own text; and core's reason where a
// Value takes no editor at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataModel } from 'data-explorer-core';
import { answerEditTextRequest } from '../src/host/editTextRequest.js';
import type { EditTextMessage } from '../src/common/protocol.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LONG = '[' + Array.from({ length: 500 }, (_, i) => i + 1).join(' ') + ']';
const srcId = 'binedit:file:///work/edit-text.mat';
let mat: any;

beforeEach(() => {
  const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'test-integration', 'fixtures', 'mat', 'cases.mat')));
  mat = DataModel.addMatSource(srcId, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { path: 'cases.mat' });
});
afterEach(() => DataModel.removeDataSource(srcId));

const variable = (name: string): any => (mat.children as any[]).find((v) => v.name === name);
const findNode = (rowId: string) => (DataModel as any).findNodeById(rowId) ?? null;

function answer(rowId: string): EditTextMessage[] {
  const posted: EditTextMessage[] = [];
  answerEditTextRequest((m) => posted.push(m), findNode, rowId, (text) => text.split(srcId).join('cases.mat'));
  return posted;
}

describe('the answer to requestEditText', () => {
  it('is the whole text of a Value shown as a summary, which the row only marks', () => {
    const v = variable('rowVec');
    DataModel.setActive(mat, v);
    expect(DataModel.editProperty(v.id, 'Value', LONG, v.toRow().Value)).toBe(true);
    const row = variable('rowVec').toRow();
    expect([row.Value, row._valueEditable, row._hasEditText, '_editText' in row]).toEqual(['<1x500 double>', true, true, false]);
    expect(answer(row.ID)).toEqual([{ type: 'editText', rowId: row.ID, text: LONG }]);
  });

  it('is none, and says nothing, for a Value the row shows whole', () => {
    expect(answer(variable('scalarD').id)).toEqual([{ type: 'editText', rowId: variable('scalarD').id, text: null }]);
  });

  it("is none, with core's reason, for a Value that takes no editor", () => {
    const [m] = answer(variable('structScalar').id);
    expect(m.text).toBeNull();
    expect(m.reason).toBe(DataModel.valueEditRefusal(variable('structScalar').id));
    expect(m.reason).toMatch(/^Cannot edit the Value of "structScalar": /);
  });

  it('is none for a row no longer there', () => {
    expect(answer('binedit:file:///work/edit-text.mat/gone')).toEqual([
      { type: 'editText', rowId: 'binedit:file:///work/edit-text.mat/gone', text: null },
    ]);
  });
});
