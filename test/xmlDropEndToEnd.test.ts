// Copyright 2026 The MathWorks, Inc.
//
// End-to-end drag-and-drop flows for the COMPRESSED-BINARY .sldd path, modeling
// exactly what BinarySlddEditorProvider's applyDrop / applyDragStart do with the
// pure XML transforms — the host handler is thin glue over these, so exercising
// the same sequence proves the binary drag-and-drop behavior without a live VS
// Code webview. This is the XML analog of dropEndToEnd.test.ts (JSON path).
//   • same-document MOVE: delete sources from chunkXml, then paste into target;
//   • COPY: paste only, sources stay;
//   • cross-DOCUMENT move: paste into target chunk, delete from source chunk;
//   • every edited chunk still re-parses (the provider's save gate).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/dex/core/DataModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import { resolveSectionForPaste } from '../src/host/structuralEdit.js';
import { pasteEntriesXml, deleteEntriesByNameXml } from '../src/host/xmlStructuralEdit.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);
const zip = unzipSync(new Uint8Array(bytes));
const baseXml = new TextDecoder().decode(zip['data/chunk0.xml']);
const meta: Record<string, Uint8Array> = {};
for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;

function load(uri: string, xml = baseXml): any {
  DataModel.removeDataSource(uri);
  return DataModel.addDataSource(uri, parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
}
function entries(model: any): any[] {
  return model.children.flatMap((s: any) => s.children);
}
function designSection(model: any): any {
  return model.children.find((s: any) => s.children.length > 0) ?? model.children[0];
}

describe('binary drop end-to-end — same-document MOVE', () => {
  it('a within-doc move deletes the source then pastes it back, keeping its name', () => {
    const uri = 'mem://xdrop-move';
    const model = load(uri);
    const src = entries(model)[0];
    const name = src.name;
    const payload = src.serialize() as Record<string, unknown>;

    // A same-doc move (to a DIFFERENT section) mirrors cut+paste: delete the
    // source first so the name is freed, re-parse, then paste into the target.
    // params.sldd has a single populated section, so model the mechanics: delete
    // then paste into the same section — the freed name is retained.
    const afterDelete = deleteEntriesByNameXml(baseXml, [name]);
    expect(findEntryObjectSpan(afterDelete, name)).toBeNull();
    const m2 = load(uri, afterDelete);
    const target = resolveSectionForPaste(m2, null, designSection(m2).id) ?? designSection(m2);
    const { newText, selectIds } = pasteEntriesXml(afterDelete, target, [payload]);
    expect(selectIds.length).toBe(1);

    // The result re-parses (the provider's save gate) and the entry is present
    // once, under its original name (the delete freed it).
    const m3 = load(uri, newText);
    const names = entries(m3).map((e) => e.name);
    expect(names.filter((n) => n === name).length).toBe(1);
  });
});

describe('binary drop end-to-end — COPY leaves the source', () => {
  it('a copy pastes a uniquified duplicate and keeps the original', () => {
    const uri = 'mem://xdrop-copy';
    const model = load(uri);
    const src = entries(model)[0];
    const name = src.name;
    const baseCount = entries(model).length; // capture before reloading the same URI
    const payload = src.serialize() as Record<string, unknown>;
    const section = designSection(model);

    const { newText } = pasteEntriesXml(baseXml, section, [payload]);
    const m2 = load(uri, newText);
    const names = entries(m2).map((e) => e.name);
    // Original still present, plus a distinct uniquified copy.
    expect(names).toContain(name);
    expect(names.length).toBe(baseCount + 1);
    expect(new Set(names).size).toBe(names.length); // all names unique
  });
});

describe('binary drop end-to-end — cross-DOCUMENT move', () => {
  it('pastes into target chunk and deletes from source chunk (two independent edits)', () => {
    const src = entries(load('mem://xdrop-A'))[0];
    const name = src.name;
    const payload = src.serialize() as Record<string, unknown>;

    // Target doc B is a second copy; paste into it.
    const mB = load('mem://xdrop-B');
    const bCount = entries(mB).length; // capture before reloading the same URI
    const { newText: newB } = pasteEntriesXml(baseXml, designSection(mB), [payload]);
    // Source doc A: delete the moved entry (its own edit, cross-doc).
    const newA = deleteEntriesByNameXml(baseXml, [name]);

    const mA2 = load('mem://xdrop-A', newA);
    const mB2 = load('mem://xdrop-B', newB);
    expect(entries(mA2).map((e) => e.name)).not.toContain(name);
    expect(entries(mB2).length).toBe(bCount + 1);
  });
});
