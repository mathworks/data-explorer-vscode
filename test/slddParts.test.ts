// Copyright 2026 The MathWorks, Inc.
//
// The one part a `.sldd` keeps its entries in, named ONCE — by core — and used here on the
// two paths core cannot see.
//
// The names are core's: its reader looks the zip member up, its writer puts it back, and
// its `slddChunkContent` walks the JSON path to the content. This host has to navigate the
// same part anyway, because it owns the open DOCUMENT core never sees — it holds the other
// zip members and must preserve them byte-for-byte while replacing exactly one, and it
// splices byte offsets into the raw JSON text rather than re-serializing it. Until the pin
// moved past the version that publishes them, that meant the strings were written down
// twice, in two repos, agreeing by coincidence; this file used to pin the host's copy
// against core's observable behaviour, and that pin is what said the copy could go.
//
// It is gone. `DATA_PART_XML` and the three container keys now come from core at both
// sites, so there is no second spelling left to compare. What remains checkable here is
// what the HOST does with them, and neither half is core's to test:
//
//   * the save path rebuilds a zip out of the pass-through bag it kept plus the one member
//     it replaced, and core has to read that package back as the same dictionary;
//   * the scanner walks the three keys over RAW TEXT for byte offsets, in an order this
//     file chooses, and has to land on the same entries array core's object walk reaches.
//
// Neither failure throws. A wrong member name ships a package carrying the entries twice —
// once under the name a reader looks up, once under a name nothing reads — and a wrong key
// or a wrong order yields no entries array at all, which the edit path treats as "not a
// dictionary I can scan" and answers with a full-document rewrite.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { DATA_PART_XML, parseBinarySldd, readSlddContent, slddChunkContent } from 'data-explorer-core';
import { findEntriesArrayStart, indexEntries } from '../src/host/jsonEntryScan.js';

const root = join(import.meta.dirname, '..');
const BINARY = 'test/fixtures/compressed.sldd';
// Two textual dictionaries, because the scanner runs over whatever a user has open: a
// compact fixture, and a 27 KB one MATLAB itself wrote (tab-indented, R2027a) — the
// whitespace between a key and its `{` is exactly what the walk has to tolerate.
const TEXTUAL = ['test/fixtures/object_array_text.sldd', 'test/parity/artifacts/text/params.sldd'];

const fixture = (p: string) => new Uint8Array(readFileSync(join(root, p)));
const buffer = (p: string) => {
  const u8 = fixture(p);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

describe('the save path rebuilds a package core reads back', () => {
  it('puts the entries under the member name core looks up, and drops no other part', () => {
    // The provider's `writeTo`, in the two lines that matter: spread the pass-through parts,
    // put the chunk in under core's name, zip. A host naming it anything else writes a
    // package whose entries core cannot find — and `zipSync` is perfectly happy to produce
    // it, which is why this is asserted by reading the result back rather than by comparing
    // strings.
    const content = parseBinarySldd(buffer(BINARY)) as {
      __zipMetadata: Record<string, Uint8Array>;
      __rawXml: string;
    };
    const rebuilt = { ...content.__zipMetadata };
    rebuilt[DATA_PART_XML] = new TextEncoder().encode(content.__rawXml);
    const zipped = zipSync(rebuilt, { level: 1 });
    const reread = slddChunkContent(
      readSlddContent(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer),
    );
    expect(Array.isArray(reread?.entries)).toBe(true);
    expect((reread?.entries as unknown[]).length).toBeGreaterThan(0);
    // And the member set is the original one: no part dropped, and no second copy of the
    // chunk left behind under a stale name. This is also what says the exclusion the
    // document made when it built its bag used the same string as the re-insert above.
    expect(Object.keys(unzipSync(zipped)).sort()).toEqual(Object.keys(unzipSync(fixture(BINARY))).sort());
  });
});

describe('the scanner’s raw-text walk reaches what core’s object walk reaches', () => {
  it('finds the entries array, and counts the entries core counts', () => {
    // The host's only reason to name these keys at all: the scanner never parses, so it
    // needs the strings AND an order to walk them in. Core publishes the three keys and
    // says nothing about the walk, so the order is this file's — and a wrong one is not an
    // error, it is `-1`, indistinguishable from a file of another shape. The count is what
    // makes the landing site the right one rather than merely a `[`.
    for (const file of TEXTUAL) {
      const text = new TextDecoder().decode(fixture(file));
      const start = findEntriesArrayStart(text);
      expect(start, `${file} must spell the path to its entries`).toBeGreaterThanOrEqual(0);
      expect(text[start], `${file} must land on the array`).toBe('[');

      const byCore = slddChunkContent(readSlddContent(buffer(file)))?.entries as unknown[] | undefined;
      expect(Array.isArray(byCore), `${file} must carry a content part`).toBe(true);
      expect(indexEntries(text)?.elements.length, file).toBe(byCore!.length);
      expect(byCore!.length, `${file} must have entries for this to mean anything`).toBeGreaterThan(0);
    }
  });
});

// The forcing function. The strings are core's now, and the way that stops being true is a
// new caller spelling one rather than importing it — which is how the extension list got
// written six times and `endsWith('.sldd')` eight. There is no owner in this tree to allow
// any more: every one of these belongs to core.
describe('no host file keeps its own copy of the part names', () => {
  const tsFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...tsFiles(rel));
      else if (entry.name.endsWith('.ts')) out.push(rel);
    }
    return out;
  };

  // Comments are stripped first: a header explaining what `__MW_TEXT_PARTS__` is, or why
  // this walk is core's to do, is documentation and not a second copy. Only code counts, or
  // the guard would punish the explanations that make the decision legible.
  const code = (p: string) =>
    readFileSync(join(root, p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  const files = tsFiles('src');

  it('scans a source tree it is actually reading', () => {
    // A walker that found nothing would make the assertions below pass forever.
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('src/host/jsonEntryScan.ts');
    expect(files).toContain('src/host/BinarySlddEditorProvider.ts');
  });

  for (const literal of ['data/chunk0', '__MW_TEXT_PART__', '__MW_TEXT_PARTS__', '__MW_TEXT_content']) {
    it(`spells ${literal} nowhere in src/`, () => {
      const strays = files.filter((f) => code(f).includes(literal));
      expect(strays, 'take it from data-explorer-core, or ask core’s slddChunkContent').toEqual([]);
    });
  }

  it('and the two files that navigate the part take the names from core', () => {
    // The other direction: a scan for absent literals also passes for a file that stopped
    // navigating the part at all, so name the two that must still be doing it.
    for (const file of ['src/host/jsonEntryScan.ts', 'src/host/BinarySlddEditorProvider.ts']) {
      expect(code(file), `${file} must import the names`).toContain("from 'data-explorer-core'");
    }
    expect(code('src/host/jsonEntryScan.ts')).toContain('TEXT_PARTS');
    expect(code('src/host/BinarySlddEditorProvider.ts')).toContain('DATA_PART_XML');
  });
});
