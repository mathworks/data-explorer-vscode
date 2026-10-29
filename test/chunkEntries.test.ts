// Copyright 2026 The MathWorks, Inc.
//
// Core's structure-aware scan of a binary .sldd's data/chunk0.xml (`scanChunkEntries`), over
// this repository's binary dictionaries and with this host's edit records.
//
// The binary save gate sees a chunk through this scan and nothing else, so the entries it names
// must be the ones the host's model holds, by the same keys: the key the gate gives the bytes
// (chunkEntryKey), the key it gives the model's nodes (entryKey of name and metadata.uuid) and the
// key an edit records for the entries it changes (entryKey of this host's entry record,
// BinarySlddEditorProvider.keysOfEdit) are one key, or the gate refuses a good save as "no edit
// changed it". And its spans must be the ones core's findEntryObjectSpan finds, since the provider
// cuts undo fragments with either, depending on how many ops want one (cutFragments).
//
// The scan's own rules (what is an entry, what it reads past, what it cannot vouch for, how a key
// decodes) are core's, and pinned there (test/chunkEntries.test.ts in data-explorer-core), over
// core's fixtures. These run over the dictionaries this host is tested with, through the entry
// record the host's edits make, which core does not have.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, DATA_PART_XML, chunkEntryKey, entryKey, findEntryObjectSpan, scanChunkEntries } from 'data-explorer-core';
import { entryRecord } from '../src/host/entryOps.js';
import { readSlddParts } from 'data-explorer-view/model';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Every tracked binary (zip) dictionary in the repository, from both suites' fixtures.
const BINARY_FIXTURES = [
  'test/parity/artifacts/binary/params.sldd',
  'test/parity/artifacts/binary/common.sldd',
  'test/parity/artifacts/binary/codegen.sldd',
  'test/parity/artifacts/binary/util.sldd',
  'test/parity/artifacts/binary/headerfile.sldd',
  'test/parity/artifacts/elem_binary/elements.sldd',
  'test/fixtures/arch_binary.sldd',
  'test/fixtures/arch_service_binary.sldd',
  'test/fixtures/object_array_binary.sldd',
  'test/fixtures/object_props_binary.sldd',
  'test/fixtures/nested_objects.sldd',
  'test/fixtures/chain_top.sldd',
  'test/fixtures/compressed.sldd',
  'test/fixtures/rt_bin.sldd',
  'test/fixtures/empty_bin.sldd',
  'test/fixtures/sldd-stream-objects/stream_objects_binary.sldd',
  'test-integration/fixtures/classes/variantbank_r2027a_binary.sldd',
  'test-integration/fixtures/workspace/binary.sldd',
  'test-integration/fixtures/sparse/sparse_binary.sldd',
  'test-integration/fixtures/typelink/typelink_binary.sldd',
];

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

function loadChunk(file: string): { xml: string; meta: Record<string, Uint8Array> } {
  const zip = unzipSync(new Uint8Array(readFileSync(repo(file))));
  const xml = new TextDecoder().decode(zip[DATA_PART_XML]);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== DATA_PART_XML) meta[k] = v;
  return { xml, meta };
}

// The model the provider registers for a chunk (registerModel: readSlddParts, then addDataSource).
function readModel(srcId: string, xml: string, meta: Record<string, Uint8Array>): any[] {
  DataModel.removeDataSource(srcId);
  const model: any = DataModel.addDataSource(srcId, readSlddParts(xml, meta, []), { path: 'fixture.sldd' });
  return (model.children as any[]).flatMap((section: any) => section.children as any[]);
}

// What BinarySlddEditorProvider's keysOfEdit records for an entry an op carries the record of
// (its recordName and recordUuid, which are private to that vscode-coupled module).
function recordKey(record: any): string {
  const uuid = record.metadata?.uuid;
  return entryKey(String(record.name ?? ''), typeof uuid === 'string' && uuid ? uuid : undefined);
}

const sorted = (keys: string[]) => [...keys].sort();

describe('scanChunkEntries on every tracked binary dictionary', () => {
  for (const file of BINARY_FIXTURES) {
    it(`${file}: reads cleanly, one span per entry core reads, each its <Object>…</Object>`, () => {
      const { xml, meta } = loadChunk(file);
      const scan = scanChunkEntries(xml);
      expect(scan.clean).toBe(true);
      const nodes = readModel('chunkEntries:' + file, xml, meta);
      expect(scan.entries.length).toBe(nodes.length);
      for (const e of scan.entries) {
        const text = xml.slice(e.start, e.end);
        expect(text.startsWith('<Object Class="DD.ENTRY"')).toBe(true);
        expect(text.endsWith('</Object>') || text.endsWith('/>')).toBe(true);
      }
      // In order and never overlapping: the gate slices the outside of the entries out of
      // these, so an overlap would hand it a part twice.
      for (let i = 1; i < scan.entries.length; i++) {
        expect(scan.entries[i].start).toBeGreaterThanOrEqual(scan.entries[i - 1].end);
      }
      DataModel.removeDataSource('chunkEntries:' + file);
    });

    it(`${file}: the bytes' keys are the model's keys and the keys an edit records`, () => {
      const { xml, meta } = loadChunk(file);
      const nodes = readModel('chunkEntries-keys:' + file, xml, meta);
      const bytes = scanChunkEntries(xml).entries.map(chunkEntryKey);
      const model = nodes.map((n) => entryKey(n.name, typeof n.metadata?.uuid === 'string' ? n.metadata.uuid : null));
      const records = nodes.map((n) => recordKey(entryRecord(n)));
      expect(sorted(model)).toEqual(sorted(bytes));
      expect(sorted(records)).toEqual(sorted(bytes));
      DataModel.removeDataSource('chunkEntries-keys:' + file);
    });

    it(`${file}: each span is the one core's findEntryObjectSpan finds for the entry`, () => {
      // The provider's two ways of cutting an undo fragment (cutFragments): core's lookup for a
      // few ops, this scan for more. Same entry, same bytes, whichever way it is cut.
      const { xml, meta } = loadChunk(file);
      const nodes = readModel('chunkEntries-spans:' + file, xml, meta);
      const scanned = new Map(scanChunkEntries(xml).entries.map((e) => [chunkEntryKey(e), e]));
      for (const node of nodes) {
        const record = entryRecord(node) as any;
        const uuid = record.metadata?.uuid;
        const span = findEntryObjectSpan(xml, { name: String(record.name ?? ''), uuid: uuid || undefined });
        const e = scanned.get(recordKey(record))!;
        expect(span, `core finds "${node.name}"`).not.toBeNull();
        expect(xml.slice(span!.offset, span!.offset + span!.length)).toBe(xml.slice(e.start, e.end));
      }
      DataModel.removeDataSource('chunkEntries-spans:' + file);
    });
  }
});
