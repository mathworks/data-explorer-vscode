// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';
import DataModel from '../src/dex/core/DataModel.js';
import { findNode } from '../src/host/SlddModel.js';
import { buildPropertyGroups } from '../src/host/piBuilder.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

// The editable binary-SLDD provider registers its model in the global DataModel
// singleton under a PREFIXED srcId (so it never collides with the read-only
// provider's cached model), and NEVER populates SlddModel's per-URI `cache`.
// Selection→PI resolution goes through findNode(uriString, rowId); this test
// pins that findNode still resolves such nodes (regression: it used to bail on a
// missing cache entry, so binary table selections never rendered a PI).
const SRC_PREFIX = 'binedit:'; // must mirror BinarySlddEditorProvider

function loadAsBinaryProvider(rel: string, uriString: string): any {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  const bytes = readFileSync(path);
  const zip = unzipSync(bytes);
  const chunkXml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const zipMeta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') zipMeta[k] = v;
  const content = parseBinarySlddParts(chunkXml, zipMeta);
  // Registered under the prefixed srcId, exactly like the provider.
  return (DataModel as any).addDataSource(SRC_PREFIX + uriString, content, { path: 'x.sldd' });
}

describe('findNode resolves binary-SLDD selections for the Property Inspector', () => {
  it('resolves a leaf entry by row id even though SlddModel.cache is empty for the uri', () => {
    const uriString = 'file:///regress-binary.sldd';
    const root = loadAsBinaryProvider('./parity/artifacts/binary/params.sldd', uriString);
    const gravity = root.flatten().find((n: any) => n.name === 'gravity');
    expect(gravity).toBeTruthy();

    // The selection path: extension.showSelection -> findNode(uriString, rowId).
    const resolved = findNode(uriString, gravity.id);
    expect(resolved).toBe(gravity);

    // And the PI actually builds groups for it (the user-visible symptom).
    const groups = buildPropertyGroups(resolved);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map((g) => g.title)).toContain('Code Generation');
  });

  it('returns null for an unknown row id', () => {
    const uriString = 'file:///regress-binary2.sldd';
    loadAsBinaryProvider('./parity/artifacts/binary/params.sldd', uriString);
    expect(findNode(uriString, 'no-such-node-id')).toBeNull();
  });
});
