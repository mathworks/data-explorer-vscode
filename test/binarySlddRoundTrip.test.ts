// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/dex/core/DataModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';
import {
  serializeBinarySldd,
  buildDataChunkXml,
  serializeEntryToXml,
} from '../src/dex/datamodel/parser/BinarySlddSerializer.js';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';

function loadZip(fixture: string) {
  const p = fileURLToPath(new URL('./parity/artifacts/binary/' + fixture, import.meta.url));
  const bytes = readFileSync(p);
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return { zip, xml, meta };
}

describe('binary sldd round-trip', () => {
  it('pass-through parts are byte-identical after re-serialize', () => {
    DataModel.removeDataSource('mem://rt1');
    const { zip, xml, meta } = loadZip('params.sldd');
    const model = DataModel.addDataSource('mem://rt1', parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    const out = serializeBinarySldd(model);
    const outZip = unzipSync(new Uint8Array(out));
    for (const name of Object.keys(meta)) {
      expect(Array.from(outZip[name] ?? [])).toEqual(Array.from(zip[name]));
    }
  });

  it('save gate: buildDataChunkXml output re-parses without throwing', () => {
    DataModel.removeDataSource('mem://rt2');
    const { xml, meta } = loadZip('params.sldd');
    const model = DataModel.addDataSource('mem://rt2', parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    const rebuilt = buildDataChunkXml(model);
    expect(() => parseBinarySlddParts(rebuilt, meta)).not.toThrow();
    const reparsed = parseBinarySlddParts(rebuilt, meta) as any;
    const origNames = model.children.flatMap((s: any) => s.children.map((e: any) => e.name)).sort();
    const rows = reparsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const newNames = rows.map((e: any) => e.name).sort();
    expect(newNames).toEqual(origNames);
  });

  it('value-edit splice: touched entry reflects the edit, untouched siblings stay byte-identical', () => {
    DataModel.removeDataSource('mem://rt3');
    const { xml, meta } = loadZip('params.sldd');
    const model = DataModel.addDataSource('mem://rt3', parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    const entries = model.children.flatMap((s: any) => s.children);
    // Edit a scalar-double entry's Description (a char property present on objects).
    const target = entries.find((e: any) => e.name === 'gravity') ?? entries[0];
    const other = entries.find((e: any) => e.name !== target.name);

    const beforeOther = findEntryObjectSpan(xml, other.name)!;
    const beforeOtherText = xml.slice(beforeOther.offset, beforeOther.offset + beforeOther.length);

    // Rename via the model, then splice just that entry's regenerated fragment.
    const oldName = target.name;
    const res = target.setProperty('Name', oldName + '_edited');
    expect(res).toBe(true);
    const frag = serializeEntryToXml(target).replace(/\n$/, '');
    const span = findEntryObjectSpan(xml, oldName)!;
    const newText = xml.slice(0, span.offset) + frag + xml.slice(span.offset + span.length);

    // Untouched sibling is byte-identical.
    const afterOther = findEntryObjectSpan(newText, other.name)!;
    expect(newText.slice(afterOther.offset, afterOther.offset + afterOther.length)).toBe(beforeOtherText);
    // Edited entry present under the new name; the old name is gone.
    expect(findEntryObjectSpan(newText, oldName + '_edited')).not.toBeNull();
    expect(findEntryObjectSpan(newText, oldName)).toBeNull();
    // The whole document still re-parses.
    expect(() => parseBinarySlddParts(newText, meta)).not.toThrow();
  });
});
