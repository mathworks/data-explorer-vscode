// Copyright 2026 The MathWorks, Inc.
//
// Creating an entry from the Add gallery — the host half, in both .sldd formats.
//
// The providers import `vscode` and cannot run here, so this drives what their `addEntry`
// handlers are made of: `addNewEntry` for a JSON dictionary, `addNewEntryXml` for a
// compressed one, and `opsOfPastedEntries` for the undo pair and the narrow repaint. The
// handlers themselves are ten lines of glue over exactly these calls.
//
// Four invariants, and none of them can be checked from one side alone:
//
//  1. WHAT THE ENTRY IS comes from core, not from the gallery. A tile names a class and a
//     section; the class's default value, the unique name, the uuid/namespace/isderived
//     stamps and the `New` status are all `addEntry`'s (see createEntry). Nothing in this
//     repo may re-derive any of them.
//  2. NARROW === WIDE. The insert the add makes and the re-parse the next full repaint does
//     must agree, row for row — or the row order changes under the user on the next repaint
//     of a file they have not touched since.
//  3. THE TWO FORMATS AGREE. One dictionary written two ways must answer the same tile with
//     the same entry. This is the recurring defect here: one rule, two paths, copies drift.
//     The pair used for it is `parity/artifacts/{text,binary}/params.sldd` — MATLAB's own
//     output for one dictionary saved twice — and NOT `fixtures/arch{,_binary}.sldd`, which
//     are hand-made (scripts/make-fixtures.mjs) and whose binary half carries only
//     `DD.ENTRY` objects. Core's `findEntryInsertionPoint` aims in front of the trailing
//     `DD.Dictionary` / `DD.DICTIONARYREFERENCE`, so a chunk with neither takes no insert at
//     all — by add or by paste, which is its own invariant and pinned below.
//  4. A REFUSED CLASS THROWS, naming the section. The gallery only offers legal tiles, so a
//     refusal means the catalog and core have gone out of step, and a silent no-op would
//     read as a broken button.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { readSlddParts } from '../src/host/slddContent.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { addNewEntry, sectionByName } from '../src/host/structuralEdit.js';
import { addNewEntryXml, pasteEntryXml } from '../src/host/xmlStructuralEdit.js';
import { opsOfPastedEntries } from '../src/host/entryOps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const parity = (name: string) => fileURLToPath(new URL(`./parity/artifacts/${name}`, import.meta.url));
const archText = readFileSync(fixture('arch.sldd'), 'utf8');
// MATLAB's own output for one dictionary saved in both formats — see invariant 3.
const paramsText = readFileSync(parity('text/params.sldd'), 'utf8');

// A JSON .sldd open in the provider: a live model the add attaches to, and the text it
// splices. `liveModel()` is what the handler calls; `invalidate` first, because the model
// cache is shared across this file's cases.
function openJson(uri: string, text = archText, path = 'arch.sldd') {
  invalidate(uri);
  return { model: getModel(uri, path, text), text, path };
}

// A binary .sldd as a zip: chunk XML plus the pass-through members, exactly what
// BinarySlddEditorProvider holds.
function openBinary(srcId: string, file = fixture('arch_binary.sldd'), path = 'arch_binary.sldd') {
  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  const meta: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) if (member !== 'data/chunk0.xml') meta[member] = data;
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  DataModel.removeDataSource(srcId);
  const model = DataModel.addDataSource(srcId, readSlddParts(xml, meta), { path }) as any;
  return { model, xml, meta, srcId, path };
}

const sectionNames = (model: any, sectionName: string): string[] =>
  (sectionByName(model, sectionName).children as any[]).map((e) => e.name);

