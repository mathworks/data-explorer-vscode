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

// --- object_array_binary.sldd: a binary (zip) SLDD holding two OBJECT ARRAYS ---
// so the binary parser's multi-<Element> object path is exercised end-to-end:
//   paramArray : 3x1 Simulink.Parameter (a KNOWN class → each element a typed
//                ParameterNode) in Design Data
//   usageArray : 2x1 Simulink.VariableUsage (a CUSTOM class → each element a
//                generic ObjectNode) in Other Data
// The shape mirrors object_props_binary.sldd: a <P Name="Value"> with a
// Dimension attribute and one <Element Class="..."> per array element.
const entry = (name, ns, valueXml) =>
  `<Object Class="DD.ENTRY">` +
  `<P Name="Name" Class="char">${name}</P>` +
  `<P Name="Namespace" Class="char">${ns}</P>` +
  `<P Name="IsDerived" Class="char">0</P>` +
  `<P Name="Value" Dimension="${valueXml.dim}">${valueXml.elements}</P>` +
  `</Object>`;
const NS_DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
const NS_OTHER = '42516768-0ace-4981-8ac7-0a9b32cba471';
const paramElem = (v, desc) =>
  `<Element Class="Simulink.Parameter">` +
  `<P Name="Value" Class="int32">${v}</P>` +
  `<P Name="Description" Class="char">${desc}</P>` +
  `</Element>`;
const usageElem = (n) =>
  `<Element Class="Simulink.VariableUsage">` +
  `<P Name="Name" Class="char">${n}</P>` +
  `<P Name="Source" Class="char">f14</P>` +
  `<P Name="SourceType" Class="char">model workspace</P>` +
  `</Element>`;
const objArrXml =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">` +
  entry('paramArray', NS_DESIGN, {
    dim: '3*1',
    elements: paramElem(10, 'first') + paramElem(20, 'second') + paramElem(30, 'third'),
  }) +
  entry('usageArray', NS_OTHER, {
    dim: '2*1',
    elements: usageElem('Ka') + usageElem('Kf'),
  }) +
  `</DataSource>`;
writeFileSync(
  here('object_array_binary.sldd'),
  zipSync({
    'data/chunk0.xml': strToU8(objArrXml),
    'metadata/mwcoreProperties.xml': strToU8(`<x><matlabRelease>R2027a</matlabRelease></x>`),
  }),
);

console.log('wrote model_with_refs.slx, compressed.sldd, object_array_binary.sldd');
