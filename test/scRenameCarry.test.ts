// Copyright 2026 The MathWorks, Inc.
//
// RENAMING A CATALOGUED ENTRY WRITES TWO PLACES IN THE FILE.
//
// An Architectural Data entry is stored as an ordinary Simulink object — a
// `Simulink.Bus` is a Bus whether System Composer models it as a data interface or as a
// struct type. What tells the two apart is a SECOND part of the dictionary, the System
// Composer interface dictionary, which lists each definition BY NAME. So renaming such
// an entry and touching only the entry damages the file both ways at once: the entry
// re-reads as its raw Simulink class (a struct type comes back a data interface — a
// different thing entirely), and the catalog is left defining an interface no entry
// backs. Neither is visible until the file is read again.
//
// Core owns the vocabulary — where a definition spells its name in either syntax, and
// which sites move with a rename (`scanScJsonText` / `scanScXml` / `scRenameEdits`).
// What THIS file pins is the host's obligation, which is different in each format and
// identical in effect:
//
//   uncompressed-text  the catalog is in the same TextDocument as the entry, so the
//                      rename becomes extra range replacements in the SAME
//                      WorkspaceEdit — one undo step, one change event, and spans that
//                      must not overlap the entry span the edit already carries.
//   compressed-binary  the catalog is a zip member the document only passes through
//                      (`zipMeta`), so the rename becomes a member swap that has to be
//                      undone with the chunk and re-zipped by every save.
//
// Neither provider can run under vitest (both import `vscode`), so — like
// binaryEntryScopedEdit.test.ts and jsonHostEditRepaint.test.ts beside it — this
// reproduces each provider's composition from the real modules and asks the only
// question that matters: read the file back, and is the entry still what it was?
//
// The gate is pinned too, in both directions, because carrying a rename too eagerly is
// the worse bug: a bus element named after the value type it references is not a
// definition of anything, and moving the catalog under it would strip the entry that
// really carries that name.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { DataModel, SlddNode, SC_PART_XML, serializeEntryToXml } from 'data-explorer-core';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { findEntrySpan, detectIndent } from '../src/host/entrySplice.js';
import { entrySelectorOf } from '../src/host/entrySelector.js';
import { reserializeEntry, findOwningEntry } from '../src/host/structuralEdit.js';
import { mutateEntry } from '../src/host/entryOps.js';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import { readSlddParts } from '../src/host/slddContent.js';
import { catalogRenameOf, scJsonRenameEdits, scXmlRenamePatch } from '../src/host/scRename.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const kindsOf = (sldd: SlddNode): Record<string, string> => {
  const out: Record<string, string> = {};
  sldd.children.forEach((section) => {
    section.children.forEach((entry) => {
      out[entry.name] = (entry as unknown as { kind: string }).kind;
    });
  });
  return out;
};

// ---------------------------------------------------------------------------
// The uncompressed-text provider: one WorkspaceEdit over one document.
// ---------------------------------------------------------------------------

const openUris: string[] = [];

/** SlddTextEditorProvider's applyEdit, minus the parts that need a webview. */
function openJson(uri: string) {
  if (!openUris.includes(uri)) openUris.push(uri);
  DataModel.removeDataSource(uri);
  invalidate(uri);
  const doc = { text: readFileSync(fixture('./fixtures/arch.sldd'), 'utf8') };

  const live = () => getModel(uri, 'arch.sldd', doc.text);
  const entryNamed = (name: string) =>
    (live() as any).children.flatMap((s: any) => s.children).find((e: any) => e.name === name);

  /**
   * A table rename, as the provider composes it: read the document text, mutate the
   * tree it is holding, then submit ONE edit holding the entry's new span text and
   * every catalog site that names it.
   */
  const rename = (rowId: string, newValue: string) => {
    const currentText = doc.text;
    live();
    const node = findNode(uri, rowId);
    expect(node, `row ${rowId} resolves to a node`).toBeTruthy();
    const entry = findOwningEntry(node);
    const selector = entrySelectorOf(entry);
    // Read BEFORE the mutation: the catalog is keyed by the name the file still spells.
    const carry = catalogRenameOf('Name', newValue, node, entry);

    expect(mutateEntry(entry, () => (node as any).setProperty('Name', newValue))).toBe(true);

    const span = findEntrySpan(currentText, selector);
    expect(span, `the entry text for "${selector.name}" is locatable`).not.toBeNull();
    const edits = [
      { start: span!.offset, end: span!.offset + span!.length, text: reserializeEntry(entry, detectIndent(currentText)) },
      ...(carry ? scJsonRenameEdits(currentText, carry.oldName, carry.newName) : []),
    ];
    doc.text = applyDocEdits(currentText, edits);
    return { edits, carry };
  };

  /** post(): the wide repaint every multi-change event falls back to. */
  const reread = () => {
    invalidate(uri);
    return getModel(uri, 'arch.sldd', doc.text) as unknown as SlddNode;
  };

  return { doc, live, entryNamed, rename, reread };
}

