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
import { zipSync, zlibSync, strToU8 } from 'fflate';
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

// --- nd_numeric.mat: rank-3 and rank-4 numeric arrays for the Variable Editor ---
//
// A Level-5 MAT-file, written by hand because no .mat fixture existed and the
// N-D grid path (the `(:,:,k)` page selector) had no end-to-end coverage. Layout
// per The MathWorks' "MAT-File Format" reference: a 128-byte header, then one
// element per variable. Each variable is wrapped in miCOMPRESSED, which is what
// MATLAB's own `save` emits, so this exercises the same branch of parseMat that
// real files do.
//
// Every subelement here uses the full 8-byte tag form. MATLAB would use the
// "small data element" form for a name of four characters or fewer; the long form
// is equally valid and keeps this writer to one code path.

const MI_INT8 = 1;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const MX_DOUBLE_CLASS = 6;

const pad8 = (n) => (8 - (n % 8)) % 8;

// tag (type, byteCount) + data, with `padding` bytes of alignment after it.
function tagged(type, data, padding) {
  const out = new Uint8Array(8 + data.length + padding);
  new DataView(out.buffer).setUint32(0, type, true);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

// A subelement inside a matrix: padded to the next 8-byte boundary, as the format
// requires, so the reader can walk from one subelement tag to the next.
const subelement = (type, data) => tagged(type, data, pad8(data.length));

// A top-level miCOMPRESSED element: NOT padded. The 8-byte alignment rule covers
// uncompressed data elements; MATLAB writes compressed ones flush, and readers
// advance by exactly 8 + byteCount. Padding these cost an afternoon — the first
// variable parsed fine and every later one vanished, because the extra bytes threw
// the top-level walk off by the padding width and the next tag read as garbage.
const compressed = (data) => tagged(MI_COMPRESSED, data, 0);

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const int32s = (values) => {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setInt32(i * 4, v, true));
  return out;
};

const float64s = (values) => {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return out;
};

// `values` is COLUMN-MAJOR, the order MATLAB stores and this format requires.
function matrixElement(name, dimensions, values) {
  const flags = new Uint8Array(8);
  // Byte 0 is the class; byte 1 carries the complex/global/logical flags, all
  // clear here. Bytes 2-7 are undefined per the spec.
  flags[0] = MX_DOUBLE_CLASS;
  const payload = concat([
    subelement(MI_UINT32, flags),
    subelement(MI_INT32, int32s(dimensions)),
    subelement(MI_INT8, new TextEncoder().encode(name)),
    subelement(MI_DOUBLE, float64s(values)),
  ]);
  return subelement(MI_MATRIX, payload);
}

function matFile(description, elements) {
  const header = new Uint8Array(128);
  header.fill(0x20, 0, 124); // the text field is space-padded, not zero-padded
  header.set(new TextEncoder().encode(description).slice(0, 116), 0);
  const hv = new DataView(header.buffer);
  hv.setUint16(124, 0x0100, true); // version
  header[126] = 0x49; // 'I'
  header[127] = 0x4d; // 'M'  — little-endian indicator
  // Each variable compressed independently, exactly as `save` writes them.
  const wrapped = elements.map((el) => compressed(zlibSync(el)));
  return concat([header, ...wrapped]);
}

// Chosen so a positional read of the grid is visibly WRONG rather than plausible:
// page 1 must display as `1 2 3 / 4 5 6`, which in column-major storage is
// interleaved. Reading the bytes in order would render `1 3 5 / 2 4 6`.
const nd = matrixElement('Nd', [2, 3, 2], [1, 4, 2, 5, 3, 6, 7, 10, 8, 11, 9, 12]);
// Rank 4, so the pager has two trailing subscripts and must step dim 3 fastest:
// (:,:,1,1) (:,:,2,1) (:,:,1,2) (:,:,2,2). Each page is filled with its own
// number, which makes a mis-ordered pager obvious at a glance.
const nd4 = matrixElement(
  'Nd4',
  [2, 2, 2, 2],
  [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4],
);
// A plain 2-D matrix and a vector in the same file: the vector must show NO glyph,
// so the gate is visible side by side with the cases that pass it.
const mat2d = matrixElement('Mat', [2, 3], [1, 4, 2, 5, 3, 6]);
const vec = matrixElement('Vec', [1, 4], [1, 2, 3, 4]);
writeFileSync(
  here('nd_numeric.mat'),
  matFile('MATLAB 5.0 MAT-file, hand-built fixture for the Variable Editor', [
    mat2d,
    nd,
    nd4,
    vec,
  ]),
);

console.log('wrote model_with_refs.slx, compressed.sldd, object_array_binary.sldd, nd_numeric.mat');
