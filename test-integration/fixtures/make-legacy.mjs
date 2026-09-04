// Copyright 2026 The MathWorks, Inc.
// Generates the legacy/ fixture set used by the mdlFormat integration test.
// Run: node test-integration/fixtures/make-legacy.mjs
//
// A Simulink model reaches this extension in THREE on-disk forms, and only one of
// them is a `.slx`:
//
//   .slx           a ZIP OPC package
//   .mdl MODERN    the SAME part set written as TEXT, with __MWOPC_PART_BEGIN__
//                  delimiter lines and binary parts base64'd (what save_system
//                  writes today when you ask for a .mdl)
//   .mdl CLASSIC   the pre-R2012 nested-brace text format, `Model { Name "x" ... }`
//                  (what `save_system(..., 'ExportToVersion', 'R2011b')` writes)
//
// Both `.mdl` flavours are written here, linked to ONE shared dictionary and using
// the SAME variable names, so the test can assert that all the parameter links
// resolve identically no matter which framing the bytes use. That is the point: the
// extension must not have three code paths, and the format must be decided by the
// bytes (core's parseModel sniffs the ZIP magic), never by the extension.
//
// The files live in test-integration/fixtures/legacy — deliberately OUTSIDE the
// integration workspace folder (test-integration/fixtures/workspace) — for the same
// two reasons as caserefs/: workspace.findFiles must not return them, so the test
// controls exactly which files are in the graph via open tabs; and adding files to
// the workspace would break the exact-file-set assertions in sectionsTree.test.ts
// and nameIndex.test.ts.
//
// NOT covered here: a classic model's own model workspace, which the format stores
// as a UUENCODED mxarray in a MatData record. That needs real MATLAB output to be
// meaningful, so both models below own no workspace variables and resolve every
// parameter through the linked dictionary — which also means nothing can shadow a
// dictionary hit and a passing test cannot be a false positive from a workspace var.
import { strToU8 } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const out = (name) => here(`legacy/${name}`);

mkdirSync(here('legacy'), { recursive: true });

// --- The shared dictionary ---------------------------------------------------

// A minimal JSON .sldd in the __MW_TEXT_PARTS__ shape both .sldd formats share
// (see usageGraph.slddSummary). Same helper as make-caserefs.mjs.
function sldd(entries) {
  return JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: entries.map((name, i) => ({
              name,
              metadata: { uuid: `legacy-uuid-${name}`, isderived: '0' },
              value: i + 1,
            })),
            'Dictionary References': [],
            AllowAccessBWS: '0',
          },
        },
      },
    },
    null,
    '\t',
  );
}

// Kp is used by BOTH models (so one variable's reverse edges must list two blocks
// in two different .mdl framings); Uo is used only by the classic one.
writeFileSync(out('legacyParams.sldd'), sldd(['Kp', 'Uo']));

// --- The CLASSIC .mdl -------------------------------------------------------

// Properties are `Name value` lines; children are `Name { ... }` blocks. The `#`
// banner a real file starts with is skipped by the parser, so it is included.
//
// `Gain` and `Value` are real parameter properties (absent from the parser's block
// identity props) and their values are non-numeric identifiers, so both are
// recorded as parameter usages.
const classic = `# Classic MDL fixture, hand-authored
Model {
  Name                    "legacyClassic"
  Version                 7.8
  Creator                 "fixture"
  LastModifiedDate        "Fri Sep 04 10:15:32 2026"
  DataDictionary          "legacyParams.sldd"
  GraphicalInterface {
    NumModelReferences      1
    ModelReference {
      ModelRefBlockPath       "legacyClassic/Plant|plant"
    }
  }
  System {
    Name                    "legacyClassic"
    Block {
      BlockType               Gain
      Name                    "ClassicGain"
      Gain                    "Kp"
    }
    Block {
      BlockType               Constant
      Name                    "ClassicConst"
      Value                   "Uo"
    }
  }
}
`;
writeFileSync(out('legacyClassic.mdl'), strToU8(classic));

// --- The MODERN .mdl --------------------------------------------------------

// The same parts a .slx zips, framed as text. metadata/coreProperties.xml is
// written BASE64 to cover the encoded-part path (in a real file that is how the
// binary .mxarray parts survive a text container); if the decode were wrong the
// release would come back empty rather than raising anything.
const modernParts = {
  'simulink/blockDiagram.json': strToU8(
    JSON.stringify({
      BlockDiagram: {
        DataDictionary: 'legacyParams.sldd',
        ModelUUID: 'uuid-legacy-modern',
        System: { Ref: 'system_root' },
      },
    }),
  ),
  'simulink/systems/system_root.xml': strToU8(
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<System>` +
      `<Block BlockType="Gain" Name="ModernGain" SID="1"><P Name="Gain">Kp</P></Block>` +
      `</System>`,
  ),
  'metadata/coreProperties.xml': strToU8(
    `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
  ),
};
const BASE64_PARTS = new Set(['metadata/coreProperties.xml']);

function opcTextPackage(parts, modelName) {
  const enc = new TextEncoder();
  const chunks = [
    // A banner and a small legacy Model stub precede the package marker, so a tool
    // expecting the classic format finds something readable rather than binary
    // noise. The parser skips both and starts at __MWOPC_PACKAGE_BEGIN__.
    enc.encode(
      `# MathWorks OPC Text Package\nModel {\n  Name                    "${modelName}"\n  Version                 25.0\n}\n__MWOPC_PACKAGE_BEGIN__\n`,
    ),
  ];
  for (const path of Object.keys(parts)) {
    const b64 = BASE64_PARTS.has(path);
    // The header names the part with a LEADING slash and flags an encoded one with
    // a trailing ` BASE64`.
    chunks.push(enc.encode(`__MWOPC_PART_BEGIN__ /${path}${b64 ? ' BASE64' : ''}\n`));
    chunks.push(b64 ? enc.encode(Buffer.from(parts[path]).toString('base64')) : parts[path]);
    // Exactly ONE newline after the content: it introduces the next marker and
    // belongs to the framing, not to the part. A second would be read as the part's
    // own trailing byte and corrupt the JSON parts.
    chunks.push(enc.encode('\n'));
  }
  chunks.push(enc.encode('__MWOPC_PACKAGE_END__\n'));
  const outBytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    outBytes.set(c, at);
    at += c.length;
  }
  return outBytes;
}
writeFileSync(out('legacyModern.mdl'), opcTextPackage(modernParts, 'legacyModern'));

console.log('wrote legacy/{legacyClassic.mdl,legacyModern.mdl,legacyParams.sldd}');
