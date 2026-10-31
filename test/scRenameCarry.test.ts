// Copyright 2026 The MathWorks, Inc.
//
// RENAMING A CATALOGUED FUNCTION IN A COMPRESSED-BINARY DICTIONARY WRITES TWO PLACES.
//
// A service interface's function is listed by name in a second part of the dictionary, the System
// Composer interface dictionary, beside the entry that holds it. In a compressed-binary .sldd that
// catalog is a zip member the document only passes through, so a rename of the function becomes a
// member swap, undone with the chunk and re-zipped by every save; core owns the vocabulary (where a
// definition spells its name, which sites move: scXmlFunctionRenamePatch and the gate
// catalogFunctionRenameOf).
//
// The rest of this suite (which renames reach the catalog, an entry rename in either format, a
// function rename in an uncompressed-text one) is core's, by the same names, in
// data-explorer-core's scRenameCarry.test.ts. These cases need a fixture core does not track
// (arch_service_binary.sldd), so they stay here, composed from core's own functions as the
// compressed dictionary editor's engine composes them, against core's own save.
import { describe, it, expect } from 'vitest';
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
  mutateEntry,
  scXmlFunctionRenamePatch,
  scXmlRenamePatch,
} from 'data-explorer-core';
import { readSlddParts } from 'data-explorer-view/model';

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

    const result = mutateEntry(entry, () => node.setProperty('Name', newValue), DataModel);
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

// The standard is core's save, not a description of it: every scenario below is run twice,
// once through the provider's composition and once through a fresh core session's
// `serializeSource`, and the two catalogs must be the same text.

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
