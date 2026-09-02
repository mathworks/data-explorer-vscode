// Copyright 2026 The MathWorks, Inc.
// Generates the caserefs/ fixture set used by the caseRefUsage integration test.
// Run: node test-integration/fixtures/make-caserefs.mjs
//
// Every reference in these fixtures differs IN CASE from the filename it points
// at, which is what MATLAB actually produces: a model records a data-source link
// as the user typed it, while the file on disk has whatever case the filesystem
// holds. The usage graph therefore has to match refs to files case-insensitively
// (refBasename), exactly as the sections tree already does (RelGraph.byBasename).
//
// The files live in test-integration/fixtures/caserefs — deliberately OUTSIDE the
// integration workspace folder (test-integration/fixtures/workspace) — for two
// reasons: workspace.findFiles must not return them (so the test controls exactly
// which files are in the graph, via open tabs), and adding files to the workspace
// would change the tree/index assertions in sectionsTree.test.ts and
// nameIndex.test.ts.
//
// Each leg below is a DIFFERENT line of code in usageGraph.buildGraph, so the four
// blocks are not redundant:
//
//   block     ref recorded in the model   file on disk      the leg it covers
//   -------   -------------------------   ---------------   ------------------------
//   Gain1     caseparams.sldd (DataDict)  CaseParams.sldd   slddByBase key + dataDictionary
//   Gain2     Chained.SLDD (dict ref)     chained.sldd      slddSummary's dictRefs
//   Gain3     EXTRADICT.SLDD (external)   ExtraDict.sldd    the /\.sldd$/i external filter
//   Const1    CaseBp.MAT (external)       CaseBp.mat        matByBase key + /\.mat$/i filter
//
// Note the last two also pin the case-INSENSITIVE extension filters: a
// `.endsWith('.sldd')`/`.endsWith('.mat')` test drops an upper-cased extension
// entirely, classifying a real link as neither a dictionary nor a MAT file.
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const out = (name) => here(`caserefs/${name}`);

mkdirSync(here('caserefs'), { recursive: true });

// --- The dictionaries -------------------------------------------------------

// A minimal JSON .sldd in the __MW_TEXT_PARTS__ shape both .sldd formats share
// (see usageGraph.slddSummary). `refs` becomes the "Dictionary References" footer.
function sldd(entries, refs = []) {
  return JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: entries.map((name, i) => ({
              name,
              metadata: { uuid: `caseref-uuid-${name}`, isderived: '0' },
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
}

// Stem case differs from the model's `caseparams.sldd` DataDictionary link, and
// its own reference to chained.sldd is upper-cased in BOTH stem and extension.
writeFileSync(out('CaseParams.sldd'), sldd(['CaseVar'], ['Chained.SLDD']));
writeFileSync(out('chained.sldd'), sldd(['ChainedVar']));
// Stem case differs from the model's `EXTRADICT.SLDD` external link.
writeFileSync(out('ExtraDict.sldd'), sldd(['ExtraVar']));

// --- The MAT file -----------------------------------------------------------

// Reuse a real MAT blob rather than hand-authoring one; Bp.mat defines the single
// variable `Bp`. Only the FILENAME case matters here, and the model links to it as
// `CaseBp.MAT`.
copyFileSync(here('../../test/fixtures/mcos/Bp.mat'), out('CaseBp.mat'));

// --- The model --------------------------------------------------------------

// One block per resolution leg. `Gain`/`Value` are absent from SlxParser's
// NON_PARAM_PROPS and the values are non-numeric identifiers, so
// extractBlockParamUsages records all four.
const systemRoot =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<System>` +
  `<Block BlockType="Gain" Name="Gain1" SID="1"><P Name="Gain">CaseVar</P></Block>` +
  `<Block BlockType="Gain" Name="Gain2" SID="2"><P Name="Gain">ChainedVar</P></Block>` +
  `<Block BlockType="Gain" Name="Gain3" SID="3"><P Name="Gain">ExtraVar</P></Block>` +
  `<Block BlockType="Constant" Name="Const1" SID="4"><P Name="Value">Bp</P></Block>` +
  `</System>`;

// No modelWorkspace.mxarray: the model owns no workspace variables, so nothing
// can shadow a dictionary/MAT hit and every block must resolve through a ref.
const parts = {
  'simulink/blockDiagram.json': strToU8(
    JSON.stringify({
      BlockDiagram: {
        DataDictionary: 'caseparams.sldd',
        ModelUUID: 'uuid-caserefs',
        System: { Ref: 'system_root' },
      },
    }),
  ),
  'simulink/systems/system_root.xml': strToU8(systemRoot),
  'simulink/ExternalDataSourceSettings.xml': strToU8(
    `<?xml version="1.0"?><ExternalDataSourceSettings>` +
      `<ExplicitExternalBrokerSources><fullPathToSource>EXTRADICT.SLDD</fullPathToSource></ExplicitExternalBrokerSources>` +
      `<ExplicitExternalBrokerSources><fullPathToSource>CaseBp.MAT</fullPathToSource></ExplicitExternalBrokerSources>` +
      `</ExternalDataSourceSettings>`,
  ),
  'metadata/coreProperties.xml': strToU8(
    `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
  ),
};

writeFileSync(out('caseRefs.slx'), zipSync(parts));

// Sanity-check the .slx round-trips (a silently malformed zip would surface as an
// empty Usage column in the test, which reads like a regression in the fix).
const back = unzipSync(new Uint8Array(readFileSync(out('caseRefs.slx'))));
for (const key of Object.keys(parts)) {
  if (!back[key]) throw new Error(`caseRefs.slx lost ${key}`);
}

console.log('wrote caserefs/{caseRefs.slx,CaseParams.sldd,chained.sldd,ExtraDict.sldd,CaseBp.mat}');
