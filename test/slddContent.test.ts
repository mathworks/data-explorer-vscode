// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import type { ParseWarning } from 'data-explorer-core';
import { readSlddContent, readSlddParts, scanSldd } from '../src/host/slddContent.js';

function bytes(relpath: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(relpath, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

// The rt_bin fixture with a DD.DICTIONARYREFERENCE spliced in that names no
// Subdictionary: the file says it inherits entries from a dictionary it cannot name,
// so those entries are missing from the tree and only a warning says so.
function danglingReference(): ArrayBuffer {
  const zip = unzipSync(new Uint8Array(bytes('./fixtures/rt_bin.sldd')));
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) entries[k] = v;
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  entries['data/chunk0.xml'] = new TextEncoder().encode(
    xml.replace('</DataSource>', '    <Object Class="DD.DICTIONARYREFERENCE"/>\n</DataSource>'),
  );
  const out = zipSync(entries, { level: 6 });
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

// The one shape both formats deserialize to; every downstream consumer (the
// datamodel, the name index, the usage graph) reads entries through this path.
function entryNames(content: Record<string, unknown>): string[] {
  const parts = content.__MW_TEXT_PARTS__ as Record<string, any>;
  const inner = parts['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  return (inner.entries as any[]).map((e) => e.name);
}

describe('readSlddContent', () => {
  it('reads a JSON .sldd', () => {
    const content = readSlddContent(bytes('./fixtures/numeric_json.sldd'));
    expect(entryNames(content).length).toBeGreaterThan(0);
  });

  it('reads a compressed-binary .sldd into the SAME content shape', () => {
    // The whole point of the helper: past this call, nothing downstream has to
    // know which format the file was — so both formats must produce a content
    // object the same accessor path can read.
    const content = readSlddContent(bytes('./fixtures/compressed.sldd'));
    expect(entryNames(content).length).toBeGreaterThan(0);
  });

  it('dispatches on the ZIP magic bytes, not the filename', () => {
    // It takes bytes, with no name to be misled by. A compressed and a JSON
    // dictionary carry the same `.sldd` extension — MATLAB picks the format from
    // FileFormat at save time — so gating on the extension would read a
    // compressed dictionary as JSON and throw, yielding a file that looks empty.
    // These two fixtures differ ONLY in format.
    expect(() => readSlddContent(bytes('./fixtures/rt_text.sldd'))).not.toThrow();
    expect(() => readSlddContent(bytes('./fixtures/rt_bin.sldd'))).not.toThrow();
    expect(entryNames(readSlddContent(bytes('./fixtures/rt_bin.sldd')))).toEqual(
      entryNames(readSlddContent(bytes('./fixtures/rt_text.sldd'))),
    );
  });

  it('throws on content that is neither a zip nor valid JSON', () => {
    // Callers that scan a whole workspace (nameIndex.recordsForFile,
    // usageGraph.buildGraph) wrap this in a try and let a corrupt file
    // contribute nothing, so the throw is the contract they rely on — returning
    // an empty object instead would make a truncated dictionary indistinguishable
    // from an empty one.
    expect(() => readSlddContent(encode('{ this is not json'))).toThrow();
  });

  it('throws for an unreadable zip too, not just unreadable JSON', () => {
    // The same rule, on the other path — and the path where it is easy to lose,
    // because the binary reader no longer throws: it recovers from an unreadable
    // data/chunk0.xml and answers an EMPTY dictionary with a `source-unreadable`
    // warning. Without this test the contract above would be true of JSON and
    // silently false of zip, which is a truncated dictionary presented as an empty
    // one — the exact confusion the throw exists to prevent.
    const zip = unzipSync(new Uint8Array(bytes('./fixtures/rt_bin.sldd')));
    const entries: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(zip)) entries[k] = v;
    // A well-formed zip, an intact OPC layout, and one part that is not markup.
    entries['data/chunk0.xml'] = new TextEncoder().encode('not markup');
    const corrupt = zipSync(entries, { level: 6 });
    const ab = corrupt.buffer.slice(corrupt.byteOffset, corrupt.byteOffset + corrupt.byteLength) as ArrayBuffer;
    // The fixture it was made from still reads, so the throw is about the part and
    // not about how this test rebuilt the package.
    expect(entryNames(readSlddContent(bytes('./fixtures/rt_bin.sldd'))).length).toBeGreaterThan(0);
    expect(() => readSlddContent(ab)).toThrow();
  });

  it('reports a part-level loss into the caller’s sink and still returns the content', () => {
    // The sink is what makes a recoverable loss visible. Both callers pass the SAME
    // array on to DataModel.addDataSource, where SlddNode.parse appends its own
    // findings — so this array is the whole file's report, and a caller that let it
    // default (or passed a fresh one at the second step) would silently drop
    // everything the zip reader found. The file opens either way, so nothing else
    // would show it.
    const warnings: ParseWarning[] = [];
    const content = readSlddContent(danglingReference(), warnings);
    expect(warnings.map((w) => w.code)).toEqual(['part-unreadable']);
    // Not refused: the dictionary's own entries all read, and refusing the file for
    // one lost inheritance would lose them too.
    expect(entryNames(content).length).toBeGreaterThan(0);
  });

  it('leaves a clean read’s sink empty', () => {
    const warnings: ParseWarning[] = [];
    readSlddContent(bytes('./fixtures/rt_bin.sldd'), warnings);
    expect(warnings).toEqual([]);
  });

  it('accepts JSON that is valid but not dictionary-shaped', () => {
    // Shape validation belongs to the consumers (they read through optional
    // chaining and tolerate a missing __MW_TEXT_PARTS__); this function only
    // decides the FORMAT. A stricter check here would reject content the
    // consumers handle fine.
    expect(readSlddContent(encode('{"unexpected":true}'))).toEqual({ unexpected: true });
  });
});

// The names-and-refs read for the two workspace-wide scans. Core does the fast part; what
// is tested here is that this host's rule survives it, because the fast path is exactly
// where it could be lost: core's scanner FALLS BACK to the recovering full read, and that
// read answers an empty dictionary with a warning rather than throwing.
describe('scanSldd', () => {
  it('reads names and refs from both on-disk spellings of the same dictionary', () => {
    // rt_bin and rt_text differ ONLY in format, and they take completely different code
    // in core — a byte scan over inflated XML versus JSON.parse. Comparing them is what
    // says the fast path did not quietly read something else.
    expect(scanSldd(bytes('./fixtures/rt_bin.sldd')).names.length).toBeGreaterThan(0);
    expect(scanSldd(bytes('./fixtures/rt_bin.sldd')).names).toEqual(
      scanSldd(bytes('./fixtures/rt_text.sldd')).names,
    );
  });

  it('agrees with the full read it replaces', () => {
    // The substitution this change is: every name the DOM parse reports, in the same
    // order, for a fraction of the work. Core checks this over its whole corpus; this
    // pins it on the fixture the two call sites here actually see.
    for (const fixture of ['./fixtures/rt_bin.sldd', './fixtures/compressed.sldd', './fixtures/rt_text.sldd']) {
      expect(scanSldd(bytes(fixture)).names).toEqual(entryNames(readSlddContent(bytes(fixture))));
    }
  });

  it('throws for an unreadable zip part, rather than answering an empty dictionary', () => {
    // THE reason this wrapper exists. Core's scanner refuses a chunk that is not markup
    // and falls back to the read that RECOVERS, so calling core directly would hand back
    // zero names for a truncated dictionary — no error to see, the file simply stops
    // contributing to the name index and the relationship graph.
    const zip = unzipSync(new Uint8Array(bytes('./fixtures/rt_bin.sldd')));
    const entries: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(zip)) entries[k] = v;
    entries['data/chunk0.xml'] = new TextEncoder().encode('not markup');
    const corrupt = zipSync(entries, { level: 6 });
    const ab = corrupt.buffer.slice(corrupt.byteOffset, corrupt.byteOffset + corrupt.byteLength) as ArrayBuffer;
    expect(scanSldd(bytes('./fixtures/rt_bin.sldd')).names.length).toBeGreaterThan(0);
    expect(() => scanSldd(ab)).toThrow();
  });

  it('throws on bytes that are neither a zip nor valid JSON', () => {
    expect(() => scanSldd(encode('{ this is not json'))).toThrow();
  });

  it('reports a part-level loss into the caller’s sink and still returns the names', () => {
    // Runs through core's FALLBACK: a `<Object Class="DD.DICTIONARYREFERENCE"/>` with no
    // Subdictionary is a shape the scanner refuses, so this is the path where a forwarded
    // warnings array could be dropped and nothing else would show it. Not refused — the
    // dictionary's own entries all read, and losing them over one lost inheritance would
    // be the worse trade.
    const warnings: ParseWarning[] = [];
    const out = scanSldd(danglingReference(), warnings);
    expect(warnings.map((w) => w.code)).toEqual(['part-unreadable']);
    expect(out.names.length).toBeGreaterThan(0);
  });

  it('leaves a clean read’s sink empty', () => {
    // The fast path raises no warnings of its own, so a non-empty sink here would mean it
    // fell back for a dictionary it should have scanned.
    const warnings: ParseWarning[] = [];
    scanSldd(bytes('./fixtures/rt_bin.sldd'), warnings);
    expect(warnings).toEqual([]);
  });
});

// The same read for the live chunk0.xml + pass-through parts the writable binary
// editor holds between edits. It exists so that provider's four parse sites — paint,
// two mid-transform rebuilds, and the save gate — cannot each decide for themselves
// what an unreadable chunk means.
describe('readSlddParts', () => {
  function parts(fixture: string): { xml: string; meta: Record<string, Uint8Array> } {
    const zip = unzipSync(new Uint8Array(bytes(fixture)));
    const meta: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
    return { xml: new TextDecoder().decode(zip['data/chunk0.xml']), meta };
  }

  it('reads a live chunk0.xml into the same content shape', () => {
    const { xml, meta } = parts('./fixtures/rt_bin.sldd');
    expect(entryNames(readSlddParts(xml, meta)).length).toBeGreaterThan(0);
  });

  it('throws for a chunk that is not markup, rather than answering an empty dictionary', () => {
    const { meta } = parts('./fixtures/rt_bin.sldd');
    expect(() => readSlddParts('not markup', meta)).toThrow();
  });

  it('reports a part-level loss into the caller’s sink here too', () => {
    // The writable binary editor rebuilds its model on every paint and mid-transform,
    // all through this one function, so the sink has to work on this path as well: a
    // dictionary that warns on open and stops warning after an unrelated edit would
    // be reporting on the edit rather than on the file.
    const { meta } = parts('./fixtures/rt_bin.sldd');
    const xml = new TextDecoder().decode(
      unzipSync(new Uint8Array(danglingReference()))['data/chunk0.xml'],
    );
    const warnings: ParseWarning[] = [];
    expect(entryNames(readSlddParts(xml, meta, warnings)).length).toBeGreaterThan(0);
    expect(warnings.map((w) => w.code)).toEqual(['part-unreadable']);
  });

  it('throws for well-formed XML whose root is not <DataSource>', () => {
    // The dangerous shape: the reader accepts it and answers a dictionary with zero
    // entries, i.e. reports success. On the paint path that is a table with no rows
    // for a file full of entries; through the save gate it is that emptiness zipped
    // over the file on disk.
    const { meta } = parts('./fixtures/rt_bin.sldd');
    expect(() => readSlddParts('<Other Class="DD.THING"/>', meta)).toThrow();
  });
});
