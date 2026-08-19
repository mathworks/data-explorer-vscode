// Copyright 2026 The MathWorks, Inc.
// Generates selfContained.slx — a single, self-sufficient model used by the
// singleFileUsage integration test. Run: node test-integration/fixtures/make-standalone.mjs
//
// The model carries its OWN model-workspace variables (no linked .sldd/.mat) and
// blocks whose parameters reference them, so its Usage graph is fully resolvable
// from the one file alone. It is written to test-integration/fixtures/standalone/
// — deliberately OUTSIDE the integration workspace folder
// (test-integration/fixtures/workspace) — so vscode.workspace.findFiles never
// returns it; only opening it in a tab feeds it into the usage graph. That is the
// exact path the single-file (Cmd+O, no folder) fix adds.
//
// The model-workspace variables live in a binary simulink/modelWorkspace.mxarray
// (a MATLAB array blob) that we can't hand-author, so we reuse the known-good one
// from the mcos fixture. Per SlxParser, it yields the workspace names:
//   Alias, Bp, Lut, Numeric, Param, ParamMat, Sig
// The blocks below reference `Bp` (Gain) and `Numeric` (Constant Value).
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

// Borrow the real binary model-workspace blob (defines Bp, Numeric, ...).
const mcos = unzipSync(new Uint8Array(readFileSync(here('../../test/fixtures/mcos/mcosfix.slx'))));
const modelWorkspace = mcos['simulink/modelWorkspace.mxarray'];
if (!modelWorkspace) throw new Error('mcosfix.slx has no modelWorkspace.mxarray');

// A Gain block using workspace var `Bp` and a Constant using `Numeric`. Both
// param props are in SlxParser.PARAM_PROPS and the values are non-numeric, so
// extractBlockParamUsages records them.
const systemRoot =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<System>` +
  `<P Name="ReportName">simulink-default.rpt</P>` +
  `<Block BlockType="Gain" Name="Gain1" SID="1"><P Name="Gain">Bp</P></Block>` +
  `<Block BlockType="Constant" Name="Const1" SID="2"><P Name="Value">Numeric</P></Block>` +
  `</System>`;

const parts = {
  // No DataDictionary / ModelWorkspace WSSourceFileName: the workspace is the
  // in-model .mxarray, so this model links to nothing external.
  'simulink/blockDiagram.json': strToU8(
    JSON.stringify({ BlockDiagram: { ModelUUID: 'uuid-standalone', System: { Ref: 'system_root' } } }),
  ),
  'simulink/systems/system_root.xml': strToU8(systemRoot),
  'simulink/modelWorkspace.mxarray': modelWorkspace,
  'metadata/coreProperties.xml': strToU8(
    `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
  ),
};

mkdirSync(here('standalone'), { recursive: true });
writeFileSync(here('standalone/selfContained.slx'), zipSync(parts));
console.log('wrote standalone/selfContained.slx');
