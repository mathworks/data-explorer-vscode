// Copyright 2026 The MathWorks, Inc.
//
// The structure-aware scan of a binary .sldd's data/chunk0.xml (src/host/chunkEntries.ts).
//
// The binary save gate sees a chunk through this scan and nothing else, so what it calls an
// entry, where it says one starts and ends, and what it is keyed by are the whole of what the
// gate can compare. Two families of test:
//
//  - AGREEMENT. Every tracked binary dictionary, scanned, must name the entries core's reader
//    reads, by the same keys: the key the gate gives the bytes (chunkEntryKey), the key it gives
//    the model's nodes (entryKey of name and metadata.uuid) and the key an edit records for the
//    entries it changes (entryKey of an entry record, BinarySlddEditorProvider.keysOfEdit) are one
//    key, or the gate refuses a good save as "no edit changed it". And its spans must be the ones
//    core's findEntryObjectSpan finds, since the provider cuts undo fragments with either,
//    depending on how many ops want one (cutFragments).
//
//  - WHAT `clean` MEANS. The header lists what the scan cannot vouch for; each is pinned here,
//    with the entries before it still returned, and each thing it reads past (a comment, a CDATA
//    section, a processing instruction, a quoted `>`) is pinned as read past.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, DATA_PART_XML, findEntryObjectSpan } from 'data-explorer-core';
import { scanChunkEntries, chunkEntryKey, decodeXmlText, entryKey } from '../src/host/chunkEntries.js';
import { entryRecord } from '../src/host/entryOps.js';
import { readSlddParts } from '../src/host/slddContent.js';

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

// A chunk of the shape MATLAB writes, around the given entry objects.
const chunk = (...objects: string[]) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<DataSource FormatVersion="1">\n' +
  objects.map((o) => '    ' + o + '\n').join('') +
  '    <Object Class="DD.Dictionary">\n        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n    </Object>\n' +
  '</DataSource>\n';

const entry = (name: string, uuid?: string, body = '<P Name="Value" Class="double">1.0</P>') =>
  '<Object Class="DD.ENTRY">' +
  `<P Name="Name" Class="char">${name}</P>` +
  (uuid === undefined ? '' : `<P Name="UUID" Class="char">${uuid}</P>`) +
  body +
  '</Object>';

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

  it('reads Name and UUID as the bytes spell them, and the key decodes them as the reader does', () => {
    // MATLAB never spells an entry name with a character reference (a name is an identifier),
    // but the key is what pairs bytes with the model, so it must decode as the reader does.
    const xml = chunk(entry('k&#x31;&amp;'), entry('plain', 'u&#45;1'));
    const scan = scanChunkEntries(xml);
    expect(scan.entries.map((e) => [e.name, e.uuid])).toEqual([
      ['k&#x31;&amp;', null],
      ['plain', 'u&#45;1'],
    ]);
    const nodes = readModel('chunkEntries-entities', xml, {});
    expect(nodes.map((n) => n.name)).toEqual(['k1&', 'plain']);
    expect(sorted(scan.entries.map(chunkEntryKey))).toEqual(
      sorted(nodes.map((n) => entryKey(n.name, n.metadata?.uuid))),
    );
    DataModel.removeDataSource('chunkEntries-entities');
  });
});

describe('scanChunkEntries — what is an entry', () => {
  it('is an <Object Class="DD.ENTRY"> directly inside the root, and nothing else', () => {
    const nested = '<Object Class="DD.ENTRY"><P Name="Name" Class="char">inner</P></Object>';
    const xml = chunk(
      entry('a', 'u-a', `<P Name="Value">${nested}</P>`),
      '<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary" Class="char">c.sldd</P></Object>',
      entry('b'),
    );
    const scan = scanChunkEntries(xml);
    expect(scan.clean).toBe(true);
    expect(scan.entries.map((e) => e.name)).toEqual(['a', 'b']);
    // The nested object's Name is not the outer entry's.
    expect(scan.entries[0].uuid).toBe('u-a');
  });

  it("takes the entry's OWN first Name and UUID, not a nested element's", () => {
    const xml = chunk(
      '<Object Class="DD.ENTRY"><P Name="Value"><Element><P Name="Name" Class="char">field</P>' +
        '<P Name="UUID" Class="char">inner-uuid</P></Element></P>' +
        '<P Name="Name" Class="char">outer</P><P Name="Name" Class="char">second</P></Object>',
    );
    const [e] = scanChunkEntries(xml).entries;
    expect(e.name).toBe('outer');
    expect(e.uuid).toBeNull();
  });

  it('leaves a Name that holds markup unread, and a self-closed entry nameless', () => {
    const xml = chunk(
      '<Object Class="DD.ENTRY"><P Name="Name"><Element/></P></Object>',
      '<Object Class="DD.ENTRY"/>',
      '<Object Class="DD.ENTRY"><P Name="Name" Class="char"/></Object>',
    );
    const scan = scanChunkEntries(xml);
    expect(scan.clean).toBe(true);
    expect(scan.entries.map((e) => e.name)).toEqual([null, null, null]);
    const selfClosed = scan.entries[1];
    expect(xml.slice(selfClosed.start, selfClosed.end)).toBe('<Object Class="DD.ENTRY"/>');
    // A nameless entry is keyed by the empty name, which is how the model keys one too.
    expect(chunkEntryKey(selfClosed)).toBe('name:');
  });

  it('reads an entry with an empty Name text as named ""', () => {
    const [e] = scanChunkEntries(chunk(entry(''))).entries;
    expect(e.name).toBe('');
    expect(chunkEntryKey(e)).toBe('name:');
  });

  it('reads past comments, CDATA, processing instructions and quoted markup', () => {
    const xml = chunk(
      '<!-- <Object Class="DD.ENTRY"><P Name="Name">ghost</P></Object> -->',
      entry('a', undefined, '<P Name="Value" Class="char"><![CDATA[</Object><Object Class="DD.ENTRY">]]></P>'),
      '<?pi <Object Class="DD.ENTRY"> ?>',
      `<Object Class='DD.ENTRY' Note="a > b"><P Name="Name" Class="char">b</P ></Object >`,
    );
    const scan = scanChunkEntries(xml);
    expect(scan.clean).toBe(true);
    expect(scan.entries.map((e) => e.name)).toEqual(['a', 'b']);
    expect(xml.slice(scan.entries[1].start, scan.entries[1].end)).toBe(
      `<Object Class='DD.ENTRY' Note="a > b"><P Name="Name" Class="char">b</P ></Object >`,
    );
  });

  it('finds no entries in an empty dictionary, cleanly', () => {
    expect(scanChunkEntries('<?xml version="1.0"?><DataSource/>')).toEqual({ entries: [], clean: true });
    expect(scanChunkEntries(chunk())).toEqual({ entries: [], clean: true });
  });
});