/**
 * Apply the edits of one WorkspaceEdit, the way VS Code does — every range addressed
 * against the pre-edit text, so the splice runs back to front.
 *
 * The overlap check is not decoration: VS Code REJECTS a WorkspaceEdit whose ranges
 * overlap, so an entry span that collided with a catalog site would not be a wrong
 * edit, it would be no edit at all.
 */
function applyDocEdits(text: string, edits: { start: number; end: number; text: string }[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  sorted.forEach((edit, i) => {
    if (i > 0) {
      expect(edit.start, 'the edits of one WorkspaceEdit do not overlap').toBeGreaterThanOrEqual(sorted[i - 1].end);
    }
  });
  let out = text;
  [...sorted].reverse().forEach((edit) => {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  });
  return out;
}

afterAll(() => {
  openUris.forEach((uri) => {
    DataModel.removeDataSource(uri);
    invalidate(uri);
  });
});

// ---------------------------------------------------------------------------
// The compressed-binary provider: a chunk splice plus a pass-through member swap.
// ---------------------------------------------------------------------------

/** BinarySlddEditorProvider's document, at the size this question needs. */
function openBinary() {
  const srcId = 'screname:' + Math.random();
  const zip = unzipSync(new Uint8Array(readFileSync(fixture('./fixtures/arch_binary.sldd'))));
  const zipMeta: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) if (member !== 'data/chunk0.xml') zipMeta[member] = data;
  const doc = { chunkXml: new TextDecoder().decode(zip['data/chunk0.xml']), zipMeta };

  const build = () => {
    DataModel.removeDataSource(srcId);
    return DataModel.addDataSource(srcId, readSlddParts(doc.chunkXml, doc.zipMeta), {
      path: 'arch_binary.sldd',
    }) as unknown as SlddNode;
  };
  const live = () => ((DataModel as any).getDataSource(srcId) ?? build()) as SlddNode;
  const entryNamed = (name: string) =>
    (live() as any).children.flatMap((s: any) => s.children).find((e: any) => e.name === name);

  /**
   * A table rename, as the provider composes it: splice the entry's `<Object>` in
   * chunkXml and swap the catalog member, then hand both to pushEdit so undo can put
   * them back together.
   */
  const rename = (name: string, newValue: string) => {
    const entry = entryNamed(name);
    const selector = entrySelectorOf(entry);
    const carry = catalogRenameOf('Name', newValue, entry, entry);
    const part = carry ? scXmlRenamePatch(doc.zipMeta, carry.oldName, carry.newName) : null;

    expect(DataModel.mutateSubtree(entry, () => entry.setProperty('Name', newValue))).toBe(true);

    const before = doc.chunkXml;
    const span = findEntryObjectSpan(before, selector);
    expect(span, `the entry XML for "${name}" is locatable`).not.toBeNull();
    const frag = serializeEntryToXml(entry).replace(/\n$/, '');
    const after = before.slice(0, span!.offset) + frag + before.slice(span!.offset + span!.length);

    // pushEdit's forward half, and the undo it hands VS Code.
    doc.chunkXml = after;
    if (part) doc.zipMeta[part.member] = part.after;
    const undo = () => {
      doc.chunkXml = before;
      if (part) doc.zipMeta[part.member] = part.before;
    };
    return { part, undo };
  };

  /** repaintAll(): the wide re-read of chunk + pass-through parts. */
  const reread = () => build();

  /** writeTo(): the re-zip a save performs, read back as a file would be. */
  const roundTrip = () => {
    const zipped = zipSync({ ...doc.zipMeta, 'data/chunk0.xml': new TextEncoder().encode(doc.chunkXml) });
    const files = unzipSync(zipped);
    const meta: Record<string, Uint8Array> = {};
    for (const [member, data] of Object.entries(files)) if (member !== 'data/chunk0.xml') meta[member] = data;
    return SlddNode.parse(
      readSlddParts(new TextDecoder().decode(files['data/chunk0.xml']), meta),
      'arch_binary.sldd',
    );
  };

  const dispose = () => DataModel.removeDataSource(srcId);

  return { doc, live, entryNamed, rename, reread, roundTrip, dispose };
}

