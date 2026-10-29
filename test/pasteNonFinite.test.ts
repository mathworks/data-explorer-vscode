// Copyright 2026 The MathWorks, Inc.
//
// A copied Inf, -Inf, NaN or -0 is pasted as itself.
//
// A binary dictionary's reader holds a scalar double as a bare JS number, so an Inf is
// `Infinity` in the entry's serialized record — the record a copy or a drag carries — and so is
// a struct field's, or a Simulink.Parameter's Value, Min and Max. A paste deep-copied that record
// with a JSON round trip, which has no spelling for any of them: Infinity, -Infinity and NaN came
// out as null, and -0 as 0. The pasted entry then read, and saved, as a different value — with
// nothing said, because null is a value too.
//
// The record goes through the real copy (buildClipboardSnapshot, as both providers copy) and the
// real paste (pasteEntriesXml / pasteEntries, as their transfer adapters paste), into a binary
// and a JSON dictionary, and the result is read back from the TEXT the paste wrote. What is
// compared is what the table shows for each value, row by row: a JSON dictionary spells a
// non-finite scalar otherwise than a binary one does, so the records differ by format and only
// the values they mean can be compared.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, parseBinarySlddParts } from 'data-explorer-core';
import { buildEntryRows } from 'data-explorer-view/model';
import { getModel, invalidate } from 'data-explorer-view/host';
import { buildClipboardSnapshot, cloneForPaste, pasteEntries, sectionByName } from '../src/host/structuralEdit.js';
import { entryRecord } from '../src/host/entryOps.js';
import { pasteEntriesXml } from '../src/host/xmlStructuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const binaryZip = unzipSync(new Uint8Array(readFileSync(here('./parity/artifacts/binary/params.sldd'))));
const jsonText = readFileSync(here('../test-integration/fixtures/workspace/params.sldd'), 'utf8');

/** One DD.ENTRY of Design Data, as MATLAB writes it, around `value`. */
function entryXml(name: string, value: string, uuidTail: string): string {
  return `<Object Class="DD.ENTRY">
        <P Name="Name" Class="char">${name}</P>
        <P Name="UUID" Class="char">0e0e0e0e-0000-4000-8000-${uuidTail}</P>
        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>
        <P Name="LastMod" Class="char">20261023T120000.000000</P>
        <P Name="LastModBy" Class="char">fixture</P>
        <P Name="IsDerived" Class="char">0</P>
        ${value}
    </Object>
    `;
}

// Every place a binary dictionary's reader holds a non-finite or negative-zero double as a bare
// number: a scalar entry, a struct field, and an object's properties.
const NON_FINITE: [string, string][] = [
  ['nfInf', '<P Name="Value" Class="double">Inf</P>'],
  ['nfNegInf', '<P Name="Value" Class="double">-Inf</P>'],
  ['nfNaN', '<P Name="Value" Class="double">NaN</P>'],
  ['nfNegZero', '<P Name="Value" Class="double">-0.0</P>'],
  ['nfRow', '<P Name="Value" Class="double" Dimension="1*3">Inf NaN -0.0</P>'],
  [
    'nfStruct',
    '<P Name="Value" Class="struct"><Element><P Name="a" Class="double">Inf</P>' +
      '<P Name="b" Class="double" Dimension="1*2">-Inf NaN</P><P Name="c" Class="double">-0.0</P>' +
      '<P Name="d" Class="double">NaN</P></Element></P>',
  ],
  [
    'nfParam',
    '<P Name="Value"><Element Class="Simulink.Parameter"><P Name="Value" Class="double">Inf</P>' +
      '<P Name="Min" Class="double">-Inf</P><P Name="Max" Class="double">NaN</P></Element></P>',
  ],
];
const NAMES = NON_FINITE.map(([name]) => name);

/** The params chunk with the non-finite entries at the head of Design Data. */
function sourceChunk(): string {
  const xml = new TextDecoder().decode(binaryZip['data/chunk0.xml']);
  const at = xml.indexOf('<Object Class="DD.ENTRY">');
  const added = NON_FINITE.map(([name, value], i) => entryXml(name, value, String(i).padStart(12, '0'))).join('');
  return xml.slice(0, at) + added + xml.slice(at);
}

