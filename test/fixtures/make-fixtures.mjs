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

// --- model_with_refs.mdl: the MODERN `.mdl` — a text OPC package ---
//
// The SAME parts as model_with_refs.slx above, deliberately: a modern `.mdl` and a
// `.slx` of one model carry a byte-identical part set and differ only in framing
// (delimiter lines instead of a zip). Sharing `slxParts` is what makes the two
// fixtures genuine twins, so a test can assert both files open to the same
// relationships and be testing the FRAMING rather than two hand-written models
// that happen to agree.
//
// metadata/coreProperties.xml is written BASE64 to cover the binary-part path: in a
// real `.mdl` the .mxarray model workspace is encoded that way to survive a text
// file. If the decode were wrong, `release` would come back empty rather than
// R2026b, which is exactly what the test asserts.
const BASE64_PARTS = new Set(['metadata/coreProperties.xml']);

function opcTextPackage(parts, modelName) {
  const enc = new TextEncoder();
  const chunks = [
    // A banner and a small legacy Model stub precede the package marker, so that a
    // tool expecting the classic format finds something it can read rather than
    // binary noise. The parser skips both.
    enc.encode(
      `# MathWorks OPC Text Package\nModel {\n  Name                    "${modelName}"\n  Version                 25.0\n}\n__MWOPC_PACKAGE_BEGIN__\n`,
    ),
  ];
  for (const path of Object.keys(parts)) {
    const b64 = BASE64_PARTS.has(path);
    // The header names the part with a LEADING slash, and flags an encoded one with
    // a trailing ` BASE64`.
    chunks.push(enc.encode(`__MWOPC_PART_BEGIN__ /${path}${b64 ? ' BASE64' : ''}\n`));
    chunks.push(b64 ? enc.encode(Buffer.from(parts[path]).toString('base64')) : parts[path]);
    // Exactly ONE newline after the content: it introduces the next marker and
    // belongs to the framing, not to the part. A second one would be read as the
    // part's own trailing byte and corrupt the JSON parts.
    chunks.push(enc.encode('\n'));
  }
  chunks.push(enc.encode('__MWOPC_PACKAGE_END__\n'));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
writeFileSync(here('model_with_refs.mdl'), opcTextPackage(slxParts, 'model_with_refs'));

// --- legacy_ctrl.mdl: the CLASSIC (pre-R2012) `.mdl` — nested braces ---
//
// A model that was never migrated, and what `ExportToVersion 'R2011b'` still writes.
// It shares no framing with anything above: properties are `Name value` lines and
// children are `Name { ... }` blocks.
//
// Chosen to carry one of each relationship the sections tree draws, so the graph can
// be asserted on a legacy file:
//   DataDictionary        → the linked dictionary edge
//   GraphicalInterface    → a model reference, named WITHOUT an extension, which is
//                           what forces the parent-extension rule (it must resolve
//                           to plant.mdl, not plant.slx)
//   WSDataSource MAT-File → an external data source edge
//   System/Block          → a block parameter usage (Gain "Kp")
//
// NOT covered here: the model workspace, which a classic `.mdl` stores as a
// UUENCODED mxarray in a MatData record. That needs real MATLAB output to be
// meaningful and is covered by the parity suite in the core repo, not by a
// hand-written fixture.
const classicMdl = `Model {
  Name                    "legacy_ctrl"
  Version                 7.8
  Creator                 "fixture"
  LastModifiedDate        "Fri Sep 04 10:15:32 2026"
  DataDictionary          "params.sldd"
  WSDataSource            "MAT-File"
  WSSourceFileName        "signals.mat"
  GraphicalInterface {
    NumModelReferences      1
    ModelReference {
      ModelRefBlockPath       "legacy_ctrl/Plant|plant"
    }
  }
  System {
    Name                    "legacy_ctrl"
    Block {
      BlockType               Gain
      Name                    "Gain1"
      Gain                    "Kp"
    }
    Block {
      BlockType               Constant
      Name                    "Setpoint"
      Value                   "Uo"
    }
  }
}
`;
writeFileSync(here('legacy_ctrl.mdl'), strToU8(classicMdl));

// --- params.sldd + shared_gain.slx: the two-model usage set -------------------
//
// legacy_ctrl.mdl above already links `params.sldd` and uses `Kp`/`Uo`; these two
// fixtures complete that set so the WHOLE Usage path — real bytes → parse →
// summarise → resolve → edges → annotated row → rendered cell — can be driven in
// the vitest suite (test/usageEndToEnd.test.ts) instead of from hand-written
// summaries. What that needs, and nothing more:
//
//   params.sldd     the dictionary the models link, holding Kp, Uo and an UNUSED
//                   Ki (so "no answer" is covered by a real entry, not a fake one)
//   shared_gain.slx a SECOND model using the same Kp, so the cell has to name two
//                   models — the case a bare block name cannot express, and the one
//                   that regressed
//
// shared_gain.slx links the dictionary as `Params.SLDD`: a model records a link as
// the user typed it, so the case-insensitive match belongs in the real-file path
// too, not only in the integration suite.

// The __MW_TEXT_PARTS__ shape both .sldd formats deserialize to (see
// usageResolve.slddSummary). Same helper as make-caserefs.mjs.
const jsonSldd = (entries, refs = []) =>
  JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: entries.map((name, i) => ({
              name,
              metadata: { uuid: `fixture-uuid-${name}`, isderived: '0' },
              value: i + 1,
            })),
            'Dictionary References': refs,
            AllowAccessBWS: '0',
          },
        },
      },
    },
    null,
    '\t',
  );
