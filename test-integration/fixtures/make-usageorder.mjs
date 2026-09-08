// Copyright 2026 The MathWorks, Inc.
// Generates the usageorder/ fixture set used by the usageOrder integration test.
// Run: node test-integration/fixtures/make-usageorder.mjs
//
// The set exists to make TAB HISTORY observable. Two engines can fill the Usage
// column: core's `_usedByCell`, which answers from the DataModel session (the models
// whose editor was resolved in this window) and names the block without its model;
// and the workspace usage graph, which answers from the files and names
// `block(model)`. While a session-filled cell was honoured, what a dictionary said
// about its own entries depended on which models the user happened to have opened.
//
// So: ONE dictionary entry used by blocks in TWO models.
//
//   sharedParams.sldd   SharedGain (used three times), UnusedVar (used nowhere)
//   ctrlA.slx           GainA  Gain  = SharedGain
//                       LimitA Value = SharedGain
//   plantB.slx          GainB  Gain  = SharedGain
//
// The test registers ONLY ctrlA in the session, which is the exact state the bug
// needed: three usages in two models, of which the session can account for two, in
// one model, unnamed. UnusedVar is the control — an entry neither engine can say
// anything about, which must be left alone rather than emptied.
//
// The files live OUTSIDE the integration workspace folder
// (test-integration/fixtures/workspace) for the same two reasons as caserefs/:
// findFiles must not return them, so the test controls exactly which files are in
// the graph via open tabs; and adding files to the workspace would change the
// tree/index assertions in sectionsTree.test.ts and nameIndex.test.ts.
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const out = (name) => here(`usageorder/${name}`);

mkdirSync(here('usageorder'), { recursive: true });

// --- The dictionary ---------------------------------------------------------

// The __MW_TEXT_PARTS__ shape both .sldd formats deserialize to (see
// usageResolve.slddSummary). Written as JSON text, which is what MATLAB's default
// dictionary format is and what the editable table view opens.
const sldd = (entries) =>
  JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: entries.map((name, i) => ({
              name,
              metadata: { uuid: `usageorder-uuid-${name}`, isderived: '0' },
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

writeFileSync(out('sharedParams.sldd'), sldd(['SharedGain', 'UnusedVar']));

// --- The two models ---------------------------------------------------------

// `Gain`/`Value` are absent from SlxParser's NON_PARAM_PROPS and the values are
// identifiers rather than literals, so extractBlockParamUsages records each one.
// No modelWorkspace.mxarray: neither model owns workspace variables, so nothing can
// shadow the dictionary and every block must resolve through the link.
function model(uuid, blocks) {
  const parts = {
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          DataDictionary: 'sharedParams.sldd',
          ModelUUID: uuid,
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>` +
        blocks
          .map(
            ({ type, name, prop, value }, i) =>
              `<Block BlockType="${type}" Name="${name}" SID="${i + 1}">` +
              `<P Name="${prop}">${value}</P></Block>`,
          )
          .join('') +
        `</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
    ),
  };
  return { parts, bytes: zipSync(parts) };
}

const ctrlA = model('uuid-usageorder-ctrlA', [
  { type: 'Gain', name: 'GainA', prop: 'Gain', value: 'SharedGain' },
  { type: 'Constant', name: 'LimitA', prop: 'Value', value: 'SharedGain' },
]);
const plantB = model('uuid-usageorder-plantB', [
  { type: 'Gain', name: 'GainB', prop: 'Gain', value: 'SharedGain' },
]);

writeFileSync(out('ctrlA.slx'), ctrlA.bytes);
writeFileSync(out('plantB.slx'), plantB.bytes);

// Sanity-check both .slx round-trip. A silently malformed zip surfaces in the test
// as an empty Usage column, which reads like a regression in the fix rather than a
// broken fixture.
for (const [name, built] of [
  ['ctrlA.slx', ctrlA],
  ['plantB.slx', plantB],
]) {
  const back = unzipSync(new Uint8Array(readFileSync(out(name))));
  for (const key of Object.keys(built.parts)) {
    if (!back[key]) throw new Error(`${name} lost ${key}`);
  }
}

console.log('wrote usageorder/{sharedParams.sldd,ctrlA.slx,plantB.slx}');