describe('scanChunkEntries — what it cannot vouch for is not clean', () => {
  // Each case follows one good entry, which is still returned: the header promises the entries
  // before the fault, and a caller that needs every entry (the gate) checks `clean`.
  const cases: [string, string][] = [
    ['an unclosed comment', '<!-- never closed'],
    ['an unclosed CDATA section', '<![CDATA[ never closed'],
    ['a DOCTYPE', '<!DOCTYPE x>'],
    ['an unclosed processing instruction', '<?pi never closed'],
    ['a < that starts no tag', '< Object/>'],
    ['a tag that starts with a digit', '<1x/>'],
    ['an attribute with no value', '<Object Class/>'],
    ['an attribute with an unquoted value', '<Object Class=DD.ENTRY/>'],
    ['an attribute whose quote never closes', '<Object Class="DD.ENTRY/>'],
    ['two attributes with no space between them', '<Object A="1"B="2"/>'],
    ['a / that does not close the tag', '<Object/ >'],
    ['a close tag that closes nothing open', '</Object>'],
    ['a close tag with no name', '</>'],
    ['a close tag with something after its name', '<x></x y>'],
  ];
  for (const [what, fault] of cases) {
    it(`${what}`, () => {
      const xml = '<DataSource>' + entry('kept') + fault + '</DataSource>';
      const scan = scanChunkEntries(xml);
      expect(scan.clean).toBe(false);
      expect(scan.entries.map((e) => e.name)).toEqual(['kept']);
    });
  }

  it('a close tag that does not close the element open', () => {
    const scan = scanChunkEntries('<DataSource>' + entry('kept') + '<Object Class="DD.ENTRY"></P></DataSource>');
    expect(scan.clean).toBe(false);
    expect(scan.entries.map((e) => e.name)).toEqual(['kept']);
  });

  it('a second root, and a root never closed', () => {
    expect(scanChunkEntries('<DataSource></DataSource><DataSource></DataSource>').clean).toBe(false);
    const open = scanChunkEntries('<DataSource>' + entry('kept'));
    expect(open.clean).toBe(false);
    expect(open.entries.map((e) => e.name)).toEqual(['kept']);
  });

  it('a document with no element at all', () => {
    expect(scanChunkEntries('').clean).toBe(false);
    expect(scanChunkEntries('<?xml version="1.0"?>').clean).toBe(false);
  });
});

describe('decodeXmlText, entryKey and chunkEntryKey', () => {
  it('decodes the five named references and numeric ones, once', () => {
    expect(decodeXmlText('&lt;&gt;&amp;&quot;&apos;')).toBe(`<>&"'`);
    expect(decodeXmlText('&#65;&#x42;&#x1F600;')).toBe('AB\u{1F600}');
    // Once: an escaped reference is its text, not what that text would decode to.
    expect(decodeXmlText('&amp;lt;')).toBe('&lt;');
    // A reference XML does not define is left as it is spelled.
    expect(decodeXmlText('&nbsp;&;&#;')).toBe('&nbsp;&;&#;');
  });

  it('keys an entry by its UUID when it has one, by its name otherwise', () => {
    expect(entryKey('a', 'u-1')).toBe('uuid:u-1');
    expect(entryKey('renamed', 'u-1')).toBe('uuid:u-1');
    expect(entryKey('a', '')).toBe('name:a');
    expect(entryKey('a', null)).toBe('name:a');
    expect(entryKey(undefined, undefined)).toBe('name:');
    // A name that looks like a key cannot pass for a UUID key.
    expect(entryKey('uuid:u-1', null)).not.toBe(entryKey('x', 'u-1'));
  });

  it('keys the bytes as the model spells them', () => {
    const [e] = scanChunkEntries(chunk(entry('a&lt;b', '&#x75;-1'))).entries;
    expect(chunkEntryKey(e)).toBe('uuid:u-1');
    const [n] = scanChunkEntries(chunk(entry('a&lt;b'))).entries;
    expect(chunkEntryKey(n)).toBe('name:a<b');
  });
});
