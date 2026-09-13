// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { extractSlxStructure } from '../src/host/slxStructure.js';

function buf(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// Build a real .slx (a zip of the parts parseSlx reads) so these cases go through
// the actual parser rather than a hand-made ParsedSlx shape.
function slx(parts: Record<string, string>): ArrayBuffer {
  const entries: Record<string, Uint8Array> = {};
  for (const key in parts) entries[key] = strToU8(parts[key]);
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const DATA_SOURCES_XML =
  `<?xml version="1.0"?><ExternalDataSourceSettings><ExplicitExternalBrokerSources>` +
  `<fullPathToSource>signals.mat</fullPathToSource>` +
  `</ExplicitExternalBrokerSources></ExternalDataSourceSettings>`;

describe('extractSlxStructure', () => {
  it('extracts linked dictionary, model references, and external data sources', () => {
    const s = extractSlxStructure(buf('model_with_refs.slx'), 'model_with_refs.slx');
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.modelReferences).toContain('plant.slx');
    expect(s.externalDataSources).toContain('signals.mat');
  });

  it('returns empty relationships for a corrupt buffer without throwing', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.slx');
    expect(s.dataDictionary).toBeNull();
    expect(s.modelReferences).toEqual([]);
    expect(s.externalDataSources).toEqual([]);
  });

  it('returns empty relationships for an empty buffer without throwing', () => {
    const s = extractSlxStructure(new ArrayBuffer(0), 'empty.slx');
    expect(s.dataDictionary).toBeNull();
    expect(s.modelReferences).toEqual([]);
    expect(s.externalDataSources).toEqual([]);
  });

  it('maps model references to bare model-name strings (not objects)', () => {
    const s = extractSlxStructure(buf('model_with_refs.slx'), 'model_with_refs.slx');
    for (const ref of s.modelReferences) {
      expect(typeof ref).toBe('string');
    }
  });

  it('always returns arrays (never undefined) for the list fields', () => {
    const s = extractSlxStructure(new ArrayBuffer(4), 'bad.slx');
    expect(Array.isArray(s.modelReferences)).toBe(true);
    expect(Array.isArray(s.externalDataSources)).toBe(true);
  });

  it('appends .slx to a bare model name so basename resolution can match it', () => {
    // MATLAB records a reference as "plant"; the workspace file is "plant.slx".
    // Without the suffix the graph never links the two, so the model shows no
    // referenced models even though it has one.
    const s = extractSlxStructure(
      slx({
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }],
        }),
      }),
      'bare.slx',
    );
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('keeps a model name that already ends in .slx exactly as-is', () => {
    // Double-suffixing to "plant.slx.slx" would break the same graph lookup.
    const s = extractSlxStructure(
      slx({
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant.slx' }],
        }),
      }),
      'suffixed.slx',
    );
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('keeps every other relationship when one model reference has no ModelName', () => {
    // Regression: reading .modelName off such a reference threw, and the catch
    // then returned the all-empty structure — so ONE malformed reference made the
    // model appear to have no linked dictionary and no external data at all.
    const s = extractSlxStructure(
      slx({
        'simulink/blockDiagram.json': JSON.stringify({
          BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'u' },
        }),
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }, { BlockPath: 'ctrl/x' }],
        }),
        'simulink/ExternalDataSourceSettings.xml': DATA_SOURCES_XML,
      }),
      'partial.slx',
    );
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.externalDataSources).toEqual(['signals.mat']);
    // The good reference survives; the nameless one is dropped, not invented.
    expect(s.modelReferences).toEqual(['plant.slx']);
  });

  it('drops a model reference whose ModelName is empty instead of naming it ".slx"', () => {
    // A bare ".slx" resolves to no file, so it would surface in the tree as a
    // phantom Model Reference row the user cannot open.
    const s = extractSlxStructure(
      slx({
        'simulink/blockDiagram.json': JSON.stringify({ BlockDiagram: { DataDictionary: 'd.sldd' } }),
        'simulink/graphicalInterface.json': JSON.stringify({
          ModelReferences: [{ BlockPath: 'a/b', ModelName: '' }],
        }),
      }),
      'empty-name.slx',
    );
    expect(s.modelReferences).toEqual([]);
    expect(s.dataDictionary).toBe('d.sldd');
  });

  it('reports no linked dictionary as null for a model that has none', () => {
    // graphModel keys the dictionary edge off this field; '' or undefined would
    // draw an edge to a nonexistent file.
    const s = extractSlxStructure(
      slx({ 'simulink/blockDiagram.json': JSON.stringify({ BlockDiagram: { ModelUUID: 'u' } }) }),
      'nodict.slx',
    );
    expect(s.dataDictionary).toBeNull();
  });

  it('keeps the relationships of a model whose BLOCK part cannot be inflated', () => {
    // What changed when this module moved from `parseModel` to core's
    // `scanModelStructure`: the block parts are never read, so bytes that cannot be
    // inflated cannot fail to inflate. The full parse throws on this archive and the
    // catch in extractSlxStructure returned the all-empty structure for it — a model with
    // damaged block XML showed no linked dictionary and no references, which is
    // indistinguishable in the tree from a model that genuinely has none.
    //
    // The unreadability is by construction rather than by luck: the low three bits of a
    // raw deflate stream are BFINAL and a two-bit BTYPE, and `11` is the reserved value,
    // so 0xFF is refused by every inflate implementation.
    const archive = slx({
      'simulink/blockDiagram.json': JSON.stringify({
        BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'u' },
      }),
      'simulink/graphicalInterface.json': JSON.stringify({
        ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant' }],
      }),
      'simulink/ExternalDataSourceSettings.xml': DATA_SOURCES_XML,
      // Compressible on purpose, so the writer deflates rather than stores it: a stored
      // member is never inflated by anyone and would make this case vacuous.
      'simulink/systems/system_1.xml': '<System><Block/></System>'.repeat(400),
    });

    const s = extractSlxStructure(poison(archive, 'simulink/systems/system_1.xml'), 'damaged.slx');
    expect(s.dataDictionary).toBe('params.sldd');
    expect(s.modelReferences).toEqual(['plant.slx']);
    expect(s.externalDataSources).toEqual(['signals.mat']);
  });
});

/**
 * Overwrite one member's compressed bytes with 0xFF in place, leaving every header intact
 * so the archive is still perfectly walkable.
 */
function poison(archive: ArrayBuffer, target: string): ArrayBuffer {
  const out = new Uint8Array(archive.slice(0));
  const view = new DataView(out.buffer);
  const utf8 = new TextDecoder();
  let p = 0;
  while (p + 30 <= out.byteLength && view.getUint32(p, true) === 0x04034b50) {
    const method = view.getUint16(p + 8, true);
    const compressedSize = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const extraLength = view.getUint16(p + 28, true);
    const name = utf8.decode(out.subarray(p + 30, p + 30 + nameLength));
    const dataAt = p + 30 + nameLength + extraLength;
    if (name === target) {
      // Loud rather than vacuous: if the writer stored this member there is nothing to
      // fail to inflate and the case above proves nothing.
      expect(method, `${target} must be deflated for this case to mean anything`).toBe(8);
      out.fill(0xff, dataAt, dataAt + compressedSize);
      return out.buffer as ArrayBuffer;
    }
    p = dataAt + compressedSize;
  }
  throw new Error(`no local header for ${target} -- the archive layout is not what this helper assumes`);
}
