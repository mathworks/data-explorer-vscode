// Copyright 2026 The MathWorks, Inc.
//
// Add-gallery parity with real MATLAB, for every tile, in both .sldd formats.
//
// `addEntryHost.test.ts` already pins that an add produces what CORE says it produces,
// and that the two formats agree with EACH OTHER. Neither of those catches the case
// where core and both serializers agree on something MATLAB does not accept — they are
// self-consistency checks, and this feature's whole purpose is to write a file another
// program reads. So this suite adds the third leg: what MATLAB itself writes.
//
// Two halves, and the split matters:
//
//  * The `expect`s below are OFFLINE. They compare our added entry against MATLAB's own
//    default entry for the same class, transcribed into `matlabDefaults.ts` from a real
//    R2027a run. They run in CI with no MATLAB anywhere.
//  * The EMITTED files (test/fixtures/parity_out/, gitignored) are the input to the
//    out-of-process check: `test/parity/gen_add_entry_verify.m` reopens them in MATLAB
//    and asserts every entry loads with the class and properties we claim. That step is
//    manual because it needs a MATLAB install; see docs/deep-work/sldd-add-entry-parity/.
//
// The bases are `empty_{text,bin}.sldd` — MATLAB-authored dictionaries with the entries
// removed, so everything our output sits inside (content types, rels, all four metadata
// parts, the release stamp) is MATLAB's own bytes and not our guess at them.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { readSlddParts } from '../src/host/slddContent.js';
import { addNewEntry, sectionByName } from '../src/host/structuralEdit.js';
import { addNewEntryXml } from '../src/host/xmlStructuralEdit.js';
import { ADD_CATALOG } from '../src/common/addCatalog.js';
import { MATLAB_DEFAULTS, MATLAB_ABSENT, MATLAB_CUSTOM_SAVE } from './matlabDefaults.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./fixtures/parity_out/', import.meta.url));

// Every tile, flattened out of the catalog in drawn order. One row per tile, so a class
// offered in two sections is exercised in both — which is the point for `isderived`.
const TILES = ADD_CATALOG.flatMap((c: any) =>
  c.tiles.map((t: any) => ({ label: t.label, className: t.className, section: t.section })),
);

type Added = { className: string; section: string; name: string; node: any };

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

// ---------------------------------------------------------------------------------
// Drive the real add path once per format, accumulating every tile into one
// dictionary — which is also the realistic case, since it forces `_uniqueName`
// to do its job across a shared namespace.
// ---------------------------------------------------------------------------------
function addAllText(): { added: Added[]; text: string } {
  const uri = 'test://add-parity-text.sldd';
  invalidate(uri);
  let text = readFileSync(fixture('empty_text.sldd'), 'utf8');
  const model = getModel(uri, 'empty_text.sldd', text) as any;
  const added: Added[] = [];
  for (const tile of TILES) {
    const section = sectionByName(model, tile.section);
    const result = addNewEntry(text, section, tile.className);
    text = result.newText;
    const node = (section.children as any[])[section.children.length - 1];
    added.push({ className: tile.className, section: tile.section, name: node.name, node });
  }
  return { added, text };
}

function addAllBinary(): { added: Added[]; xml: string; meta: Record<string, Uint8Array> } {
  const srcId = 'test://add-parity-bin.sldd';
  const zip = unzipSync(new Uint8Array(readFileSync(fixture('empty_bin.sldd'))));
  const meta: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) {
    if (member !== 'data/chunk0.xml') meta[member] = data as Uint8Array;
  }
  let xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  DataModel.removeDataSource(srcId);
  const model = DataModel.addDataSource(srcId, readSlddParts(xml, meta), {
    path: 'empty_bin.sldd',
  }) as any;
  const added: Added[] = [];
  for (const tile of TILES) {
    const section = sectionByName(model, tile.section);
    const result = addNewEntryXml(xml, section, tile.className);
    xml = result.newText;
    const node = (section.children as any[])[section.children.length - 1];
    added.push({ className: tile.className, section: tile.section, name: node.name, node });
  }
  return { added, xml, meta };
}

let textRun: { added: Added[]; text: string };
let binRun: { added: Added[]; xml: string; meta: Record<string, Uint8Array> };

