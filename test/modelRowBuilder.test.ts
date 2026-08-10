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
