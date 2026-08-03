// Copyright 2026 The MathWorks, Inc.
// Generates minimal binary fixtures for tests. Run: node test/fixtures/make-fixtures.mjs
//
// Key names below are derived from the real parsers (the source of truth):
//   - SlxParser.extractModelReferences reads ref.BlockPath + ref.ModelName
//     under GraphicalInterface.ModelReferences.
//   - SlxParser.extractExternalDataSources looks for <ExplicitExternalBrokerSources>
//     elements and reads their <fullPathToSource> child.
//   - SlxParser reads BlockDiagram.DataDictionary for the linked dictionary.
//   - BinarySlddParser reads <P Name="..."> properties inside <Object Class="DD.ENTRY">.
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

// --- model_with_refs.slx: references plant.slx + a dictionary + a .mat ---
const slxParts = {
  'simulink/blockDiagram.json': strToU8(
    JSON.stringify({ BlockDiagram: { DataDictionary: 'params.sldd', ModelUUID: 'uuid-1' } }),
  ),
  'simulink/graphicalInterface.json': strToU8(
    JSON.stringify({
      ModelReferences: [{ BlockPath: 'ctrl/plant', ModelName: 'plant.slx' }],
    }),
  ),
  'simulink/ExternalDataSourceSettings.xml': strToU8(
    `<?xml version="1.0"?><ExternalDataSourceSettings><ExplicitExternalBrokerSources><fullPathToSource>signals.mat</fullPathToSource></ExplicitExternalBrokerSources></ExternalDataSourceSettings>`,
  ),
  'metadata/coreProperties.xml': strToU8(
    `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
  ),
};
writeFileSync(here('model_with_refs.slx'), zipSync(slxParts));

// --- compressed.sldd: a ZIP SLDD with one entry, zero references ---
const slddXml =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<DataSource FormatVersion="4" MinRelease="R2026b" Arch="glnxa64">` +
  `<Object Class="DD.ENTRY"><P Name="Name">Kp</P></Object>` +
  `</DataSource>`;
const slddParts = {
  'data/chunk0.xml': strToU8(slddXml),
  'metadata/mwcoreProperties.xml': strToU8(`<x><matlabRelease>R2026b</matlabRelease></x>`),
};
writeFileSync(here('compressed.sldd'), zipSync(slddParts));

console.log('wrote model_with_refs.slx, compressed.sldd');
