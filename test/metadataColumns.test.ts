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
import DataNode from '../src/dex/datamodel/node/DataNode.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

describe('DataNode metadata normalization', () => {
  it('normalizes the text-format keys (lastmod / modifiedby)', () => {
    const node = new DataNode('p', null);
    node.metadata = { lastmod: '20260704T015202.247897', modifiedby: 'weiwang', isderived: '0' };
    expect(node.lastModified).toBe('2026-07-04T01:52:02Z');
    expect(node.lastModifiedBy).toBe('weiwang');
  });

  it('normalizes the binary-format keys (lastModifiedDate / lastModifiedBy)', () => {
    const node = new DataNode('p', null);
    node.metadata = {
      lastModifiedDate: '2026-07-04T01:52:02Z',
      lastModifiedBy: 'weiwang',
      _rawLastMod: '20260704T015202.247897',
      isderived: '0',
    };
    expect(node.lastModified).toBe('2026-07-04T01:52:02Z');
    expect(node.lastModifiedBy).toBe('weiwang');
  });

  it('falls back to formatting _rawLastMod when no ISO date is present', () => {
    const node = new DataNode('p', null);
    node.metadata = { _rawLastMod: '20260704T015202.247897' };
    expect(node.lastModified).toBe('2026-07-04T01:52:02Z');
  });

  it('is empty when the node has no metadata', () => {
    const node = new DataNode('p', null);
    expect(node.lastModified).toBe('');
    expect(node.lastModifiedBy).toBe('');
  });

  it('is empty for a metadata blob that carries no timestamp/author', () => {
    const node = new DataNode('p', null);
    node.metadata = { uuid: 'x', namespace: 'y', isderived: '0' };
    expect(node.lastModified).toBe('');
    expect(node.lastModifiedBy).toBe('');
  });

  it('passes through a raw timestamp too short to parse', () => {
    const node = new DataNode('p', null);
    node.metadata = { lastmod: 'bogus' };
    expect(node.lastModified).toBe('bogus');
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