// ---------------------------------------------------------------------------

// The gate, which is the same sentence in both providers: WHICH renames carry. It has to
// be read before the mutation (the catalog is keyed by the old name) and it has to be
// scoped to top-level entries (the catalog only lists those).
describe('the renames that reach the catalog', () => {
  it('carries a top-level entry rename', () => {
    const entry = { name: 'StructType' };
    expect(catalogRenameOf('Name', 'Wheel', entry, entry)).toEqual({ oldName: 'StructType', newName: 'Wheel' });
  });

  it('does not carry a nested row that shares a definition name', () => {
    // A bus element named after the value type it references — which is how System
    // Composer writes a bus of value types, and is not a definition of anything. Moving
    // the catalog under it would strip the entry that really is called `ValueType`.
    const entry = { name: 'DataInterface' };
    const element = { name: 'ValueType' };
    expect(catalogRenameOf('Name', 'Speed', element, entry)).toBeNull();
  });

  it('does not carry an edit to any other column', () => {
    const entry = { name: 'StructType' };
    expect(catalogRenameOf('Description', 'a note', entry, entry)).toBeNull();
    expect(catalogRenameOf('Value', '42', entry, entry)).toBeNull();
  });

  it('does not carry a rename that renames nothing', () => {
    const entry = { name: 'StructType' };
    expect(catalogRenameOf('Name', 'StructType', entry, entry)).toBeNull();
  });
});

describe('carrying a rename in an uncompressed-text dictionary', () => {
  it('keeps a renamed struct type a struct type', () => {
    const d = openJson('test://sc-rename-json-struct.sldd');
    const entry = d.entryNamed('StructType');

    d.rename(entry.id, 'Wheel');

    const reread = d.reread();
    expect(kindsOf(reread).Wheel).toBe('Struct Type');
    expect(Object.keys(reread.systemComposer!.modeledDataTypes).sort()).toEqual([
      'AliasType',
      'EnumType',
      'NumericType',
      'Wheel',
    ]);
  });

  it('keeps a renamed value type a value type', () => {
    const d = openJson('test://sc-rename-json-value.sldd');
    const entry = d.entryNamed('ValueType');

    const { edits } = d.rename(entry.id, 'Speed');

    // The entry span and the catalog's one site for this definition, in one edit.
    expect(edits).toHaveLength(2);
    const reread = d.reread();
    expect(kindsOf(reread).Speed).toBe('Value Type');
    // And the OTHER value type, whose name is a prefix of the renamed one, is untouched
    // — the sites are spans, not a string search.
    expect(kindsOf(reread).ValueType1).toBe('Value Type');
    expect(reread.systemComposer!.interfaces).toMatchObject({
      Speed: 'systemcomposer.architecture.model.interface.ValueTypeInterface',
      ValueType1: 'systemcomposer.architecture.model.interface.ValueTypeInterface',
    });
  });

  it('writes nothing extra for an entry no definition names', () => {
    // The overwhelming majority of renames — every Design Data entry, and here an
    // architectural Constant the catalog does not list. One edit, and the catalog comes
    // back exactly as it went in.
    const d = openJson('test://sc-rename-json-plain.sldd');
    const before = d.live().systemComposer;
    const entry = d.entryNamed('Constant');

    const { edits, carry } = d.rename(entry.id, 'Gain');

    expect(carry).toEqual({ oldName: 'Constant', newName: 'Gain' });
    expect(edits).toHaveLength(1);
    expect(d.reread().systemComposer).toEqual(before);
  });
});

