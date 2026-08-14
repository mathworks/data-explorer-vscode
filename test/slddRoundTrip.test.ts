// Copyright 2026 The MathWorks, Inc.
//
// Issue #3 — full MATLAB round-trip for object-property editing. A MATLAB-authored
// .sldd (both the JSON-text and the compressed-binary form) holds a custom class
// object `gadget` with non-default scalar/nested-object/struct/cell properties. This
// suite drives the SAME write-back transforms the editor providers use (value edits
// via setProperty + reserialize + entry-span splice; structural add/remove via
// addChild/deleteChild) and EMITS the edited files to test/fixtures/rt_out/. A
// companion MATLAB script (test/fixtures/mcos/rt_verify.m) then reopens those files
// in R2027a and asserts every change survived — proving the bytes we write are ones
// MATLAB actually accepts and reads back correctly, not merely self-consistent JSON.
//
// The JS assertions here lock the transforms; the emitted files are the input to the
// out-of-process MATLAB verification. To reproduce the full round-trip:
//   1. In MATLAB (MyGadget/MyEngine on the path): run test/fixtures/mcos/rt_author.m
//      to (re)generate rt_text.sldd + rt_bin.sldd.
//   2. `npx vitest run slddRoundTrip` — applies the real edits, emits rt_out/*.sldd.
//   3. In MATLAB: rt_verify('rt_out/rt_text.sldd') and rt_verify('rt_out/rt_bin.sldd')
//      — asserts every change survives a genuine reopen. Last run: 20/20 PASS (R2027a).
// The generated rt_out/ files are gitignored (they are build artifacts of step 2).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, getModelFromBytes, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { reserializeEntry, addChild, deleteChild, findOwningEntry } from '../src/host/structuralEdit.js';
import { detectIndent, findEntrySpan } from '../src/host/entrySplice.js';
import { reserializeEntryXml, addChildXml, deleteChildXml } from '../src/host/xmlStructuralEdit.js';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import { serializeEntryToXml, serializeBinarySldd, buildDataChunkXml } from '../src/dex/datamodel/parser/BinarySlddSerializer.js';
import '../src/dex/datamodel/node/NodeClassMap.js';

const OUT_DIR = fileURLToPath(new URL('./fixtures/rt_out/', import.meta.url));

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}
function fixtureBytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

// The row-id path prefix for the `gadget` entry's properties (Other Data section).
function propId(uri: string, path: string): string {
  return `${uri}/other/gadget${path ? '/' + path : ''}`;
}

// ---------------------------------------------------------------------------------
// TEXT (JSON) .sldd — the SlddTextEditorProvider.applyEdit path: setProperty on the
// live node, reserializeEntry, findEntrySpan, splice. Threaded across a sequence of
// edits the way successive user edits would be (one persistent model, re-splice each
// time). The final text is written for MATLAB to reopen.
// ---------------------------------------------------------------------------------
describe('issue#3 round-trip — text .sldd write-back (drives the real JSON transform)', () => {
  const uri = 'test://rt_text';
  let finalText = '';

  beforeAll(() => {
    invalidate(uri);
    const model = getModel(uri, 'rt_text.sldd', fixture('rt_text.sldd'));
    buildRows(model); // register nodes so findNode resolves child rows
    let text = fixture('rt_text.sldd');

    // A value edit exactly as the provider applies it: mutate node, reserialize the
    // owning entry, splice its span. `entry` is stable across edits (same object).
    const valueEdit = (path: string, newValue: string) => {
      const node = findNode(uri, propId(uri, path));
      if (!node) throw new Error(`text: node not found for ${path}`);
      const entry = findOwningEntry(node);
      const nameForLookup = entry.name;
      const res = node.setProperty('Value', newValue);
      expect(res, `setProperty(${path})`).not.toHaveProperty('error');
      const indent = detectIndent(text);
      const entryText = reserializeEntry(entry, indent);
      const span = findEntrySpan(text, nameForLookup);
      if (!span) throw new Error(`text: span not found for ${nameForLookup}`);
      text = text.slice(0, span.offset) + entryText + text.slice(span.offset + span.length);
    };

    // Prop changes across every value shape:
    valueEdit('Wheels', '8'); //                       scalar
    valueEdit('Engine/Cylinders', '16'); //            nested-object scalar
    valueEdit('Specs/mass', '2000'); //                struct field
    valueEdit('Tags/2', "'zoom'"); //                  cell element (Tags{2} 'fast' -> 'zoom')

    // Structural: add a field to the Specs struct, then remove Specs.color.
    const specs = findNode(uri, propId(uri, 'Specs'));
    text = addChild(text, specs).newText; //           add child 'field' = 0
    const color = findNode(uri, propId(uri, 'Specs/color'));
    text = deleteChild(text, color).newText; //        remove child 'color'

    finalText = text;
    writeFileSync(`${OUT_DIR}/rt_text.sldd`, finalText, 'utf8');
  });

  it('emits still-valid JSON that MATLAB can reopen', () => {
    expect(() => JSON.parse(finalText)).not.toThrow();
  });

  it('reflects the scalar edit (Wheels 4 -> 8)', () => {
    expect(finalText).toContain('"Wheels": 8');
    expect(finalText).not.toContain('"Wheels": 4');
  });

  it('reflects the nested-object edit (Engine.Cylinders 12 -> 16)', () => {
    expect(finalText).toContain('"Cylinders": 16');
    expect(finalText).not.toContain('"Cylinders": 12');
  });

  it('reflects the struct-field edit (Specs.mass 1500 -> 2000)', () => {
    expect(finalText).toContain('"mass": 2000');
    expect(finalText).not.toContain('"mass": 1500');
  });

  it('reflects the cell-element edit (Tags{2} fast -> zoom)', () => {
    expect(finalText).toContain('"zoom"');
    expect(finalText).not.toContain('"fast"');
  });

  it('reflects the structural add (a new struct field) and remove (Specs.color)', () => {
    const specs = JSON.parse(finalText).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0']
      .__MW_TEXT_content.entries[0].value._elements[0]._properties.Specs;
    expect(specs._fields).toContain('field'); // added
    expect(specs._fields).not.toContain('color'); // removed
    expect(specs._fields).toContain('mass'); // untouched sibling kept
  });
});

