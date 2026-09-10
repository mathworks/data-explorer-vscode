// Copyright 2026 The MathWorks, Inc.
//
// This host's names for the one part a `.sldd` keeps its entries in, checked against the
// core it is pinned to.
//
// The names are core's — its reader looks the zip member up, its writer puts it back, and
// its `slddChunkContent` walks the JSON path — but this host cannot borrow them, because it
// owns the open DOCUMENT that core never sees. It holds the other zip members and must
// preserve them byte-for-byte while replacing exactly one, and it splices byte offsets into
// the raw JSON text rather than re-serializing it. So the strings are written down twice, in
// two repos, and have to be the same or a save from here produces a package core reads back
// as a different dictionary.
//
// Nothing in either repo could see both copies, which is this codebase's recurring shape:
// one rule, two paths, agreeing by coincidence. What makes it checkable is that the
// agreement is OBSERVABLE — core's reader tells you which member it excluded, and its
// accessor tells you which key path it walked — so this file pins the host's constants
// against core's BEHAVIOUR rather than against a string core happens to also export. That
// pin works today, on the pinned version, and it is what will say the eventual switch to
// core's `DATA_PART_XML`/`DATA_PART_KEY` changed nothing.
//
// None of the drift this guards against throws. A miss in the zip member ships a package
// carrying the entries twice — once under the name a reader looks up, once under a name
// nothing reads — and a miss in the JSON path yields no entries at all, which is
// indistinguishable from a dictionary the user had created and not filled in.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { parseBinarySldd, readSlddContent, slddChunkContent } from 'data-explorer-core';
import { CONTENT_PART_PATH, DATA_PART_XML } from '../src/common/slddParts.js';

const root = join(import.meta.dirname, '..');
const BINARY = 'test/fixtures/compressed.sldd';
const TEXTUAL = 'test/fixtures/object_array_text.sldd';

const fixture = (p: string) => new Uint8Array(readFileSync(join(root, p)));
const buffer = (p: string) => {
  const u8 = fixture(p);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

describe('the zip member name agrees with the core this is pinned to', () => {
  it('names the member core’s reader reads and excludes', () => {
    // Core's answer, read off its own output: `__zipMetadata` is every member EXCEPT the
    // one it read the entries from. So the member missing from that bag is core's name for
    // the data part, and it must be the name this host looks up.
    const all = Object.keys(unzipSync(fixture(BINARY)));
    const passThrough = Object.keys(
      (parseBinarySldd(buffer(BINARY)) as { __zipMetadata: Record<string, Uint8Array> }).__zipMetadata,
    );
    expect(all).toContain(DATA_PART_XML);
    expect(passThrough).not.toContain(DATA_PART_XML);
    expect(all.filter((m) => !passThrough.includes(m))).toEqual([DATA_PART_XML]);
  });

  it('rebuilds a package core reads back, which is what the save path does', () => {
    // The provider's `writeTo`, in the two lines that matter: spread the pass-through parts,
    // put the chunk in under this name, zip. A host naming it anything else writes a package
    // whose entries core cannot find — and `zipSync` is perfectly happy to produce it.
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
    // chunk left behind under a stale name.
    expect(Object.keys(unzipSync(zipped)).sort()).toEqual(Object.keys(unzipSync(fixture(BINARY))).sort());
  });
});

describe('the JSON key path agrees with core’s accessor', () => {
  const walk = (json: Record<string, unknown>) => {
    let at: unknown = json;
    for (const key of CONTENT_PART_PATH) {
      at = (at as Record<string, unknown> | undefined)?.[key];
    }
    return at as Record<string, unknown> | undefined;
  };

  it('reaches exactly what slddChunkContent reaches, in both on-disk formats', () => {
    // Identity, not equality: the walk must land on the same object core landed on, which
    // is what says the key strings are the same strings. Both formats, because they are two
    // writers of one shape and the host's scanner runs over the textual one.
    for (const file of [TEXTUAL, BINARY]) {
      const content = readSlddContent(buffer(file));
      const byHand = walk(content);
      expect(byHand, `${file} must carry a content part`).toBeTruthy();
      expect(slddChunkContent(content), file).toBe(byHand);
      expect(Array.isArray(byHand?.entries), file).toBe(true);
    }
  });

  it('is the path a dictionary MATLAB wrote as text actually uses', () => {
    // The scanner never parses — it walks these keys over raw TEXT — so the strings have to
    // occur in the bytes on disk, in order, not merely in an object core built.
    const text = new TextDecoder().decode(fixture(TEXTUAL));
    let at = 0;
    for (const key of CONTENT_PART_PATH) {
      const found = text.indexOf(`"${key}"`, at);
      expect(found, `${key} must appear after the key before it`).toBeGreaterThan(at - 1);
      at = found + key.length;
    }
    expect(text.indexOf('"entries"', at), 'and the entries array after all three').toBeGreaterThan(at);
  });

  it('stops at the first missing key rather than reaching past it', () => {
    expect(walk({})).toBeUndefined();
    expect(walk({ [CONTENT_PART_PATH[0]]: {} })).toBeUndefined();
  });
});

// The forcing function. Two literals in two repos are only manageable while each repo keeps
// exactly one copy, and the way that stops being true is a new caller spelling the string
// rather than importing it — which is how the extension list got written six times and
// `endsWith('.sldd')` eight.
describe('no host file keeps its own copy of the part names', () => {
  const OWNER = 'src/common/slddParts.ts';

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

  const files = tsFiles('src').filter((f) => f !== OWNER);

  it('scans a source tree it is actually reading', () => {
    // A walker that found nothing would make the assertion below pass forever.
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('src/host/jsonEntryScan.ts');
    expect(files).toContain('src/host/BinarySlddEditorProvider.ts');
  });

  for (const literal of ['data/chunk0', '__MW_TEXT_PART__', '__MW_TEXT_PARTS__', '__MW_TEXT_content']) {
    it(`spells ${literal} only in ${OWNER}`, () => {
      expect(code(OWNER), 'the owner must still be the one that says it').toContain(literal);
      const strays = files.filter((f) => code(f).includes(literal));
      expect(strays, `import from ${OWNER}, or ask core’s slddChunkContent`).toEqual([]);
    });
  }
});