describe('carrying a rename in a compressed-binary dictionary', () => {
  it('keeps a renamed struct type a struct type', () => {
    const d = openBinary();
    try {
      const { part } = d.rename('StructType', 'Wheel');

      expect(part?.member).toBe(SC_PART_XML);
      expect(kindsOf(d.reread()).Wheel).toBe('Struct Type');
    } finally {
      d.dispose();
    }
  });

  it('leaves a bus element that shares the renamed type name alone', () => {
    // `DataInterface` holds an element named `ValueType`, after the type it references.
    // Renaming the value type entry moves the definition and its own descriptor, and not
    // that element — which is the difference between a targeted patch and a replace-all.
    const d = openBinary();
    try {
      d.rename('ValueType', 'Speed');

      const reread = d.reread();
      // The definition moved (this entry reads 'Value Type' from its Simulink class either
      // way, so the catalog is where the difference actually shows).
      expect(reread.systemComposer!.interfaces).toEqual({
        Speed: 'systemcomposer.architecture.model.interface.ValueTypeInterface',
        DataInterface: 'systemcomposer.architecture.model.interface.CompositeDataInterface',
      });
      expect(kindsOf(reread).Speed).toBe('Value Type');
      expect((d.entryNamed('DataInterface') as any).children.map((c: any) => c.name)).toContain('ValueType');
    } finally {
      d.dispose();
    }
  });

  it('survives the re-zip a save performs', () => {
    const d = openBinary();
    try {
      d.rename('StructType', 'Wheel');

      // The catalog member is a pass-through part: the swap only counts if the zip the
      // save writes carries it.
      expect(kindsOf(d.roundTrip()).Wheel).toBe('Struct Type');
    } finally {
      d.dispose();
    }
  });

  it('puts both surfaces back on undo', () => {
    const d = openBinary();
    try {
      const originalPart = d.doc.zipMeta[SC_PART_XML];
      const originalKinds = kindsOf(d.reread());

      const { undo } = d.rename('StructType', 'Wheel');
      undo();

      // Byte-identical, not merely equivalent: the part is written back verbatim, so an
      // undo that rebuilt it would show up in the user's file as a reformatting.
      expect(d.doc.zipMeta[SC_PART_XML]).toEqual(originalPart);
      expect(kindsOf(d.reread())).toEqual(originalKinds);
    } finally {
      d.dispose();
    }
  });

  it('does not patch the part for a name no definition carries', () => {
    const d = openBinary();
    try {
      // `Element` is a struct element's name inside a definition, and `double` is one of
      // the built-in types the catalog also lists. Neither is a definition, so neither
      // moves.
      expect(scXmlRenamePatch(d.doc.zipMeta, 'Element', 'Elem')).toBeNull();
      expect(scXmlRenamePatch(d.doc.zipMeta, 'double', 'float')).toBeNull();
    } finally {
      d.dispose();
    }
  });

  it('does not patch a dictionary that has no catalog part at all', () => {
    // Nearly every `.sldd`. There is nothing to carry, and the rename must not invent a
    // member that would then be written into the user's file.
    const zip = unzipSync(new Uint8Array(readFileSync(fixture('./fixtures/compressed.sldd'))));
    const zipMeta: Record<string, Uint8Array> = {};
    for (const [member, data] of Object.entries(zip)) if (member !== 'data/chunk0.xml') zipMeta[member] = data;

    expect(zipMeta[SC_PART_XML]).toBeUndefined();
    expect(scXmlRenamePatch(zipMeta, 'Kp', 'Ki')).toBeNull();
  });
});
