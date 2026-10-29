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
import {
  DataModel,
  SlddNode,
  SC_PART_XML,
  createSession,
  ingest,
  serializeEntryToXml,
  entrySelectorOf,
  findEntryObjectSpan,
  catalogFunctionRenameOf,
  catalogRenameOf,
  scJsonFunctionRenameEdits,
  scJsonRenameEdits,
  scXmlFunctionRenamePatch,
  scXmlRenamePatch,
} from 'data-explorer-core';
import { readSlddParts } from 'data-explorer-view/model';
import { getModel, findNode, invalidate } from 'data-explorer-view/host';
import { findEntrySpan, detectIndent } from '../src/host/entrySplice.js';
import { reserializeEntry, findOwningEntry } from '../src/host/structuralEdit.js';
import { mutateEntry } from '../src/host/entryOps.js';

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

/**
 * SlddTextEditorProvider's applyEdit, minus the parts that need a webview.
 *
 * `edit` rewrites the fixture's text before anything reads it, for a case the checked-in
 * file does not have (a Prototype that does not declare its own function).
 */
function openJson(uri: string, edit: (text: string) => string = (text) => text) {
  if (!openUris.includes(uri)) openUris.push(uri);
  DataModel.removeDataSource(uri);
  invalidate(uri);
  const doc = { text: edit(readFileSync(fixture('./fixtures/arch.sldd'), 'utf8')) };

  const live = () => getModel(uri, 'arch.sldd', doc.text);
  const entryNamed = (name: string) =>
    (live() as any).children.flatMap((s: any) => s.children).find((e: any) => e.name === name);
  /** A function of a service interface entry, as its row resolves. */
  const functionNamed = (entryName: string, name: string) =>
    entryNamed(entryName).children.find((c: any) => c.name === name);

  /**
   * A table rename, as the provider composes it: read the document text, mutate the
   * tree it is holding, then submit ONE edit holding the entry's new span text and
   * every catalog site that names it. A refused rename returns the refusal and writes
   * nothing, which is where the provider's validationError branch returns.
   */
  const attemptRename = (rowId: string, newValue: string) => {
    const currentText = doc.text;
    live();
    const node = findNode(uri, rowId);
    expect(node, `row ${rowId} resolves to a node`).toBeTruthy();
    const entry = findOwningEntry(node);
    const selector = entrySelectorOf(entry);
    // Read BEFORE the mutation: the catalog is keyed by the name the file still spells.
    const carry = catalogRenameOf('Name', newValue, node, entry);
    const functionCarry = catalogFunctionRenameOf('Name', newValue, node, entry);

    const result = mutateEntry(entry, () => (node as any).setProperty('Name', newValue));
    if (result !== true) {
      return { result, edits: [], carry, functionCarry };
    }

    const span = findEntrySpan(currentText, selector);
    expect(span, `the entry text for "${selector.name}" is locatable`).not.toBeNull();
    const edits = [
      { start: span!.offset, end: span!.offset + span!.length, text: reserializeEntry(entry, detectIndent(currentText)) },
      ...(carry
        ? scJsonRenameEdits(currentText, carry.oldName, carry.newName)
        : functionCarry
          ? scJsonFunctionRenameEdits(currentText, functionCarry)
          : []),
    ];
    doc.text = applyDocEdits(currentText, edits);
    return { result, edits, carry, functionCarry };
  };

  const rename = (rowId: string, newValue: string) => {
    const attempt = attemptRename(rowId, newValue);
    expect(attempt.result, `the rename of row ${rowId} to ${newValue} is accepted`).toBe(true);
    return attempt;
  };

  /** post(): the wide repaint every multi-change event falls back to. */
  const reread = () => {
    invalidate(uri);
    return getModel(uri, 'arch.sldd', doc.text) as unknown as SlddNode;
  };

  return { doc, live, entryNamed, functionNamed, attemptRename, rename, reread };
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
function openBinary(fixtureName = 'arch_binary.sldd') {
  const srcId = 'screname:' + Math.random();
  const zip = unzipSync(new Uint8Array(readFileSync(fixture('./fixtures/' + fixtureName))));
  const zipMeta: Record<string, Uint8Array> = {};
  for (const [member, data] of Object.entries(zip)) if (member !== 'data/chunk0.xml') zipMeta[member] = data;
  const doc = { chunkXml: new TextDecoder().decode(zip['data/chunk0.xml']), zipMeta };

  const build = () => {
    DataModel.removeDataSource(srcId);
    return DataModel.addDataSource(srcId, readSlddParts(doc.chunkXml, doc.zipMeta), {
      path: fixtureName,
    }) as unknown as SlddNode;
  };
  const live = () => ((DataModel as any).getDataSource(srcId) ?? build()) as SlddNode;
  const entryNamed = (name: string) =>
    (live() as any).children.flatMap((s: any) => s.children).find((e: any) => e.name === name);

  /**
   * A table rename, as the provider composes it: splice the entry's `<Object>` in
   * chunkXml and swap the catalog member, then hand both to pushEdit so undo can put
   * them back together.
   *
   * `child` names a row under the entry (a service interface's function) to rename instead
   * of the entry itself. A refused rename returns the refusal and patches nothing, which is
   * where the provider's validationError branch returns.
   */
  const attemptRename = (name: string, newValue: string, child?: string) => {
    const entry = entryNamed(name);
    const node = child === undefined ? entry : entry.children.find((c: any) => c.name === child);
    expect(node, `the entry ${name} has a row named ${child}`).toBeTruthy();
    const selector = entrySelectorOf(entry);
    // Both read BEFORE the mutation: the catalog is keyed by the names the file still spells.
    const carry = catalogRenameOf('Name', newValue, node, entry);
    const functionCarry = catalogFunctionRenameOf('Name', newValue, node, entry);

    const result = mutateEntry(entry, () => node.setProperty('Name', newValue));
    if (result !== true) {
      return { result, part: null, undo: () => {}, carry, functionCarry };
    }

    const before = doc.chunkXml;
    const span = findEntryObjectSpan(before, selector);
    expect(span, `the entry XML for "${name}" is locatable`).not.toBeNull();
    const frag = serializeEntryToXml(entry).replace(/\n$/, '');
    const after = before.slice(0, span!.offset) + frag + before.slice(span!.offset + span!.length);
    // After the validation gate, as in the provider: a refused edit reads no part.
    const part = carry
      ? scXmlRenamePatch(doc.zipMeta, carry.oldName, carry.newName)
      : functionCarry
        ? scXmlFunctionRenamePatch(doc.zipMeta, functionCarry)
        : null;

    // pushEdit's forward half, and the undo it hands VS Code.
    doc.chunkXml = after;
    if (part) doc.zipMeta[part.member] = part.after;
    const undo = () => {
      doc.chunkXml = before;
      if (part) doc.zipMeta[part.member] = part.before;
    };
    return { result, part, undo, carry, functionCarry };
  };

  const rename = (name: string, newValue: string, child?: string) => {
    const attempt = attemptRename(name, newValue, child);
    expect(attempt.result, `the rename of ${child ?? name} to ${newValue} is accepted`).toBe(true);
    return attempt;
  };

  /** repaintAll(): the wide re-read of chunk + pass-through parts. */
  const reread = () => build();

  /** writeTo()'s re-zip, unzipped again: the members a save puts in the file. */
  const saved = () => {
    const zipped = zipSync({ ...doc.zipMeta, 'data/chunk0.xml': new TextEncoder().encode(doc.chunkXml) });
    const files = unzipSync(zipped);
    const meta: Record<string, Uint8Array> = {};
    for (const [member, data] of Object.entries(files)) if (member !== 'data/chunk0.xml') meta[member] = data;
    return { chunkXml: new TextDecoder().decode(files['data/chunk0.xml']), zipMeta: meta };
  };

  /** writeTo(): the re-zip a save performs, read back as a file would be. */
  const roundTrip = () => {
    const files = saved();
    return SlddNode.parse(readSlddParts(files.chunkXml, files.zipMeta), fixtureName);
  };

  const dispose = () => DataModel.removeDataSource(srcId);

  return { doc, live, entryNamed, attemptRename, rename, reread, saved, roundTrip, dispose };
}

// ---------------------------------------------------------------------------

// The gate, which is the same sentence in both providers: WHICH renames carry. It has to
// be read before the mutation (the catalog is keyed by the old name), it has to be scoped
// to top-level entries (the catalog only lists those), and to the entries of the Design
// namespace (the only ones it names — see test/scCatalogScope.test.ts in data-explorer-core).
describe('the renames that reach the catalog', () => {
  const arch = { name: 'arch' };

  it('carries a top-level entry rename', () => {
    const entry = { name: 'StructType', parent: arch };
    expect(catalogRenameOf('Name', 'Wheel', entry, entry)).toEqual({ oldName: 'StructType', newName: 'Wheel' });
  });

  it('does not carry a nested row that shares a definition name', () => {
    // A bus element named after the value type it references — which is how System
    // Composer writes a bus of value types, and is not a definition of anything. Moving
    // the catalog under it would strip the entry that really is called `ValueType`.
    const entry = { name: 'DataInterface', parent: arch };
    const element = { name: 'ValueType' };
    expect(catalogRenameOf('Name', 'Speed', element, entry)).toBeNull();
  });

  it('does not carry an edit to any other column', () => {
    const entry = { name: 'StructType', parent: arch };
    expect(catalogRenameOf('Description', 'a note', entry, entry)).toBeNull();
    expect(catalogRenameOf('Value', '42', entry, entry)).toBeNull();
  });

  it('does not carry a rename that renames nothing', () => {
    const entry = { name: 'StructType', parent: arch };
    expect(catalogRenameOf('Name', 'StructType', entry, entry)).toBeNull();
  });

  it('carries only an entry of the Design namespace: Design Data and Architectural Data', () => {
    // A name is unique only within a namespace, and the catalog names the Design namespace's
    // definitions: an Other Data or Configurations entry that shares a definition's name is
    // not that definition, and renaming it must leave the catalog alone.
    for (const section of ['design', 'arch']) {
      const entry = { name: 'StructType', parent: { name: section } };
      expect(catalogRenameOf('Name', 'Wheel', entry, entry), section).toEqual({ oldName: 'StructType', newName: 'Wheel' });
    }
    for (const section of ['other', 'config']) {
      const entry = { name: 'StructType', parent: { name: section } };
      expect(catalogRenameOf('Name', 'Wheel', entry, entry), section).toBeNull();
    }
    // And an entry in no section at all is in no namespace.
    const loose = { name: 'StructType' };
    expect(catalogRenameOf('Name', 'Wheel', loose, loose)).toBeNull();
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

// ---------------------------------------------------------------------------
// A service interface's FUNCTION, which the catalog keeps a copy of too.
// ---------------------------------------------------------------------------
//
// A `Simulink.FunctionElement` is a row under its ServiceBus entry, so the entry gate above
// never sees it. But the catalog spells each function of a service interface itself, under
// that interface's definition: its `p_Name`, and its `p_FunctionPrototype`, which declares it
// BY NAME (`y = f(u,v)`). Core renames the data part's Prototype with the Name (and refuses a
// rename the Prototype cannot follow), and its own save carries the rename into the catalog.
// Neither editor saves through core, so each has to carry it the way it carries an entry
// rename: extra ranges in the same WorkspaceEdit, or a member swap on the same undo step.
//
// The standard is core's save, not a description of it: every scenario below is run twice,
// once through the provider's composition and once through a fresh core session's
// `serializeSource`, and the two catalogs must be the same text.

const CATALOG_KEY = '"__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary"';

/** A textual dictionary's catalog part: from its key to the end of the text. */
function catalogPartOf(text: string): string {
  const at = text.indexOf(CATALOG_KEY);
  expect(at, 'the dictionary has a catalog part').toBeGreaterThan(0);
  return text.slice(at);
}

/** Everything before the catalog part: the entries. */
const dataPartOf = (text: string): string => text.slice(0, text.indexOf(CATALOG_KEY));

/** `text` with each `from` replaced by its `to`, checking first that `from` occurs exactly once. */
function replacedOnce(text: string, pairs: [from: string, to: string][]): string {
  return pairs.reduce((out, [from, to]) => {
    expect(out.split(from).length - 1, `"${from}" occurs exactly once`).toBe(1);
    return out.replace(from, () => to);
  }, text);
}

/** One rename: of the entry `entry`, or of its function `fn`, to `to`. */
interface Step {
  entry: string;
  fn?: string;
  to: string;
}

/** Core's own save of `content` after `steps` ran on a fresh session's tree. */
function coreSaved(content: Uint8Array, filename: string, steps: Step[]) {
  const session = createSession();
  const src: any = ingest(session, content, { filename });
  steps.forEach(({ entry, fn, to }) => {
    const e = src.children.flatMap((s: any) => s.children).find((x: any) => x.name === entry);
    const node = fn === undefined ? e : e.children.find((c: any) => c.name === fn);
    expect(node.setProperty('Name', to), `core accepts ${fn ?? entry} -> ${to}`).toBe(true);
  });
  const out = session.serializeSource(src.name)!;
  session.removeDataSource(src.name);
  return out;
}

/** The scenarios a record of renames has to get right, and an editor that edits as it goes. */
const STEPS: [label: string, steps: Step[]][] = [
  ['one rename', [{ entry: 'ServiceInterface', fn: 'f', to: 'compute' }]],
  [
    'the interface renamed first, then its function',
    [
      { entry: 'ServiceInterface', to: 'Svc' },
      { entry: 'Svc', fn: 'f', to: 'compute' },
    ],
  ],
  [
    'the function renamed first, then its interface',
    [
      { entry: 'ServiceInterface', fn: 'f', to: 'compute' },
      { entry: 'ServiceInterface', to: 'Svc' },
    ],
  ],
  [
    'a chain',
    [
      { entry: 'ServiceInterface', fn: 'f', to: 'compute' },
      { entry: 'ServiceInterface', fn: 'compute', to: 'step' },
    ],
  ],
  [
    'a rename back',
    [
      { entry: 'ServiceInterface', fn: 'f', to: 'compute' },
      { entry: 'ServiceInterface', fn: 'compute', to: 'f' },
    ],
  ],
];

describe('the function renames that reach the catalog', () => {
  // In Architectural Data, where a service interface is — which the entry gate asks too.
  const entry = { name: 'ServiceInterface', className: 'Simulink.ServiceBus', parent: { name: 'arch' } };
  const fn = { name: 'f', className: 'Simulink.FunctionElement', parent: entry };

  it('carries a function of a top-level service interface, keyed by the interface', () => {
    expect(catalogFunctionRenameOf('Name', 'compute', fn, entry)).toEqual({
      interfaceName: 'ServiceInterface',
      oldName: 'f',
      newName: 'compute',
    });
  });

  it('carries the rows a real service interface reads as', () => {
    // The fakes above only stand for the tree if a real function row has the entry as its
    // parent and the class the gate asks for, which is what this pins.
    const d = openJson('test://sc-fn-gate.sldd');
    const real = d.functionNamed('ServiceInterface', 'f');
    expect(catalogFunctionRenameOf('Name', 'compute', real, d.entryNamed('ServiceInterface'))).toEqual({
      interfaceName: 'ServiceInterface',
      oldName: 'f',
      newName: 'compute',
    });
  });

  it('does not carry an edit to any other column', () => {
    expect(catalogFunctionRenameOf('Description', 'a note', fn, entry)).toBeNull();
    expect(catalogFunctionRenameOf('Value', 'y = g(u)', fn, entry)).toBeNull();
  });

  it('does not carry a rename that renames nothing', () => {
    expect(catalogFunctionRenameOf('Name', 'f', fn, entry)).toBeNull();
  });

  it('does not carry an element of a data bus', () => {
    const bus = { name: 'DataInterface', className: 'Simulink.Bus' };
    expect(catalogFunctionRenameOf('Name', 'Speed', { name: 'ValueType', className: 'Simulink.BusElement', parent: bus }, bus)).toBeNull();
  });

  it('does not carry a row deeper than the function, such as one of its arguments', () => {
    const arg = { name: 'u', className: 'Simulink.BusElement', parent: fn };
    expect(catalogFunctionRenameOf('Name', 'x', arg, entry)).toBeNull();
  });

  it('does not carry the entry itself, which is the entry gate’s case, so the two never both fire', () => {
    expect(catalogFunctionRenameOf('Name', 'Svc', entry, entry)).toBeNull();
    expect(catalogRenameOf('Name', 'Svc', entry, entry)).not.toBeNull();
    expect(catalogRenameOf('Name', 'compute', fn, entry)).toBeNull();
  });
});

describe('carrying a function rename in an uncompressed-text dictionary', () => {
  it('writes the function’s two catalog sites, and nothing else, in the same edit', () => {
    const d = openJson('test://sc-fn-json-sites.sldd');
    const before = d.doc.text;

    const { edits, carry, functionCarry } = d.rename(d.functionNamed('ServiceInterface', 'f').id, 'compute');

    expect(carry).toBeNull();
    expect(functionCarry).toEqual({ interfaceName: 'ServiceInterface', oldName: 'f', newName: 'compute' });
    // The entry span, the function's `p_Name`, and its `p_FunctionPrototype`.
    expect(edits).toHaveLength(3);
    // The entries are what the entry span alone writes: the Name and its Prototype.
    expect(dataPartOf(d.doc.text)).toBe(dataPartOf(applyDocEdits(before, [edits[0]])));
    expect(dataPartOf(d.doc.text)).toContain('"Name": "compute"');
    expect(dataPartOf(d.doc.text)).toContain('"Prototype": "y = compute(u,v)"');
    // And the catalog differs from the one read at exactly the function's own two sites.
    expect(catalogPartOf(d.doc.text)).toBe(
      replacedOnce(catalogPartOf(before), [
        ['"p_FunctionPrototype": "y = f(u,v)"', '"p_FunctionPrototype": "y = compute(u,v)"'],
        ['"p_Name": "f"', '"p_Name": "compute"'],
      ]),
    );
  });

  it.each(STEPS)('writes the catalog core’s own save writes: %s', (_label, steps) => {
    const d = openJson('test://sc-fn-json-core.sldd');
    const original = d.doc.text;

    steps.forEach(({ entry, fn, to }) => {
      const row = fn === undefined ? d.entryNamed(entry) : d.functionNamed(entry, fn);
      const { edits } = d.rename(row.id, to);
      // A multi-range edit takes the wide repaint, which re-reads the document.
      if (edits.length > 1) d.reread();
    });

    const core = coreSaved(new TextEncoder().encode(original), 'arch.sldd', steps);
    expect(core.kind).toBe('text');
    expect(catalogPartOf(d.doc.text)).toBe(catalogPartOf((core as { text: string }).text));
  });

  it('writes the catalog core’s own save writes for a swap, which the sibling check makes three renames', () => {
    const d = openJson('test://sc-fn-json-swap.sldd');
    const original = d.doc.text;
    const steps: Step[] = [
      { entry: 'ServiceInterface', fn: 'f', to: 'tmp' },
      { entry: 'ServiceInterface', fn: 'f1', to: 'f' },
      { entry: 'ServiceInterface', fn: 'tmp', to: 'f1' },
    ];
    steps.forEach(({ entry, fn, to }) => {
      d.rename(d.functionNamed(entry, fn!).id, to);
      d.reread();
    });

    const core = coreSaved(new TextEncoder().encode(original), 'arch.sldd', steps) as { text: string };
    expect(catalogPartOf(d.doc.text)).toBe(catalogPartOf(core.text));
    expect(catalogPartOf(d.doc.text)).toContain('"p_FunctionPrototype": "y = f(u,v,w,y)"');
    expect(catalogPartOf(d.doc.text)).toContain('"p_FunctionPrototype": "y = f1(u,v)"');
  });

  it('still reads as a service interface that lists the renamed function', () => {
    const d = openJson('test://sc-fn-json-reread.sldd');
    const catalogBefore = d.live().systemComposer;

    d.rename(d.functionNamed('ServiceInterface', 'f').id, 'compute');

    const reread = d.reread() as any;
    expect(kindsOf(reread).ServiceInterface).toBe('Service Interface');
    const names = d.entryNamed('ServiceInterface').children.map((c: any) => c.name);
    expect(names).toContain('compute');
    expect(names).not.toContain('f');
    expect(reread.systemComposer.interfaces).toEqual(catalogBefore.interfaces);
  });

  it('writes nothing extra for a function the catalog does not list', () => {
    // `f2` is in the entry and not in the catalog: the gate passes it, and the catalog has
    // no site for it, so the edit is the entry span alone and the catalog is as read.
    const d = openJson('test://sc-fn-json-unlisted.sldd');
    const before = d.doc.text;

    const { edits, functionCarry } = d.rename(d.functionNamed('ServiceInterface', 'f2').id, 'h');

    expect(functionCarry).toEqual({ interfaceName: 'ServiceInterface', oldName: 'f2', newName: 'h' });
    expect(edits).toHaveLength(1);
    expect(catalogPartOf(d.doc.text)).toBe(catalogPartOf(before));
  });

  it('refuses a rename the Prototype cannot follow, with core’s reason, and writes nothing', () => {
    // A Prototype that does not declare the function by its own name: core cannot rename the
    // two together, and MATLAB requires them to match, so the rename is refused. That refusal
    // is the `{ error, reason }` every other refused edit returns, which the provider shows.
    const d = openJson('test://sc-fn-json-prototype.sldd', (text) =>
      replacedOnce(text, [['"Prototype": "y = f(u,v)"', '"Prototype": "y = step(u,v)"']]),
    );
    const before = d.doc.text;

    const { result, edits } = d.attemptRename(d.functionNamed('ServiceInterface', 'f').id, 'compute');

    expect(result).toMatchObject({ error: true });
    expect((result as { reason: string }).reason).toContain("'f' cannot be renamed: its Prototype 'y = step(u,v)'");
    expect(edits).toEqual([]);
    expect(d.doc.text).toBe(before);
    expect(d.functionNamed('ServiceInterface', 'f').Prototype).toBe('y = step(u,v)');
  });

  it('refuses a sibling’s name, and writes nothing', () => {
    const d = openJson('test://sc-fn-json-sibling.sldd');
    const before = d.doc.text;

    const { result, edits } = d.attemptRename(d.functionNamed('ServiceInterface', 'f').id, 'f1');

    expect(result).toMatchObject({ error: true });
    expect(edits).toEqual([]);
    expect(d.doc.text).toBe(before);
  });
});

describe('carrying a function rename in a compressed-binary dictionary', () => {
  const SVC = 'arch_service_binary.sldd';
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const coreSavedMember = (steps: Step[]) => {
    const out = coreSaved(new Uint8Array(readFileSync(fixture('./fixtures/' + SVC))), SVC, steps);
    expect(out.kind).toBe('binary');
    return decode(unzipSync((out as { bytes: Uint8Array }).bytes)[SC_PART_XML]);
  };

  it('patches the function’s two catalog sites, and nothing else', () => {
    const d = openBinary(SVC);
    try {
      const original = d.doc.zipMeta[SC_PART_XML];

      const { part, functionCarry } = d.rename('ServiceInterface', 'compute', 'f');

      expect(functionCarry).toEqual({ interfaceName: 'ServiceInterface', oldName: 'f', newName: 'compute' });
      expect(part?.member).toBe(SC_PART_XML);
      // `before` is the member's original bytes, so undo restores the file as read.
      expect(part!.before).toBe(original);
      expect(decode(part!.after)).toBe(
        replacedOnce(decode(original), [
          ['<p_FunctionPrototype>y = f(u)</p_FunctionPrototype>', '<p_FunctionPrototype>y = compute(u)</p_FunctionPrototype>'],
          ['<p_Name>f</p_Name>\n        </p_FunctionElements>', '<p_Name>compute</p_Name>\n        </p_FunctionElements>'],
        ]),
      );
      expect(d.doc.chunkXml).toContain('>compute<');
      expect(d.doc.chunkXml).toContain('y = compute(u)');
    } finally {
      d.dispose();
    }
  });

  it('leaves the data interface named f, and g’s argument named g, alone', () => {
    const d = openBinary(SVC);
    try {
      const original = decode(d.doc.zipMeta[SC_PART_XML]);

      const { part } = d.rename('ServiceInterface', 'h', 'g');

      expect(decode(part!.after)).toBe(
        replacedOnce(original, [
          ['<p_FunctionPrototype>[a,b] = g(g)</p_FunctionPrototype>', '<p_FunctionPrototype>[a,b] = h(g)</p_FunctionPrototype>'],
          ['<p_Name>g</p_Name>\n        </p_FunctionElements>', '<p_Name>h</p_Name>\n        </p_FunctionElements>'],
        ]),
      );
    } finally {
      d.dispose();
    }
  });

  it.each(STEPS)('writes the member core’s own save writes: %s', (_label, steps) => {
    const d = openBinary(SVC);
    try {
      steps.forEach(({ entry, fn, to }) => {
        const { part } = d.rename(entry, to, fn);
        // A part forces the wide repaint, which re-reads chunk and parts together.
        if (part) d.reread();
      });
      expect(decode(d.saved().zipMeta[SC_PART_XML])).toBe(coreSavedMember(steps));
    } finally {
      d.dispose();
    }
  });

  it('survives the re-zip a save performs', () => {
    const d = openBinary(SVC);
    try {
      const { part } = d.rename('ServiceInterface', 'compute', 'f');

      const files = d.saved();
      expect(files.zipMeta[SC_PART_XML]).toEqual(part!.after);
      expect(files.chunkXml).toContain('>compute<');
      const reread = d.roundTrip() as any;
      expect(kindsOf(reread).ServiceInterface).toBe('Service Interface');
    } finally {
      d.dispose();
    }
  });

  it('puts both surfaces back on undo, the member byte for byte', () => {
    const d = openBinary(SVC);
    try {
      const originalPart = d.doc.zipMeta[SC_PART_XML];
      const originalChunk = d.doc.chunkXml;

      const { part, undo } = d.rename('ServiceInterface', 'compute', 'f');
      undo();

      expect(d.doc.zipMeta[SC_PART_XML]).toBe(part!.before);
      expect(d.doc.zipMeta[SC_PART_XML]).toBe(originalPart);
      expect(d.doc.chunkXml).toBe(originalChunk);
    } finally {
      d.dispose();
    }
  });

  it('refuses a rename the Prototype cannot follow, with core’s reason, and patches nothing', () => {
    const d = openBinary(SVC);
    try {
      d.doc.chunkXml = replacedOnce(d.doc.chunkXml, [['y = f(u)', 'y = step(u)']]);
      const originalPart = d.doc.zipMeta[SC_PART_XML];
      const originalChunk = d.doc.chunkXml;

      const { result, part } = d.attemptRename('ServiceInterface', 'compute', 'f');

      expect(result).toMatchObject({ error: true });
      expect((result as { reason: string }).reason).toContain("'f' cannot be renamed: its Prototype 'y = step(u)'");
      expect(part).toBeNull();
      expect(d.doc.zipMeta[SC_PART_XML]).toBe(originalPart);
      expect(d.doc.chunkXml).toBe(originalChunk);
    } finally {
      d.dispose();
    }
  });

  it('refuses a sibling’s name, and patches nothing', () => {
    const d = openBinary(SVC);
    try {
      const originalPart = d.doc.zipMeta[SC_PART_XML];

      const { result, part } = d.attemptRename('ServiceInterface', 'g', 'f');

      expect(result).toMatchObject({ error: true });
      expect(part).toBeNull();
      expect(d.doc.zipMeta[SC_PART_XML]).toBe(originalPart);
    } finally {
      d.dispose();
    }
  });

  it('does not patch for a function the catalog does not list', () => {
    const d = openBinary(SVC);
    try {
      // A name no function has; the data interface `f`, which has no functions; and an
      // interface the catalog does not define at all.
      expect(scXmlFunctionRenamePatch(d.doc.zipMeta, { interfaceName: 'ServiceInterface', oldName: 'h', newName: 'k' })).toBeNull();
      expect(scXmlFunctionRenamePatch(d.doc.zipMeta, { interfaceName: 'f', oldName: 'f', newName: 'k' })).toBeNull();
      expect(scXmlFunctionRenamePatch(d.doc.zipMeta, { interfaceName: 'Other', oldName: 'f', newName: 'k' })).toBeNull();
    } finally {
      d.dispose();
    }
  });

  it('does not patch a dictionary that has no catalog part at all', () => {
    const zip = unzipSync(new Uint8Array(readFileSync(fixture('./fixtures/compressed.sldd'))));
    const zipMeta: Record<string, Uint8Array> = {};
    for (const [member, data] of Object.entries(zip)) if (member !== 'data/chunk0.xml') zipMeta[member] = data;

    expect(zipMeta[SC_PART_XML]).toBeUndefined();
    expect(scXmlFunctionRenamePatch(zipMeta, { interfaceName: 'ServiceInterface', oldName: 'f', newName: 'k' })).toBeNull();
  });
});
