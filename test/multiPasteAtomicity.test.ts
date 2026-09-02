// Copyright 2026 The MathWorks, Inc.
//
// A rejected multi-select drop must leave NOTHING behind — not in the text, and
// not on the live model either.
//
// foldPasteEntries runs its allow-check over every payload BEFORE pasting any of
// them, and that ordering is the whole invariant. Each single paste does two
// things: it produces new text AND it adds the new node to the live `section`
// (that is how `_uniqueName` sees the growing namespace and gives a second Bus
// its own name). So checking lazily — rejecting item 2 only once item 1 has been
// pasted — throws with item 1 already grafted onto the in-memory model while the
// document text is discarded. The table repaints from that model, so the user is
// left looking at a phantom row (DataInterface1) that their .sldd never received
// and that vanishes on the next reload.
//
// The existing rejection tests only assert that the call throws, which a lazy
// check satisfies too. These assert the SECTION is untouched, which is what
// actually distinguishes the two orderings, and they do it for both .sldd formats
// because both now route through the shared fold.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, parseBinarySlddParts } from 'data-explorer-core';
import { getModel, invalidate, findNode } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { pasteEntries } from '../src/host/structuralEdit.js';
import { pasteEntriesXml } from '../src/host/xmlStructuralEdit.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

/** Payload of a named top-level entry (skipping section-header rows). */
function payloadOf(uri: string, model: any, name: string): Record<string, unknown> {
  const row = buildRows(model).find(
    (r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'),
  );
  if (!row) throw new Error(`no entry row for "${name}"`);
  return findNode(uri, row.ID).serialize() as Record<string, unknown>;
}

describe('a rejected multi-paste leaves the live section untouched (JSON .sldd)', () => {
  it('does not graft the allowed payload on before rejecting the disallowed one', () => {
    const uri = 'test://atomic-json.sldd';
    invalidate(uri);
    const model = getModel(uri, 'arch.sldd', archText);
    const bus = payloadOf(uri, model, 'DataInterface');
    // A Simulink.ServiceBus has no home in Design — this is the payload that
    // makes the whole drop illegal.
    const svc = payloadOf(uri, model, 'ServiceInterface');
    const design = model.children.find((s: any) => s.name === 'design');
    const before = design.children.map((c: any) => c.name);

    expect(() => pasteEntries(archText, design, [bus, svc])).toThrow(/not allowed|ServiceBus/i);

    // The bus must NOT have been added. With a lazy check this is
    // ['DataInterface1'] — a row the table would paint and the file never got.
    expect(design.children.map((c: any) => c.name)).toEqual(before);
  });

  it('rejects on the FIRST payload just as completely, whatever the order', () => {
    // Order must not matter: a disallowed item first has to reject before the
    // allowed one behind it is pasted either.
    const uri = 'test://atomic-json-order.sldd';
    invalidate(uri);
    const model = getModel(uri, 'arch.sldd', archText);
    const bus = payloadOf(uri, model, 'DataInterface');
    const svc = payloadOf(uri, model, 'ServiceInterface');
    const design = model.children.find((s: any) => s.name === 'design');
    const before = design.children.map((c: any) => c.name);

    expect(() => pasteEntries(archText, design, [svc, bus])).toThrow(/not allowed|ServiceBus/i);
    expect(design.children.map((c: any) => c.name)).toEqual(before);
  });

  it('an all-allowed multi-paste still adds every entry (the check is not just a veto)', () => {
    // Guards the opposite mistake: an up-front check that rejected everything, or
    // a fold that stopped after the first item, would also pass the tests above.
    const uri = 'test://atomic-json-ok.sldd';
    invalidate(uri);
    const model = getModel(uri, 'arch.sldd', archText);
    const bus = payloadOf(uri, model, 'DataInterface');
    const nt = payloadOf(uri, model, 'NumericType');
    const design = model.children.find((s: any) => s.name === 'design');
    const before = design.children.length;

    const { selectIds } = pasteEntries(archText, design, [bus, nt]);
    expect(selectIds).toHaveLength(2);
    expect(design.children.length).toBe(before + 2);
  });
});

describe('a rejected multi-paste leaves the live section untouched (binary .sldd)', () => {
  const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
  const zip = unzipSync(new Uint8Array(readFileSync(binPath)));
  const baseXml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;

  it('rejects the whole drop without adding the allowed payload', () => {
    const uri = 'mem://atomic-xml';
    DataModel.removeDataSource(uri);
    const model = DataModel.addDataSource(uri, parseBinarySlddParts(baseXml, meta), {
      path: 'params.sldd',
    });
    const section = model.children.find((s: any) => s.children.length > 0) ?? model.children[0];
    const good = section.children[0].serialize() as Record<string, unknown>;
    // params.sldd holds no section-illegal entry, so synthesize the payload the
    // allow-list rejects: the gate reads `value._array_class`, which is exactly
    // what a real serialized ServiceBus carries.
    const bad = {
      name: 'Illegal',
      value: { _array_class: 'Simulink.ServiceBus' },
    } as Record<string, unknown>;
    const before = section.children.map((c: any) => c.name);

    // Only meaningful if this section really does restrict its types — otherwise
    // the test would pass for the wrong reason.
    expect(section.allowsType('Simulink.ServiceBus')).toBe(false);
    expect(() => pasteEntriesXml(baseXml, section, [good, bad])).toThrow(
      /not allowed|ServiceBus/i,
    );
    expect(section.children.map((c: any) => c.name)).toEqual(before);
  });
});