// ---------------------------------------------------------------------------------
// BINARY (zip/XML) .sldd — the BinarySlddEditorProvider.applyEdit path: setProperty,
// serializeEntryToXml, findEntryObjectSpan, splice into chunk0.xml. The edited
// chunkXml is re-zipped (serializeBinarySldd, preserving the pass-through metadata
// parts) and written for MATLAB to reopen.
// ---------------------------------------------------------------------------------
describe('issue#3 round-trip — binary .sldd write-back (drives the real XML transform)', () => {
  const uri = 'test://rt_bin';
  let finalXml = '';

  beforeAll(() => {
    invalidate(uri);
    const model = getModelFromBytes(uri, 'rt_bin.sldd', fixtureBytes('rt_bin.sldd'));
    buildRows(model);
    // The chunk0.xml the provider edits in memory.
    let xml = buildDataChunkXml(model as any);

    const valueEdit = (path: string, newValue: string) => {
      const node = findNode(uri, propId(uri, path));
      if (!node) throw new Error(`bin: node not found for ${path}`);
      const entry = findOwningEntry(node);
      const nameForLookup = entry.name;
      const res = node.setProperty('Value', newValue);
      expect(res, `setProperty(${path})`).not.toHaveProperty('error');
      const frag = serializeEntryToXml(entry).replace(/\n$/, '');
      const span = findEntryObjectSpan(xml, nameForLookup);
      if (!span) throw new Error(`bin: span not found for ${nameForLookup}`);
      xml = xml.slice(0, span.offset) + frag + xml.slice(span.offset + span.length);
    };

    valueEdit('Wheels', '8');
    valueEdit('Engine/Cylinders', '16');
    valueEdit('Specs/mass', '2000');
    valueEdit('Tags/2', "'zoom'");

    const specs = findNode(uri, propId(uri, 'Specs'));
    xml = addChildXml(xml, specs).newText;
    const color = findNode(uri, propId(uri, 'Specs/color'));
    xml = deleteChildXml(xml, color).newText;

    finalXml = xml;
    // Re-zip the whole dictionary from the live model (preserves metadata parts).
    const bytes = serializeBinarySldd(model as any);
    writeFileSync(`${OUT_DIR}/rt_bin.sldd`, Buffer.from(bytes));
  });

  it('reflects the scalar edit (Wheels 4 -> 8)', () => {
    expect(finalXml).toMatch(/Name="Wheels"[^>]*>8\.0</);
    expect(finalXml).not.toMatch(/Name="Wheels"[^>]*>4\.0</);
  });

  it('reflects the nested-object edit (Engine.Cylinders 12 -> 16)', () => {
    expect(finalXml).toMatch(/Name="Cylinders"[^>]*>16\.0</);
    expect(finalXml).not.toMatch(/Name="Cylinders"[^>]*>12\.0</);
  });

  it('reflects the struct-field edit (Specs.mass 1500 -> 2000)', () => {
    expect(finalXml).toMatch(/Name="mass"[^>]*>2000\.0</);
    expect(finalXml).not.toMatch(/Name="mass"[^>]*>1500\.0</);
  });

  it('reflects the cell-element edit (Tags{2} fast -> zoom)', () => {
    expect(finalXml).toContain('>zoom<');
    expect(finalXml).not.toContain('>fast<');
  });

  it('reflects the structural remove (Specs.color gone) and add (a new field present)', () => {
    expect(finalXml).not.toMatch(/Name="color"/);
    expect(finalXml).toMatch(/Name="field"/);
  });
});