describe('an add creates the entry core says it creates', () => {
  it('adds a Simulink.Parameter to Design Data, stamped and named by core', () => {
    const uri = 'test://add-param.sldd';
    const { model, text } = openJson(uri);
    const design = sectionByName(model, 'design');
    const before = sectionNames(model, 'design');

    const result = addNewEntry(text, design, 'Simulink.Parameter');

    // The node the add attached: last in the section, because that is where the text
    // insertion puts its element too (invariant 2, pinned properly below).
    const node = (design.children as any[])[design.children.length - 1];
    expect(before).not.toContain(node.name);
    expect(node.className).toBe('Simulink.Parameter');
    // Core's stamps. Not re-derived anywhere in this repo — read them, don't compute them.
    expect(node.status).toBe('New');
    expect(node.isDerived).toBe(false);
    expect(node.metadata.uuid).toMatch(/[0-9a-f]/i);
    expect(node.metadata.isderived).toBe('0');
    // The row the webview is told to select, and then to rename, is this node's.
    expect(result.selectId).toBe(node.id);
  });

  it('adds a Constant to Architectural Data as derived data', () => {
    // The one tile in the Parameters group that departs from its category, and the reason
    // the gallery badges a tile at all: a Constant is architectural wherever it is added
    // from. `isderived` is what separates Arch from Design (they share a namespace), so
    // this is the assertion that the section, not the click, decided.
    const uri = 'test://add-const.sldd';
    const { model, text } = openJson(uri);
    const arch = sectionByName(model, 'arch');

    addNewEntry(text, arch, 'Constant');

    const node = (arch.children as any[])[arch.children.length - 1];
    expect(node.isDerived).toBe(true);
    expect(node.metadata.isderived).toBe('1');
    expect(node.status).toBe('New');
  });

  it('gives each add a fresh unique name, so a pinned run of clicks never collides', () => {
    const uri = 'test://add-run.sldd';
    const { model, text } = openJson(uri);
    const design = sectionByName(model, 'design');

    // A pinned run: three clicks on one tile, each against the text the last produced.
    let working = text;
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      working = addNewEntry(working, design, 'Simulink.Parameter').newText;
      names.push((design.children as any[])[design.children.length - 1].name);
    }
    expect(new Set(names).size).toBe(3);
    // And the FILE says the same three. The uniqueness comes from the model's namespace, so
    // a name that existed only in the tree would be the failure worth catching.
    invalidate(uri);
    const reread = getModel(uri, 'arch.sldd', working);
    for (const name of names) expect(sectionNames(reread, 'design')).toContain(name);
  });

  it('needs each add of a run computed against the text the last one wrote', () => {
    // WHY the JSON provider serializes adds on the write (`queueAddEntry`). Every structural
    // handler there reads the document when it starts and writes when it ends; the gallery's
    // pin is the one gesture that can arrive faster than that, so a second handler could read
    // the text from before the first entry existed. Both adds then name the SAME insertion
    // offset — and applied in order, the file lists them backwards from the model.
    const uri = 'test://add-stale.sldd';
    const { model, text } = openJson(uri);
    const design = sectionByName(model, 'design');

    const first = addNewEntry(text, design, 'Simulink.Parameter');
    const stale = addNewEntry(text, design, 'Simulink.Parameter'); // the same text, twice
    expect(stale.patch!.offset).toBe(first.patch!.offset);
    // The model has them in click order…
    const modelOrder = (design.children as any[]).slice(-2).map((e) => e.name);
    // …and the file, written that way, does not. Inserting at a stale offset puts the second
    // entry in FRONT of the first: rows that reorder under the user on the next full repaint,
    // which is the narrow-vs-wide divergence this whole path is built to avoid.
    const at = stale.patch!.offset;
    const collided = first.newText.slice(0, at) + stale.patch!.text + first.newText.slice(at);
    invalidate(uri);
    const fileOrder = sectionNames(getModel(uri, 'arch.sldd', collided), 'design').slice(-2);
    expect(fileOrder).toEqual([...modelOrder].reverse());

    // Serialized — the second add reading the first's output — and the two agree.
    invalidate(uri);
    const fresh = getModel(uri, 'arch.sldd', text);
    const freshDesign = sectionByName(fresh, 'design');
    let working = text;
    for (let i = 0; i < 2; i++) working = addNewEntry(working, freshDesign, 'Simulink.Parameter').newText;
    invalidate(uri);
    expect(sectionNames(getModel(uri, 'arch.sldd', working), 'design')).toEqual(sectionNames(fresh, 'design'));
  });

  it('refuses a class the section does not allow, and says which section refused', () => {
    // Architectural Data stopped allowing a Signal in core v1.26.0 — the change this
    // gallery's catalog was built against. The gallery offers no such tile; reaching this
    // means the catalog and core have gone out of step, which is worth an error.
    const uri = 'test://add-refused.sldd';
    const { model, text } = openJson(uri);
    const arch = sectionByName(model, 'arch');
    expect(() => addNewEntry(text, arch, 'Simulink.Signal')).toThrow(/cannot be added to/);
    expect(() => addNewEntry(text, arch, 'Simulink.Signal')).toThrow(/Architectural Data|arch/);
  });

  it('names no section when the key is not one this dictionary has', () => {
    // The handler's own guard: the message carries a section KEY, and a webview that ever
    // sent a wrong one must get an error rather than an add into whatever section was first.
    const uri = 'test://add-nosection.sldd';
    const { model } = openJson(uri);
    expect(sectionByName(model, 'design')).toBeTruthy();
    expect(sectionByName(model, 'nonesuch')).toBeNull();
  });
});

