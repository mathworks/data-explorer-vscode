// Copyright 2026 The MathWorks, Inc.
//
// Dictionary-entry metadata columns (Last Modified / Last Modified By). The
// underlying timestamp/author is parsed onto DataNode.metadata under two
// different key schemes depending on the source format (text `.sldd` vs binary
// `.sldd`); the node getters normalize both to a single display string, and the
// row builder stamps them onto the top-level entry row.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

describe('Last Modified is refreshed on edit (_stampLastModified)', () => {
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  it('every edit funnels through _markModified, so setProperty refreshes the timestamp', () => {
    // Prove the wiring end-to-end on a real Parameter: an edit stamps a newer
    // timestamp than the one parsed from the fixture.
    const node = loadModel('text');
    const gravity = (() => {
      for (const s of node.children ?? []) for (const e of s.children ?? []) if (e.name === 'gravity') return e;
      throw new Error('gravity not found');
    })();
    const before = gravity.metadata.lastmod as string;
    gravity.setProperty('Value', '42');
    expect(gravity.metadata.lastmod).not.toBe(before);
    expect(gravity.lastModified).toMatch(ISO_RE);
    expect(gravity.status).toBe('Modified');
  });
});

const ART = (variant: string, name: string) =>
  fileURLToPath(new URL(`./parity/artifacts/${variant}/${name}`, import.meta.url));

function loadModel(variant: string): any {
  const uri = `metacol://${variant}/params.sldd`;
  const raw = readFileSync(ART(variant, 'params.sldd'));
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  invalidate(uri);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return isZip ? getModelFromBytes(uri, 'params.sldd', ab) : getModel(uri, 'params.sldd', raw.toString('utf8'));
}

function gravityRow(variant: string): any {
  const rows = buildRows(loadModel(variant));
  const row = rows.find((r) => r.Name?.label === 'gravity');
  if (!row) {
    throw new Error('gravity row not found in ' + variant);
  }
  return row;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe('metadata columns from real fixtures: JSON and binary gravity Parameter', () => {
  // The two parity fixtures are independently-saved artifacts, so gravity's
  // timestamp differs between them; what must match is the normalized SHAPE
  // (ISO 'YYYY-MM-DDThh:mm:ssZ') and the author — proving both parse-path key
  // schemes normalize identically.
  it('the text-format entry row carries the normalized ISO timestamp + author', () => {
    const t = gravityRow('text');
    expect(t.lastModified).toBe('2026-07-04T01:52:02Z');
    expect(t.lastModifiedBy).toBe('weiwang');
  });

  it('the binary-format entry row normalizes to the same shape and author', () => {
    const b = gravityRow('binary');
    expect(b.lastModified).toMatch(ISO);
    expect(b.lastModifiedBy).toBe('weiwang');
  });
});