writeFileSync(here('params.sldd'), jsonSldd(['Kp', 'Uo', 'Ki']));

// `Gain`/`Value` are absent from SlxParser's NON_PARAM_PROPS and both values are
// expressions rather than literals, so extractBlockParamUsages records both. `2*Kp`
// is deliberately an expression: identifiersIn has to reduce it to `Kp`.
writeFileSync(
  here('shared_gain.slx'),
  zipSync({
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'Params.SLDD',
          ModelUUID: 'uuid-shared-gain',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="PlantGain" SID="1"><P Name="Gain">Kp</P></Block>` +
        `<Block BlockType="Constant" Name="Trim" SID="2"><P Name="Value">2*Kp</P></Block>` +
        `</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  }),
);

// --- shadow_ws.slx: a model workspace variable that SHADOWS a dictionary entry ---
//
// The third model of the usage set, and the one that pins shadowing over real bytes:
// it links `params.sldd` like the other two, but its own model workspace ALSO defines
// `Kp`. MATLAB resolves a name once — workspace first — so `WsGain` reads the
// workspace's `Kp` and the dictionary's `Kp` is not used by it at all.
//
// `DictOnly` is the control, and the reason this fixture has two blocks: it reads `Uo`,
// which only the dictionary defines, so the dictionary is provably linked and reachable
// from this model. Without it, an empty cell for `Kp` would be equally well explained by
// a dictionary link that failed to resolve — which is the bug NEXT DOOR to the one under
// test, and would pass a one-block fixture.
//
// The workspace is written as the pre-R2019b `simulink/modelworkspace.mat` part (a whole
// Level-5 MAT-file, which SlxParser routes to parseMat) rather than the newer
// `simulink/modelWorkspace.mxarray`, because a MAT-file is what the writer above already
// emits. Which part carries it is SlxParser's concern, and both arrive as
// `ParsedSlx.workspace`.
writeFileSync(
  here('shadow_ws.slx'),
  zipSync({
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'params.sldd',
          ModelUUID: 'uuid-shadow-ws',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<System>` +
        `<Block BlockType="Gain" Name="WsGain" SID="1"><P Name="Gain">Kp</P></Block>` +
        `<Block BlockType="Constant" Name="DictOnly" SID="2"><P Name="Value">Uo</P></Block>` +
        `</System>`,
    ),
    'simulink/modelworkspace.mat': matFile('MATLAB 5.0 MAT-file, hand-built model workspace', [
      matrixElement('Kp', [1, 1], [7]),
    ]),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  }),
);

console.log(
  'wrote model_with_refs.slx, model_with_refs.mdl, legacy_ctrl.mdl, compressed.sldd, ' +
    'object_array_binary.sldd, nd_numeric.mat, params.sldd, shared_gain.slx, shadow_ws.slx',
);