beforeAll(() => {
  textRun = addAllText();
  binRun = addAllBinary();

  writeFileSync(`${OUT_DIR}/add_text.sldd`, textRun.text, 'utf8');
  const parts: Record<string, Uint8Array> = { ...binRun.meta };
  parts['data/chunk0.xml'] = new TextEncoder().encode(binRun.xml);
  writeFileSync(`${OUT_DIR}/add_bin.sldd`, Buffer.from(zipSync(parts, { level: 6 })));

  // The manifest tells the MATLAB verifier which tile each entry name came from; entry
  // names are core's to choose, so the verifier must be told, not guess.
  writeFileSync(
    `${OUT_DIR}/manifest.json`,
    JSON.stringify(
      {
        text: textRun.added.map((a) => ({ name: a.name, className: a.className, section: a.section })),
        bin: binRun.added.map((a) => ({ name: a.name, className: a.className, section: a.section })),
      },
      null,
      2,
    ),
    'utf8',
  );
});

describe('every gallery tile produces an entry in both formats', () => {
  it('adds all 28 tiles to a text dictionary', () => {
    expect(textRun.added).toHaveLength(TILES.length);
    expect(new Set(textRun.added.map((a) => a.name)).size).toBe(TILES.length);
  });

  it('adds all 28 tiles to a binary dictionary', () => {
    expect(binRun.added).toHaveLength(TILES.length);
    expect(new Set(binRun.added.map((a) => a.name)).size).toBe(TILES.length);
  });

  it('gives the same tile the same name and class in both formats', () => {
    // Invariant 3 of addEntryHost, restated across the whole catalog rather than one
    // tile: the two serializers start from the same core node, so a divergence here
    // is a divergence in the add path, not in the bytes.
    expect(binRun.added.map((a) => `${a.section}/${a.className}/${a.name}`)).toEqual(
      textRun.added.map((a) => `${a.section}/${a.className}/${a.name}`),
    );
  });

  it('emits text output that is still parseable JSON', () => {
    expect(() => JSON.parse(textRun.text)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------
// The comparison against MATLAB. For each class MATLAB can default-construct, every
// property MATLAB's own default carries must be present in ours with the same value.
// ---------------------------------------------------------------------------------
// Read the property bag out of the TEXT WE EMIT rather than off the live node. Both are
// available, and the bytes are the stronger claim: `matlabDefaults.ts` was itself read out of
// the file MATLAB emitted, so comparing file against file compares like with like and
// catches a serializer that drops or renames on the way out — which a node-to-table
// comparison passes straight over.
function emittedProps(className: string): { name: string; props: Record<string, unknown> } {
  const parsed = JSON.parse(textRun.text);
  const entries = parsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content
    .entries as any[];
  const hit = entries.find((e) => e.value?._array_class === className);
  expect(hit, `no emitted entry of class ${className}`).toBeTruthy();
  return { name: hit.name, props: (hit.value?._elements?.[0]?._properties ?? {}) as Record<string, unknown> };
}

describe('our default entry matches MATLAB default entry, property for property', () => {
  for (const className of Object.keys(MATLAB_DEFAULTS)) {
    it(`${className}`, () => {
      const { props: ours } = emittedProps(className);
      const theirs = MATLAB_DEFAULTS[className];

      for (const [prop, want] of Object.entries(theirs)) {
        expect(ours, `${className}.${prop} missing from our default`).toHaveProperty(prop);
        expect(String(ours[prop]), `${className}.${prop}`).toBe(String(want));
      }
    });
  }
});

describe('we do not invent properties MATLAB does not have', () => {
  for (const className of Object.keys(MATLAB_ABSENT)) {
    it(`${className} carries no property outside MATLAB's set`, () => {
      const { props } = emittedProps(className);
      const extra = Object.keys(props).filter((p) => MATLAB_ABSENT[className].indexOf(p) === -1);
      expect(extra, `${className} has properties MATLAB's default does not`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------
// The custom-save envelope, in BOTH formats — and both words are load-bearing.
//
// The two describes above read `textRun` only, which is how two defects lived in the
// binary writer while this suite was green: three of these four classes came out
// carrying an invented `<P Name="Value" Class="char"/>` beside their envelope in the
// binary flavour, and `emittedProps` cannot see a binary run at all. It is also why
// these four classes are not IN the tables above — they have no property bag, so
// `MATLAB_ABSENT` would have passed them on the empty set either way.
//
// So the assertion here is the one that survives that: per format, the envelope's field
// names and their order, against MATLAB's. Where the envelope HANGS differs by format on
// purpose (text spells it element-level `_custom_save`; binary writes an unnamed
// `<P Source="saveobj">`), which is exactly the asymmetry that let the two drift, so each
// spelling is located separately and then compared against one table.
// ---------------------------------------------------------------------------------
const CUSTOM_SAVE_KEY = '_custom_save';

/** The envelope's field names as the TEXT writer spells them, in written order. */
function textEnvelopeFields(className: string): string[] {
  const parsed = JSON.parse(textRun.text);
  const entries = parsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content
    .entries as any[];
  const hit = entries.find((e) => e.value?._array_class === className);
  expect(hit, `no emitted text entry of class ${className}`).toBeTruthy();
  const elem = hit.value._elements[0];
  // No property bag beside the envelope, which is the text half of defect 57. An
  // `_properties` here would mean the writer had something to say about this object outside
  // the struct MATLAB's loadobj reads.
  expect(Object.keys(elem), `${className} text element`).toEqual([CUSTOM_SAVE_KEY]);
  return Object.keys(elem[CUSTOM_SAVE_KEY]._elements[0]);
}

/**
 * The contents of the first `openTag` element, matched to its own close by DEPTH.
 *
 * Counting `</Element>`s instead would be wrong in a way that matters here: the fix being
 * regression-tested was a property written AFTER the envelope, so a slice that stops early
 * hides the very bytes under test and the assertion passes on nothing.
 */
function elementBody(xml: string, openTag: string): string {
  const at = xml.indexOf(openTag);
  expect(at, `no ${openTag} found`).toBeGreaterThan(-1);
  const re = /<(\/?)Element\b[^>]*?(\/?)>/g;
  re.lastIndex = at;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) {
      depth -= 1;
      if (depth === 0) return xml.slice(at + openTag.length, m.index);
    } else if (!m[2]) {
      depth += 1;
    }
  }
  throw new Error(`unterminated ${openTag}`);
}

/** The DIRECT `<P>` children of an element body, in order; an unnamed one reads `<unnamed>`. */
function directProps(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  const re = /<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const [, close, tag, attrs, selfClose] = m;
    if (close) {
      depth -= 1;
      continue;
    }
    if (tag === 'P' && depth === 0) {
      const named = /Name="([^"]*)"/.exec(attrs);
      names.push(named ? named[1] : '<unnamed>');
    }
    if (!selfClose) {
      depth += 1;
    }
  }
  return names;
}

/** The same names as the BINARY writer spells them, plus every property beside the envelope. */
function binEnvelopeFields(className: string): { fields: string[]; beside: string[] } {
  const objBody = elementBody(binRun.xml, `<Element Class="${className}">`);
  // The object's own property list, which for a custom saver is the unnamed saveobj `<P>`
  // and nothing else. A NAMED `<P>` at this level, before the envelope or after it, is
  // defect 57 exactly.
  const beside = directProps(objBody).filter((n) => n !== '<unnamed>');
  expect(objBody, `${className} has no saveobj envelope in the binary run`).toContain(
    '<P Source="saveobj"',
  );
  const structBody = elementBody(objBody.slice(objBody.indexOf('<P Source="saveobj"')), '<Element>');
  return { fields: directProps(structBody), beside };
}

describe('a custom-saving class writes MATLAB’s envelope, and nothing beside it', () => {
  // The bytes defect 57 actually produced, written out by hand, so the `beside` assertion
  // below is known to be capable of failing. `Value` came AFTER the envelope, which is the
  // position a reader that counts `</Element>`s rather than matching them cannot see — and
  // counting is what this helper used to do.
  it('would catch the invented property, in the place it was written', () => {
    const pre =
      '<Element Class="Simulink.VariantBank">' +
      '<P Source="saveobj" PropertyType="any" Class="struct">' +
      '<Element><P Name="Name" Class="char"/><P Name="Description" Class="char"/></Element>' +
      '</P>' +
      '<P Name="Value" Class="char"/>' +
      '</Element>';
    const body = elementBody(pre, '<Element Class="Simulink.VariantBank">');
    expect(directProps(body)).toEqual(['<unnamed>', 'Value']);
    expect(directProps(elementBody(body.slice(body.indexOf('<P Source="saveobj"')), '<Element>'))).toEqual([
      'Name',
      'Description',
    ]);
  });

  for (const className of Object.keys(MATLAB_CUSTOM_SAVE)) {
    const want = MATLAB_CUSTOM_SAVE[className];

    it(`${className} — text`, () => {
      expect(textEnvelopeFields(className)).toEqual(want);
    });

    it(`${className} — binary`, () => {
      const { fields, beside } = binEnvelopeFields(className);
      // Stated first because it is the defect: no property may sit beside the envelope.
      expect(beside, `${className} carries properties beside its envelope`).toEqual([]);
      expect(fields).toEqual(want);
    });

    it(`${className} — the two formats agree`, () => {
      // The invariant BETWEEN the paths, which is where this repo's bugs live: neither
      // format is the reference, they have to match each other as well as MATLAB.
      expect(binEnvelopeFields(className).fields).toEqual(textEnvelopeFields(className));
    });
  }
});