const passThrough = (): Record<string, Uint8Array> => {
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(binaryZip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return meta;
};

function binaryModel(srcId: string, chunk: string): any {
  DataModel.removeDataSource(srcId);
  return DataModel.addDataSource(srcId, parseBinarySlddParts(chunk, passThrough()), { path: 'params.sldd' });
}

const entryOf = (model: any, name: string): any =>
  (model.children as any[]).flatMap((s: any) => s.children).find((e: any) => e.name === name);

/** What the table shows for an entry: each row's place under the entry, and its Value cell. */
function shown(entry: any): string[] {
  expect(entry, 'the entry is there').toBeTruthy();
  const rows = buildEntryRows(entry, entry.parent?.name ?? '', new Set(), undefined);
  return rows.map((r: any) => {
    const where = String(r.ID).slice(String(entry.id).length) || '.';
    const value = r.Value?.label ?? r.Value ?? '';
    return `${where} = ${typeof value === 'string' ? value : JSON.stringify(value)}`;
  });
}

/** The copy both providers make: every entry, snapshotted onto the clipboard's items. */
function copied(): { source: any; payloads: Record<string, unknown>[] } {
  const source = binaryModel('test://nonfinite-source.sldd', sourceChunk());
  const rowIds = NAMES.map((n) => entryOf(source, n).id);
  const items = buildClipboardSnapshot(rowIds, (id) => (DataModel as any).findNodeById(id));
  expect(items.map((i) => i.payload.name)).toEqual(NAMES);
  return { source, payloads: items.map((i) => i.payload) };
}

describe('a copied non-finite or negative-zero double', () => {
  it('is carried by the clipboard record as the number it is', () => {
    // The precondition the paste depends on: the snapshot itself loses nothing (it is the
    // entry's own serialize(), not a JSON round trip).
    const { payloads } = copied();
    const value = (name: string) => payloads.find((p) => p.name === name)!.value;
    expect(value('nfInf')).toBe(Infinity);
    expect(value('nfNegInf')).toBe(-Infinity);
    expect(Number.isNaN(value('nfNaN'))).toBe(true);
    expect(Object.is(value('nfNegZero'), -0)).toBe(true);
  });

  it('survives the paste clone', () => {
    const { payloads } = copied();
    for (const payload of payloads) {
      const clone = cloneForPaste(payload);
      expect(clone, `${String(payload.name)} is a copy, not the record itself`).not.toBe(payload);
      expect(clone).toEqual(payload);
      // toEqual takes -0 for 0; the sign of a zero is part of the value.
      const zeros = (v: unknown): unknown[] =>
        typeof v === 'number' ? [Object.is(v, -0)] : v && typeof v === 'object' ? Object.values(v).flatMap(zeros) : [];
      expect(zeros(clone)).toEqual(zeros(payload));
    }
  });

  it('pasted into a binary dictionary, reads back from the chunk as the same values', () => {
    const { source, payloads } = copied();
    const target = binaryModel('test://nonfinite-target.sldd', new TextDecoder().decode(binaryZip['data/chunk0.xml']));
    const { newText } = pasteEntriesXml(
      new TextDecoder().decode(binaryZip['data/chunk0.xml']),
      sectionByName(target, 'design'),
      payloads,
    );
    const reread = binaryModel('test://nonfinite-reread.sldd', newText);
    for (const name of NAMES) {
      expect(shown(entryOf(reread, name)), name).toEqual(shown(entryOf(source, name)));
    }
    // And the numbers themselves, where the reader holds them bare — the table shows a -0 as 0,
    // so only the value can say its sign survived.
    const value = (name: string) => entryOf(reread, name).serialize().value;
    expect(value('nfInf')).toBe(Infinity);
    expect(value('nfNegInf')).toBe(-Infinity);
    expect(value('nfNaN')).toBeNaN();
    expect(Object.is(value('nfNegZero'), -0), '-0 kept its sign').toBe(true);
    const field = value('nfStruct')._elements[0];
    expect([field.a, Object.is(field.c, -0)]).toEqual([Infinity, true]);
    expect(field.d).toBeNaN();
    const props = value('nfParam')._elements[0]._properties;
    expect([props.Value, props.Min]).toEqual([Infinity, -Infinity]);
    expect(props.Max).toBeNaN();
  });

  it('an undo record of such an entry keeps the numbers too', () => {
    // entryRecord, which every undo and redo of a binary or JSON edit replays when it has no
    // bytes to rebuild from, made the same JSON round trip.
    const { source } = copied();
    const record = entryRecord(entryOf(source, 'nfParam')) as any;
    const props = record.value._elements[0]._properties;
    expect([props.Value, props.Min]).toEqual([Infinity, -Infinity]);
    expect(props.Max).toBeNaN();
    expect(Object.is((entryRecord(entryOf(source, 'nfNegZero')) as any).value, -0)).toBe(true);
  });

  // A text dictionary spells a non-finite number as text, which core does not yet do for a value
  // handed in bare (MatWriter.textDictionaryForm leaves a primitive as it is), and the host writes
  // JSON with JSON.stringify, which writes it as null. So each such entry is either refused,
  // naming it, with nothing written — today — or, once core spells it, pasted and read back as
  // the same value. Never a null. A -0 is neither: JSON.stringify writes it as 0 for every write
  // to a text dictionary, an edited value's too, and the table shows both as 0.
  it('pasted into a JSON dictionary, is refused by name or reads back as itself — never as null', () => {
    const { source, payloads } = copied();
    const refused: string[] = [];
    for (const payload of payloads) {
      const name = String(payload.name);
      const uri = `test://nonfinite-target-${name}.json.sldd`;
      invalidate(uri);
      const target = getModel(uri, 'params.sldd', jsonText);
      let newText: string;
      try {
        newText = pasteEntries(jsonText, sectionByName(target, 'design'), [payload]).newText;
      } catch (err) {
        expect((err as Error).message).toMatch(
          new RegExp(`^Cannot paste "${name}" into a text dictionary: it holds (Inf|-Inf|NaN)( \\(in [\\w.]+\\))?, `),
        );
        refused.push(name);
        continue;
      }
      expect(newText, `${name} was not written with a null`).not.toMatch(/"(?:Value|Min|Max|value|a|c|d)":\s*null/);
      const rereadUri = `test://nonfinite-reread-${name}.json.sldd`;
      invalidate(rereadUri);
      expect(shown(entryOf(getModel(rereadUri, 'params.sldd', newText), name)), name).toEqual(shown(entryOf(source, name)));
    }
    expect(refused, 'a -0, which JSON can carry, is never refused').not.toContain('nfNegZero');
    // The row vector is held as its typed text by both readers, so it was never at risk.
    expect(refused).not.toContain('nfRow');
  });

  it('a refused paste names where in the entry the number is', () => {
    const { payloads } = copied();
    const uri = 'test://nonfinite-target-where.json.sldd';
    invalidate(uri);
    const design = sectionByName(getModel(uri, 'params.sldd', jsonText), 'design');
    const message = (name: string): string => {
      try {
        pasteEntries(jsonText, design, [payloads.find((p) => p.name === name)!]);
      } catch (err) {
        return (err as Error).message;
      }
      return 'pasted';
    };
    // Either refused with its place named, or (once core spells these) pasted.
    expect(['pasted', 'Cannot paste "nfParam" into a text dictionary: it holds Inf (in Value), which this version cannot write there yet. Nothing was pasted.']).toContain(message('nfParam'));
    expect(['pasted', 'Cannot paste "nfStruct" into a text dictionary: it holds Inf (in a), which this version cannot write there yet. Nothing was pasted.']).toContain(message('nfStruct'));
    expect(['pasted', 'Cannot paste "nfNaN" into a text dictionary: it holds NaN, which this version cannot write there yet. Nothing was pasted.']).toContain(message('nfNaN'));
  });
});
