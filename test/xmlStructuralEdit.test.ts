// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/dex/core/DataModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import {
  reserializeEntryXml,
  deleteEntryXml,
  addEntryXml,
  deleteEntriesByNameXml,
} from '../src/host/xmlStructuralEdit.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);

function load(uri: string): { model: any; xml: string } {
  DataModel.removeDataSource(uri);
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  const content = parseBinarySlddParts(xml, meta);
  const model = DataModel.addDataSource(uri, content, { path: 'params.sldd' });
  return { model, xml };
}

function entryNames(model: any): string[] {
  return model.children.flatMap((s: any) => s.children.map((e: any) => e.name));
}
function firstEntry(model: any): any {
  return model.children.flatMap((s: any) => s.children)[0];
}
// A sibling entry's fragment must be byte-identical across an edit that doesn't touch it.
function siblingIdentical(oldXml: string, newXml: string, name: string): boolean {
  const a = findEntryObjectSpan(oldXml, name);
  const b = findEntryObjectSpan(newXml, name);
  if (!a || !b) return false;
  return oldXml.slice(a.offset, a.offset + a.length) === newXml.slice(b.offset, b.offset + b.length);
}

describe('deleteEntryXml', () => {
  it('removes the named entry, leaves siblings byte-identical', () => {
    const { model, xml } = load('mem://xse1');
    const names = entryNames(model);
    expect(names.length).toBeGreaterThanOrEqual(2);
    const victim = names[0];
    const survivor = names[1];
    const entry = firstEntry(model);
    const { newText } = deleteEntryXml(xml, entry);
    expect(findEntryObjectSpan(newText, victim)).toBeNull();
    expect(siblingIdentical(xml, newText, survivor)).toBe(true);
  });
});

describe('reserializeEntryXml', () => {
  it('rebuilds an entry fragment containing its Name and no trailing newline', () => {
    const { model } = load('mem://xse2');
    const entry = firstEntry(model);
    const frag = reserializeEntryXml(entry);
    expect(frag).toContain('<Object Class="DD.ENTRY">');
    expect(frag).toContain('<P Name="Name" Class="char">' + entry.name + '</P>');
    expect(frag.endsWith('\n')).toBe(false);
  });
});

describe('addEntryXml', () => {
  it('inserts a new entry before the DD.Dictionary and keeps it parseable', () => {
    const { model, xml } = load('mem://xse3');
    const design = model.getSection('design');
    const { newText, selectId } = addEntryXml(xml, design, 'Simulink.Parameter');
    expect(selectId).toBeTruthy();
    const dictIdx = newText.indexOf('<Object Class="DD.Dictionary">');
    const lastEntryIdx = newText.lastIndexOf('<Object Class="DD.ENTRY">');
    expect(lastEntryIdx).toBeLessThan(dictIdx);
  });
});

describe('deleteEntriesByNameXml', () => {
  it('removes multiple named entries, absent names are ignored', () => {
    const { model, xml } = load('mem://xse4');
    const names = entryNames(model).slice(0, 2);
    const out = deleteEntriesByNameXml(xml, [...names, 'Ghost']);
    for (const n of names) expect(findEntryObjectSpan(out, n)).toBeNull();
  });
});