describe('the add the table paints and the re-parse the next repaint does agree', () => {
  it('puts the new entry where a full re-read puts it, and in the ops an undo needs', () => {
    const uri = 'test://add-narrow.sldd';
    const { model, text } = openJson(uri);
    const design = sectionByName(model, 'design');
    const addedFrom = (design.children as any[]).length;

    const result = addNewEntry(text, design, 'Simulink.LookupTable');
    const added = opsOfPastedEntries(design, addedFrom);

    // What the provider repaints: ONE insert, of the entry the add created, appended (no
    // beforeRowId) — which is what `insertEntryRows` means by "last in this section".
    expect(added.applied.length).toBe(1);
    expect(added.applied[0].kind).toBe('insert');
    expect((added.applied[0] as any).beforeRowId).toBeUndefined();
    // And what the undo takes back: the same entry, removed by the id the rows carry.
    expect(added.pairs.length).toBe(1);
    expect(added.pairs[0].undo).toEqual({ kind: 'remove', rowId: result.selectId });

    // NARROW === WIDE: the rows the live model yields, against the rows a re-parse of the
    // written text yields. A disagreement here is a row order that changes under the user.
    const live = buildRows(model).map((r: any) => r.ID);
    invalidate(uri);
    const wide = buildRows(getModel(uri, 'arch.sldd', result.newText)).map((r: any) => r.ID);
    expect(live).toEqual(wide);
    // Sanity: the comparison is about the new entry, so it had better be in both lists.
    expect(wide).toContain(result.selectId);
  });

  it('writes one insertion and leaves every other byte alone', () => {
    const uri = 'test://add-bytes.sldd';
    const { model, text } = openJson(uri);
    const design = sectionByName(model, 'design');

    const result = addNewEntry(text, design, 'Simulink.Signal');

    // The patch is what the provider hands VS Code: a zero-length replacement, i.e. an
    // insertion, so a 47.8 MB dictionary costs the new element and not a full rewrite.
    expect(result.patch).toBeTruthy();
    expect(result.patch!.length).toBe(0);
    // Everything on either side of the insertion point is byte-identical.
    const at = result.patch!.offset;
    expect(result.newText.slice(0, at)).toBe(text.slice(0, at));
    expect(result.newText.slice(at + result.patch!.text.length)).toBe(text.slice(at));
  });
});

