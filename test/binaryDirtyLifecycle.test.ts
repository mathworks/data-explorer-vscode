// Copyright 2026 The MathWorks, Inc.
//
// Regression coverage for the BINARY .sldd dirty-state / per-row "Modified"
// lifecycle. Sibling of dirtyLifecycle.test.ts (which covers the JSON path).
//
// The binary provider (BinarySlddEditorProvider) is a CustomEditorProvider whose
// post() rebuilds the model from chunkXml and paints rows. It depends on `vscode`
// and cannot be imported under vitest, so — exactly like binarySlddRoundTrip and
// dirtyLifecycle — this suite reproduces the pure post()/applyEdit composition
// using the real modules:
//   BinarySlddParser  (parseBinarySlddParts)
//   BinarySlddSerializer (serializeEntryToXml)
//   xmlEntrySplice    (findEntryObjectSpan)
//   slddBaseline      (captureBaseline / computeModified / clearBaseline)
//   rowBuilder        (buildRows with modifiedNames)
// and asserts the observable contract the provider MUST honor: after a value
// edit, exactly the edited entry's row is stamped Status=Modified, diffed against
// the on-open baseline. This is the bug where the binary post() passed
// `undefined` for modifiedNames, so no binary row ever went Modified.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/dex/core/DataModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';
import { serializeEntryToXml } from '../src/dex/datamodel/parser/BinarySlddSerializer.js';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import { captureBaseline, computeModified, clearBaseline } from '../src/host/slddBaseline.js';
import { buildRows } from '../src/host/rowBuilder.js';

const bytes = readFileSync(
  fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url)),
);

function loadFixture() {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return { xml, meta };
}

describe('binary .sldd dirty-state / Modified lifecycle', () => {
  it('a value edit marks exactly that entry Modified vs the on-open baseline', () => {
    const uri = 'test://bin-life-edit.sldd';
    const srcId = 'binedit:' + uri;
    clearBaseline(uri);
    let { xml } = loadFixture();
    const { meta } = loadFixture();

    // Mirror the provider's buildModel(): drop + re-parse under the srcId.
    const build = () => {
      DataModel.removeDataSource(srcId);
      return DataModel.addDataSource(srcId, parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    };

    // Capture the on-open baseline (this is what the buggy provider omitted).
    captureBaseline(uri, build());
    expect(computeModified(uri, build()).size).toBe(0);

    // Edit scalarD's value 3.14 -> 42, mirroring applyEdit: setProperty on the
    // node, reserialize the owning entry, splice its <Object> fragment back.
    const model = build();
    const target = model.children.flatMap((s: any) => s.children).find((e: any) => e.name === 'scalarD');
    expect(target, 'the scalarD entry exists in the fixture').toBeTruthy();
    expect(target.toRow()._valueEditable).toBe(true);
    expect(target.setProperty('Value', '42')).toBe(true);
    const frag = serializeEntryToXml(target).replace(/\n$/, '');
    const span = findEntryObjectSpan(xml, 'scalarD');
    expect(span).not.toBeNull();
    xml = xml.slice(0, span!.offset) + frag + xml.slice(span!.offset + span!.length);

    // Re-parse the working copy and diff against the baseline (the provider's post()).
    const after = build();
    const modified = computeModified(uri, after);
    expect(modified).toEqual(new Set(['scalarD']));

    // buildRows paints Status=Modified only on the edited entry's row.
    const rows = buildRows(after, modified);
    const editedRow = rows.find((r: any) => r.Name?.label === 'scalarD');
    expect(editedRow.Status).toBe('Modified');
    const siblingRow = rows.find(
      (r: any) => r.Name?.label && r.Name.label !== 'scalarD' && !String(r.ID).startsWith('section:'),
    );
    expect(siblingRow.Status).toBeFalsy();

    DataModel.removeDataSource(srcId);
    clearBaseline(uri);
  });

  it('save re-baselines so no binary rows are Modified', () => {
    const uri = 'test://bin-life-save.sldd';
    const srcId = 'binedit:' + uri;
    clearBaseline(uri);
    let { xml } = loadFixture();
    const { meta } = loadFixture();
    const build = () => {
      DataModel.removeDataSource(srcId);
      return DataModel.addDataSource(srcId, parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    };

    captureBaseline(uri, build());
    const model = build();
    const target = model.children.flatMap((s: any) => s.children).find((e: any) => e.name === 'scalarD');
    target.setProperty('Value', '42');
    const frag = serializeEntryToXml(target).replace(/\n$/, '');
    const span = findEntryObjectSpan(xml, 'scalarD')!;
    xml = xml.slice(0, span.offset) + frag + xml.slice(span.offset + span.length);
    expect(computeModified(uri, build()).size).toBe(1);

    // Simulate saveCustomDocument: re-capture the baseline from the written text.
    captureBaseline(uri, build());
    const rows = buildRows(build(), computeModified(uri, build()));
    expect(rows.some((r: any) => r.Status === 'Modified')).toBe(false);

    DataModel.removeDataSource(srcId);
    clearBaseline(uri);
  });
});