describe('a JSON add and a binary add produce the same entry', () => {
  it('adds the same tile to both formats of one dictionary and compares the results', () => {
    const jsonUri = 'test://add-format-json.sldd';
    const srcId = 'add-format-bin';
    const json = openJson(jsonUri, paramsText, 'params.sldd');
    const bin = openBinary(srcId, parity('binary/params.sldd'), 'params.sldd');
    try {
      const jsonDesign = sectionByName(json.model, 'design');
      const binDesign = sectionByName(bin.model, 'design');
      // The premise: the two files are the same dictionary, so the add starts from the same
      // set of names in both. Without this the name comparison below would prove nothing.
      expect(sectionNames(bin.model, 'design')).toEqual(sectionNames(json.model, 'design'));

      const jsonResult = addNewEntry(json.text, jsonDesign, 'Simulink.Bus');
      const binResult = addNewEntryXml(bin.xml, binDesign, 'Simulink.Bus');

      const jsonNode = (jsonDesign.children as any[])[jsonDesign.children.length - 1];
      const binNode = (binDesign.children as any[])[binDesign.children.length - 1];
      // Same class, same name, same section stamps, same row id — everything except the
      // uuid, which is fresh per entry by design.
      expect(binNode.className).toBe(jsonNode.className);
      expect(binNode.name).toBe(jsonNode.name);
      expect(binNode.status).toBe(jsonNode.status);
      expect(binNode.metadata.isderived).toBe(jsonNode.metadata.isderived);
      expect(binNode.metadata.namespace).toBe(jsonNode.metadata.namespace);
      // A node id is `<sourceId>/<section>/<name>`, and the source id is which document is
      // open — so what the add decides is the tail, and that is what has to match.
      const tail = (id: string, source: string) => id.slice(source.length);
      expect(tail(binResult.selectId!, srcId)).toBe(tail(jsonResult.selectId!, jsonUri));
      expect(binNode.metadata.uuid).not.toBe(jsonNode.metadata.uuid);

      // And both files read back as the dictionary their model says they are.
      invalidate(jsonUri);
      const jsonReread = getModel(jsonUri, json.path, jsonResult.newText);
      DataModel.removeDataSource(srcId);
      const binReread = DataModel.addDataSource(srcId, readSlddParts(binResult.newText, bin.meta), {
        path: bin.path,
      }) as any;
      expect(sectionNames(binReread, 'design')).toEqual(sectionNames(jsonReread, 'design'));
      const jsonAdded = sectionByName(jsonReread, 'design').children.at(-1);
      const binAdded = sectionByName(binReread, 'design').children.at(-1);
      expect(binAdded.className).toBe(jsonAdded.className);
      expect(binAdded.status).toBe(jsonAdded.status);
    } finally {
      DataModel.removeDataSource(srcId);
    }
  });

  it('refuses the same class in both formats', () => {
    const srcId = 'add-format-refuse';
    const bin = openBinary(srcId, parity('binary/params.sldd'), 'params.sldd');
    try {
      const arch = sectionByName(bin.model, 'arch');
      expect(() => addNewEntryXml(bin.xml, arch, 'Simulink.Signal')).toThrow(/cannot be added to/);
      // Refused before anything is written: the allow-check is `createEntry`, ahead of the
      // splice, so the text the caller holds is untouched and there is nothing to undo.
      expect(() => addNewEntryXml(bin.xml, arch, 'Simulink.Signal')).toThrow(/Architectural Data|arch/);
    } finally {
      DataModel.removeDataSource(srcId);
    }
  });

  it('fills a section that is empty in both formats, which has no row to aim at', () => {
    // The capability the gallery adds over paste: a tile names its destination, so the FIRST
    // entry of an empty section can be created. `params.sldd` has an empty Architectural Data
    // in both formats, and Constant is the arch-only class — so this is also the case where
    // `beforeRowId` must be absent and the row goes under the bare section header.
    const jsonUri = 'test://add-empty-json.sldd';
    const srcId = 'add-empty-bin';
    const json = openJson(jsonUri, paramsText, 'params.sldd');
    const bin = openBinary(srcId, parity('binary/params.sldd'), 'params.sldd');
    try {
      const jsonArch = sectionByName(json.model, 'arch');
      const binArch = sectionByName(bin.model, 'arch');
      expect(sectionNames(json.model, 'arch')).toEqual([]);
      expect(sectionNames(bin.model, 'arch')).toEqual([]);

      const jsonResult = addNewEntry(json.text, jsonArch, 'Constant');
      const added = opsOfPastedEntries(jsonArch, 0);
      const binResult = addNewEntryXml(bin.xml, binArch, 'Constant');

      expect(added.applied.length).toBe(1);
      expect((added.applied[0] as any).beforeRowId).toBeUndefined();
      expect(sectionNames(json.model, 'arch')).toEqual(sectionNames(bin.model, 'arch'));
      // Derived in both, because the SECTION decided it — see the Constant case above.
      expect((binArch.children as any[])[0].metadata.isderived).toBe('1');

      invalidate(jsonUri);
      expect(sectionNames(getModel(jsonUri, json.path, jsonResult.newText), 'arch')).toEqual(
        sectionNames(json.model, 'arch'),
      );
      DataModel.removeDataSource(srcId);
      const binReread = DataModel.addDataSource(srcId, readSlddParts(binResult.newText, bin.meta), {
        path: bin.path,
      }) as any;
      expect(sectionNames(binReread, 'arch')).toEqual(sectionNames(json.model, 'arch'));
    } finally {
      DataModel.removeDataSource(srcId);
    }
  });

  it('refuses an add exactly where it refuses a paste, when the chunk takes no insert', () => {
    // Both XML inserts go through one `insertNewEntry`, so the add inherits the paste's rule
    // about WHERE an entry goes — including its one failure. `fixtures/arch_binary.sldd` is a
    // real example of a chunk with no trailing dictionary object (invariant 3): nothing can be
    // inserted into it, and the add must say so rather than guess an offset.
    const srcId = 'add-noinsert-bin';
    const bin = openBinary(srcId);
    try {
      // Whichever section this fixture's entries are in — it is an arch fixture, so not
      // `design` — because the point is the insert, not the section.
      const entry = (bin.model.children as any[]).flatMap((s: any) => s.children as any[])[0];
      const section = entry.parent;
      const payload = entry.serialize() as Record<string, unknown>;
      // A class the section DOES allow, so the only thing left to fail is the insert. (An
      // entry's own `className` would not do: a Constant's reads `double`, not its key.)
      const className = (section.getAllowedTypes() as string[])[0];
      expect(section.allowsType(className)).toBe(true);
      expect(() => pasteEntryXml(bin.xml, section, payload)).toThrow('Could not locate the insertion point.');
      expect(() => addNewEntryXml(bin.xml, section, className)).toThrow('Could not locate the insertion point.');
    } finally {
      DataModel.removeDataSource(srcId);
    }
  });
});

describe('the row the add selects still resolves, so the next edit on it works', () => {
  it('finds the new entry by the id the rows carry, with no re-parse in between', () => {
    // The obligation `opsOfPastedEntries` exists for: a node id is a PATH, and an entry that
    // joined the tree inside `addEntry` is in no index until something puts it there. Get
    // this wrong and the add looks fine — it is the rename right after it that fails with
    // "could not locate the edited item in the model", which is the whole gesture.
    const uri = 'test://add-resolve.sldd';
    const { model, text } = openJson(uri);
    const design = sectionByName(model, 'design');
    const addedFrom = (design.children as any[]).length;

    const result = addNewEntry(text, design, 'Simulink.Parameter');
    opsOfPastedEntries(design, addedFrom);

    expect(findNode(uri, result.selectId!)).toBeTruthy();
  });
});
