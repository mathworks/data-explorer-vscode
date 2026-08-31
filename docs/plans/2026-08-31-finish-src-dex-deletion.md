# Finish src/dex Deletion — Relocate Data-Model Tests to Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the test-only `src/dex/{core,datamodel}` tree from `data-explorer-vscode` by relocating every pure data-model test to `data-explorer-core`, so the vscode repo holds only genuine host-integration tests that import from the `data-explorer-core` package barrel.

**Architecture:** The shipping extension imports **only** core's public barrel (`data-explorer-core`). The governing invariant, verified empirically (2026-08-31): *any symbol a test needs that is not on the barrel — node classes (`ConstantNode`, `ParameterNode`, `DataNode`, …), `NodeRegistry`, `getSchemaClasses`, `parsedIsScalarNumeric`, serializer internals like `serializeBinarySldd`/`buildDataChunkXml` — is a data-model internal used **zero** times by shipping `src/`.* A test needing such a symbol is a data-model test and belongs in **core**, where importing `../src/...` deep paths is normal and internal. We therefore do NOT expand core's public barrel. Mixed test files (some pure blocks + some host-path blocks sharing one import list) are split: pure blocks migrate to core, host-path blocks stay in vscode and use the existing `constructor.name` proxy for any type-identity check.

**Tech Stack:** TypeScript, vitest, two git repos (`~/projects/data-explorer-core` pinned into vscode as `github:mathworks/data-explorer-core#v0.1.2`), esbuild bundling for the vscode `.vsix`.

**Baselines (verified 2026-08-31, must not regress):**
- vscode: 112 test files / 1261 tests green.
- core: 31 test files / 281 tests green.

**Cross-cutting rules (apply to EVERY commit in this plan):**
- No `Co-Authored-By: Claude` trailer on any commit, in **either** repo.
- vscode `CLAUDE.md` is gitignored — never stage/commit it.
- Before any commit in either repo, run the leak grep (the internal-token list
  from CLAUDE.md); it must return nothing.
- Core also has `npm run check:leak`; run it before core commits.
- Work on `main` in both repos (solo workflow, per release-workflow-model).

---

## Verified Test Inventory (54 dex-importing files in vscode)

**Category 1 — 27 pure tests already duplicated in core (body-identical, only import paths differ; confirmed 26 exact + `binarySlddParts` differs only in one import path).** Action: delete from vscode, keep core's.
```
archPresentation binarySlddParts blockParamUsages configSetUnified dataTaxonomy
mcosCrossFormat mcosParser mcosTypedNode minMaxConstraint parser piOther
piOtherBusElement piOtherGroup projectParser serviceBusAddChild valuePropColumns
schema/hydrate schema/kindClassAtoms schema/piGeneralAllNodes schema/piLayoutParity
schema/schemaBridge schema/schemaColumns schema/schemaData schema/schemaResolve
schema/sourcePath schema/writeSourcePath parity/fidelity/hostnodes.fidelity
```

**Category 2 — 4 pure tests NOT yet in core.** Action: move to core, repoint imports `../src/dex/` → `../src/` (and `../../src/dex/` → `../../src/`).
```
parity/fidelity/element.fidelity  parity/fidelity/structural.fidelity
parity/fidelity/variable.fidelity  schema/packageBoundary
```

**Category 3 — 23 host-integration files.** Some are pure-in-disguise, most are mixed. Handled per-file in Phase B. Host-use / internal-class-use counts (value uses, excluding imports):
```
FILE                       its host  cls   disposition
binaryDirtyLifecycle        2   10    0    stays; repoint to barrel
binarySlddRoundTrip         3    7    0    stays; repoint to barrel
binarySlddSerializer        3    6    0    stays; barrel + move serializer-internal block to core
dimensionsMode              5    3    0    stays; drop NodeClassMap import (barrel side-effects it)
elementProps               10    2    0    stays; drop NodeClassMap import
slddRoundTrip              11   15    0    stays; barrel + move serializer-internal block to core
xmlDropEndToEnd             3    1    0    stays; repoint to barrel
xmlStructuralEdit           4    5    0    stays; repoint to barrel
parity/dump                 1    2    0    stays; drop NodeClassMap import
parity/headerfile           4    3    0    stays; drop NodeClassMap import
parity/parity              24    6    0    stays; repoint to barrel
schema/schemaColumnLabels   4    0    0    PURE → move to core
archToDesignPaste          14   28    3    stays; NS_DESIGN via barrel? (see Task) 
matRowBuilder               9   12    5    split: MatNode pure block → core; host block stays
objectExpansion            47   20    6    split: MatNode/parseMat pure blocks → core; host stays
parity/project-parity      12    3    3    split: ProjectNode.fromParsed block → core; host stays
projectNode                 5    3    6    split: ProjectNode.fromParsed → core; host stays
codegenEdit                 8    2    9    split: trySetSchemaProperty block → core; host stays
objectArrayExpansion        8    4    9    split: NodeClassMap.parseValue block → core; host stays
metadataColumns            13    3   12    split: DataNode normalization/stamp blocks → core; host stays
schema/piWiring             6    2    7    split: createDefault PI block → core; host block stays
schema/schemaColumnGroups   4    0    2    split: getSchemaClasses block → core; COLUMN_GROUPS block → check
constantNode               27   17   37    split: 4 pure describes → core; host describes stay
```

**Barrel symbols already available** (safe for the "stays" files to import from `data-explorer-core`): `DataModel`, `parseBinarySldd`, `parseBinarySlddParts`, `serializeEntryToXml`, `parseSlx`, `parseMat`, `parseProject`, `ModelBlockNode`, `SlddNode`, `generateUuid`, `schemaColumnLabels`, `kindForClass`, `getSectionMetadata`. Importing ANY barrel value triggers `NodeClassMap` registration as a side effect — so a bare `import '../src/dex/.../NodeClassMap.js'` line is redundant once any barrel import is present and must be removed.

**Off-barrel symbols (NEVER added to barrel; only reachable inside core):** node classes (`ConstantNode`, `MatlabVariableNode`, `BusNode`, `ParameterNode`, `SignalNode`, `DataNode`, `MatNode`, `ProjectNode`), `NodeRegistry`, `MatlabValueParser`, `parsedIsScalarNumeric`, `getSchemaClasses`, `resolveSourcePath`, `serializeBinarySldd`, `buildDataChunkXml`, `NS_DESIGN` (`SectionConstants`).

**Decision needed during execution — `NS_DESIGN` and `serializeEntryToXml`+friends:** `NS_DESIGN` is used by `archToDesignPaste` (host) and `constantNode`. `serializeBinarySldd`/`buildDataChunkXml` are used by `binarySlddSerializer`/`slddRoundTrip` (host round-trip assertions). These are the only cases where a genuine *host* test references an off-barrel symbol. Per-task resolution: move those specific assertions into core if they are data-model round-trips, OR (only if the assertion genuinely needs the host model AND the symbol) keep the block in vscode and have it read the value indirectly. Prefer moving to core. Do NOT expand the barrel.

---

## Phase A — Core repo: absorb all pure data-model tests

Work in `~/projects/data-explorer-core`. Each task ends green on `npm test`.

### Task A1: Delete the 27 vscode duplicates (core already has them)

**Files:**
- Delete in vscode: the 27 Category-1 files under `test/`.
- Core: no change (copies already present and green).

- [ ] **Step 1: Re-verify body equivalence for all 27** (guard against silent drift)

Run from `~/projects`:
```bash
bash -c '
DUPES=(archPresentation binarySlddParts blockParamUsages configSetUnified dataTaxonomy mcosCrossFormat mcosParser mcosTypedNode minMaxConstraint parser piOther piOtherBusElement piOtherGroup projectParser serviceBusAddChild valuePropColumns schema/hydrate schema/kindClassAtoms schema/piGeneralAllNodes schema/piLayoutParity schema/schemaBridge schema/schemaColumns schema/schemaData schema/schemaResolve schema/sourcePath schema/writeSourcePath parity/fidelity/hostnodes.fidelity)
bad=""
for t in "${DUPES[@]}"; do
  v="data-explorer-vscode/test/${t}.test.ts"; c="data-explorer-core/test/${t}.test.ts"
  diff <(grep -vE "^import" "$v") <(grep -vE "^import" "$c") >/dev/null 2>&1 || bad="$bad $t"
done
echo "non-identical-bodies:$bad"'
```
Expected: `non-identical-bodies:` followed by only ` binarySlddParts` (its sole diff is one import path — acceptable). If anything else appears, STOP and inspect that file before deleting.

- [ ] **Step 2: Delete the 27 duplicate files from vscode**

```bash
cd ~/projects/data-explorer-vscode
git rm test/archPresentation.test.ts test/binarySlddParts.test.ts test/blockParamUsages.test.ts \
  test/configSetUnified.test.ts test/dataTaxonomy.test.ts test/mcosCrossFormat.test.ts \
  test/mcosParser.test.ts test/mcosTypedNode.test.ts test/minMaxConstraint.test.ts \
  test/parser.test.ts test/piOther.test.ts test/piOtherBusElement.test.ts \
  test/piOtherGroup.test.ts test/projectParser.test.ts test/serviceBusAddChild.test.ts \
  test/valuePropColumns.test.ts test/schema/hydrate.test.ts test/schema/kindClassAtoms.test.ts \
  test/schema/piGeneralAllNodes.test.ts test/schema/piLayoutParity.test.ts \
  test/schema/schemaBridge.test.ts test/schema/schemaColumns.test.ts test/schema/schemaData.test.ts \
  test/schema/schemaResolve.test.ts test/schema/sourcePath.test.ts test/schema/writeSourcePath.test.ts \
  test/parity/fidelity/hostnodes.fidelity.test.ts
```

- [ ] **Step 3: Run vscode unit suite**

Run: `cd ~/projects/data-explorer-vscode && npm test 2>&1 | tail -6`
Expected: still green. File count drops 112 → 85. Test count drops by the sum of the 27 files' tests. If any REMAINING vscode file imported a now-deleted file, fix its import (none expected — these are leaf tests).

- [ ] **Step 4: Commit (vscode)** — deferred to Phase C batch commit. (Do NOT commit mid-plan; keep vscode changes staged until Phase B is done so the suite is coherent.)

### Task A2: Move the 4 Category-2 tests into core

**CORRECTION (verified during execution 2026-08-31):** The 3 fidelity tests are NOT pure — they import `./roundTripHarness.ts`, which is host-coupled (`src/host/SlddModel`, `src/host/rowBuilder`) and uses off-barrel `serializeBinarySldd`. But the coupling is shallow: `loadModel`/`reparseEntry` are just `parse → DataModel.addDataSource/addModelSource → tree-walk`, and `entryByName` can use core `BaseNode.flatten()`+`.name` instead of the presentation `buildRows`. The tests genuinely need data-model internals (`MatlabVariableNode.parse`, `ConstantNode.fromVariable`, `ServiceBusNode.createDefault`) with no host equivalent → they ARE data-model tests. Fix: port the harness into core as a **core-internal** module (imports `../../../src/core/DataModel.js`, `../../../src/datamodel/parser/BinarySlddParser.js`, `../../../src/datamodel/parser/BinarySlddSerializer.js`, NodeClassMap; NO `src/host`, NO `buildRows`), then move all 3 fidelity tests + `verify_roundtrip.m` + the `text/params.sldd` artifact (core already has `binary/params.sldd`) to core. `schema/packageBoundary` is genuinely pure but must be rewritten to scan core's `src/datamodel/schema` (see A2b).

**Files (move vscode → core, repoint imports):**
- `parity/fidelity/element.fidelity.test.ts`
- `parity/fidelity/structural.fidelity.test.ts`
- `parity/fidelity/variable.fidelity.test.ts`
- `parity/fidelity/roundTripHarness.ts` (ported, core-internal)
- `parity/fidelity/verify_roundtrip.m`
- `test/parity/artifacts/text/params.sldd` (copy; core has binary already)
- `schema/packageBoundary.test.ts` (rewrite SCHEMA_DIR to core's src)

- [ ] **Step 1: Inspect each file's imports + fixture dependencies**

Run: `cd ~/projects/data-explorer-vscode && for f in parity/fidelity/element.fidelity parity/fidelity/structural.fidelity parity/fidelity/variable.fidelity schema/packageBoundary; do echo "== $f =="; grep -nE "from ['\"]|import ['\"]|readFileSync|URL\(" "test/$f.test.ts"; done`
Expected: shows `../src/dex/...` (or `../../src/dex/...`) imports plus any fixture/artifact path references and any import of the shared harness `test/parity/fidelity/roundTripHarness.ts`.

- [ ] **Step 2: Check whether core already has the fixtures/harness these tests need**

Run: `ls ~/projects/data-explorer-core/test/parity/fidelity/ 2>/dev/null; ls ~/projects/data-explorer-core/test/parity/artifacts/ 2>/dev/null | head`
Expected: core already has `parity/fidelity/hostnodes.fidelity.test.ts`, so `roundTripHarness.ts` and the `parity/artifacts/` fixtures are ALREADY present in core (hostnodes depends on them). Confirm `roundTripHarness.ts` exists in core; if not, copy it too. If any artifact fixture referenced by these 3 fidelity tests is missing in core, copy it under the same relative path.

- [ ] **Step 3: Copy the 4 files into core and repoint imports**

```bash
cd ~/projects
cp data-explorer-vscode/test/parity/fidelity/element.fidelity.test.ts   data-explorer-core/test/parity/fidelity/
cp data-explorer-vscode/test/parity/fidelity/structural.fidelity.test.ts data-explorer-core/test/parity/fidelity/
cp data-explorer-vscode/test/parity/fidelity/variable.fidelity.test.ts  data-explorer-core/test/parity/fidelity/
cp data-explorer-vscode/test/schema/packageBoundary.test.ts             data-explorer-core/test/schema/
# repoint dex deep paths to core's src (…/src/dex/… -> …/src/…)
cd data-explorer-core
perl -pi -e 's#(\.\./)+src/dex/#"../" x ($1 =~ tr|/||) . "src/"#ge unless 1;' /dev/null  # placeholder; use explicit sed below
```
Then repoint with explicit, verifiable substitutions per file (the perl above is illustrative only — DO NOT run it). For each copied file run:
```bash
sed -i '' -E 's#\.\./\.\./src/dex/#../../src/#g; s#\.\./src/dex/#../src/#g' \
  test/parity/fidelity/element.fidelity.test.ts \
  test/parity/fidelity/structural.fidelity.test.ts \
  test/parity/fidelity/variable.fidelity.test.ts \
  test/schema/packageBoundary.test.ts
```
Note: fidelity files are at `test/parity/fidelity/` (depth 3 under repo root, `../../src/` reaches `src/`); `schema/packageBoundary` is at `test/schema/` (`../src/` reaches `src/`). Verify actual relative depth against how `hostnodes.fidelity.test.ts` imports core's `src/` and match it exactly.

- [ ] **Step 4: Run core suite**

Run: `cd ~/projects/data-explorer-core && npm test 2>&1 | tail -8`
Expected: green; +4 files (35 total), test count rises. If a fidelity test fails on a missing artifact, copy the artifact from vscode's `test/parity/artifacts/...` to core's matching path and re-run.

- [ ] **Step 5: Delete the 4 originals from vscode**

```bash
cd ~/projects/data-explorer-vscode
git rm test/parity/fidelity/element.fidelity.test.ts test/parity/fidelity/structural.fidelity.test.ts \
  test/parity/fidelity/variable.fidelity.test.ts test/schema/packageBoundary.test.ts
npm test 2>&1 | tail -6
```
Expected: vscode still green (fewer files).

### Task A3: Split mixed files — migrate pure blocks to core (new same-named core files)

For EACH mixed file below, the pure `describe` blocks become a NEW core test file of the same base name; host-path blocks remain in the vscode file (handled in Phase B). Because no core counterpart exists for any of these, "merge into existing core tests" reduces to: create the new core file, and if a topically-related core file already exists, prefer appending the block there and deleting the redundant new file. Check for a topical home before creating standalone.

General procedure per file (repeat Steps 1–5):

- [ ] **Step 1:** Read the vscode file; identify pure blocks (only `<Class>.createDefault`/`new <Class>`/`<Class>.<static>`/off-barrel funcs, NO `getModel`/`buildRows`/`pasteEntry`/host imports inside the block) vs host blocks.
- [ ] **Step 2:** Create `data-explorer-core/test/<name>.test.ts` (or append to a topical existing core file) containing ONLY the pure blocks + the imports they need, repointed to `../src/...` (core-internal deep paths). Include the file header copyright line.
- [ ] **Step 3:** Run `cd ~/projects/data-explorer-core && npx vitest run test/<name>.test.ts` — expected: the migrated pure blocks pass in core.
- [ ] **Step 4:** In the vscode file, delete the migrated pure blocks and any now-unused `src/dex` imports; leave host blocks.
- [ ] **Step 5:** Run `cd ~/projects/data-explorer-vscode && npx vitest run test/<name>.test.ts` — expected: remaining host blocks pass; assert the it-count equals (original its − migrated its).

Per-file specifics:

- [ ] **constantNode.test.ts** → core gets blocks `parsedIsScalarNumeric truth table` (L50), `MatlabVariableNode.isScalarNumeric` (L68), `ConstantNode identity and structure` (L89), `ConstantNode value validation on edit` (L107). These need `ConstantNode`, `MatlabVariableNode`, `MatlabValueParser`, `parsedIsScalarNumeric` — all core-internal. vscode KEEPS `SectionNode.parseEntry forks` (L144), `Design ↔ Arch Constant conversion` (L176), `Variable→Constant paste gate (host side)` (L206), `Add Constant via addEntry` (L276) — these use `getModel`/`buildRows`/`pasteEntry` and already use the `constructor.name` proxy (established earlier). Remove `ConstantNode`/`MatlabVariableNode`/`BusNode`/`MatlabValueParser`/`parsedIsScalarNumeric`/`NS_DESIGN`/`NodeClassMap` imports from the vscode file IF the remaining host blocks no longer reference them; keep only what the host blocks still use (they should reference nodes only via `constructor.name`). If a host block still needs `NS_DESIGN`, resolve per the NS_DESIGN decision note below.
- [ ] **metadataColumns.test.ts** → core gets `DataNode metadata normalization` (L16) + `Last Modified is refreshed on edit` (L62) (both `new DataNode`, pure). vscode keeps `metadata columns from real fixtures` (L146, uses `getModel`/`buildRows`). Drop `DataNode` + `NodeClassMap` imports from vscode file.
- [ ] **codegenEdit.test.ts** → core gets `trySetSchemaProperty routing via node.setProperty` (L15, uses `ParameterNode`+`resolveSourcePath`). vscode keeps the two `Code Gen edit round-trip` blocks (L63/L80, host `getModelFromBytes`). Drop `ParameterNode`/`resolveSourcePath`/`NodeClassMap` from vscode.
- [ ] **objectArrayExpansion.test.ts** → core gets `general array rule — NodeClassMap.parseValue routing` (L56, uses `NodeRegistry`). vscode keeps the two host `.sldd` blocks (L109/L149). Drop `NodeRegistry`/`NodeClassMap` from vscode.
- [ ] **projectNode.test.ts** → core gets `ProjectNode.fromParsed` (L23, uses `ProjectNode` + `ParsedProject` type). If purely `fromParsed` with no host, the WHOLE file may move to core; verify no `getModel`/host use. If fully pure, treat as a Category-2 move (whole-file) instead of a split.
- [ ] **schema/piWiring.test.ts** → core gets `Parameter/Signal PI includes hydrated schema groups` (L10, `createDefault`+`toPIObject`, pure). vscode keeps `PI hydration parity: JSON vs binary` (L65, `getModelFromBytes`). Drop `ParameterNode`/`SignalNode`/`NodeClassMap` from vscode.
- [ ] **schema/schemaColumnGroups.test.ts** → core gets `getSchemaClasses` (L5). The `rowBuilder COLUMN_GROUPS` block (L19) imports from `src/host/rowBuilder` — inspect: if it only checks a static group table it may be host-side and stay; if it derives from schema it may move. Split accordingly.
- [ ] **matRowBuilder.test.ts** → `buildMatRows` (L24) is a host block (imports `src/host/matRowBuilder`) but constructs a `MatNode` directly. Options: (a) keep in vscode and build the MatNode via the barrel/`parseMat` path instead of `new MatNode`, or (b) if the assertions are really about `buildMatRows` host output, keep the file, and obtain the MatNode input through `parseMat` (barrel) rather than the class. Prefer (b). Drop the `MatNode`/`NodeClassMap` deep imports.
- [ ] **objectExpansion.test.ts** → large (47 its). Most blocks use `getModel`/`getModelFromBytes` (host) — those stay. The `.mat` blocks construct via `parseMat` + `MatNode`. Repoint `parseMat` to barrel; for `MatNode` used only to type/construct, route through `parseMat`. If any block is pure `MatNode` construction with no host, migrate it to core. Inspect each of the 9 describes and classify before editing.
- [ ] **parity/project-parity.test.ts** → `end-to-end table (ProjectNode → buildRows)` (L100) is host (`buildRows`). The `ProjectNode`/`ParsedProject` usage: obtain the project via `parseProject` (barrel) instead of `ProjectNode` class where possible; keep the host block. Any pure `ProjectNode.fromParsed` assertions migrate to core alongside Task-A3 `projectNode`.
- [ ] **archToDesignPaste.test.ts** → all 3 describes are host (`getModel`/paste). Only `NS_DESIGN` (3 uses) is off-barrel. Resolve per NS_DESIGN note.

**NS_DESIGN / serializer-internal decision note:** `NS_DESIGN` (from `SectionConstants`), `serializeBinarySldd`, `buildDataChunkXml` are the only off-barrel symbols still wanted by genuine *host* blocks after splitting. For each occurrence:
1. If the assertion is really a data-model round-trip (serialize → parse → compare), move that specific block to core.
2. Else, replace the off-barrel value with a barrel-reachable equivalent: `NS_DESIGN` is a namespace-URI string constant — inline the literal in the test (with a comment) rather than import it, OR get it via `getSectionMetadata` (barrel) if that exposes the namespace. Verify what `getSectionMetadata` returns before choosing.
3. Do NOT add these to the barrel.

### Task A4: Move `schema/schemaColumnLabels.test.ts` (pure, host-use=0, cls-use=0)

Despite the `host=Y` heuristic flag, it imports `schemaColumnLabels` which IS on the barrel and has 0 off-barrel needs. Decide: if it also imports `src/host`, keep in vscode and repoint `schemaColumnLabels` to the barrel; if it's purely `schemaColumnLabels` (a barrel/core symbol) with no host, it can move to core. Inspect and place accordingly.

- [ ] **Step 1:** `grep -nE "from ['\"]" ~/projects/data-explorer-vscode/test/schema/schemaColumnLabels.test.ts`
- [ ] **Step 2:** If no `src/host` import → move to core (repoint to `../../src/`); else keep in vscode, repoint `schemaColumnLabels` import to `'data-explorer-core'`.
- [ ] **Step 3:** Run the affected suite(s) green.

### Task A5: Core rebuild + full verify + commit

- [ ] **Step 1:** `cd ~/projects/data-explorer-core && npm run build` (dist/ may change if — it should NOT, since only test/ changed; if dist/ changes unexpectedly, investigate).
- [ ] **Step 2:** `npm run verify` (typecheck + build + smoke + test + check:pack + check:leak). Expected: all green.
- [ ] **Step 3:** Leak grep (manual): the repo-wide grep from the cross-cutting rules — expected empty.
- [ ] **Step 4:** Commit core (NO Claude co-author):
```bash
cd ~/projects/data-explorer-core
git add -A
git commit -F - <<'EOF'
Absorb data-model tests relocated from data-explorer-vscode

Move the pure data-model tests (and the pure blocks split out of vscode's
mixed host-integration files) into core, where importing the internal node
classes, NodeRegistry, schema helpers, and serializer internals is normal.
No public-barrel changes: the extension still consumes only the curated
surface, and no test-only symbol is promoted to the package API.
EOF
```
- [ ] **Step 5:** Decide on tagging: these are test-only additions with NO src/ or dist/ change → the pin `#v0.1.2` in vscode stays valid and needs NO bump. Do NOT cut a new tag unless dist/ changed. (If Step A5.1 showed a dist/ change, that means a source file was touched — STOP and reassess; this plan should not modify core src/.) Push `main` over SSH: `git push origin main`.

---

## Phase B — vscode: repoint survivors to the barrel, delete src/dex

After Phase A, every remaining vscode test either (a) already imports `data-explorer-core`, or (b) still has a `src/dex` import that must be repointed to the barrel or removed. No remaining vscode test may need an off-barrel symbol.

### Task B1: Repoint all remaining vscode test imports to the barrel

- [ ] **Step 1: Find every remaining `src/dex` reference in test/ and src/**

Run: `cd ~/projects/data-explorer-vscode && grep -rIn -e "src/dex" -e "/dex/" test/ src/ 2>/dev/null`
Expected after Phase A: only host-integration test files with barrel-reachable symbols (`DataModel`, `parseBinarySldd*`, `parseMat`, `parseSlx`, `parseProject`, `serializeEntryToXml`, `generateUuid`, `getSectionMetadata`, `schemaColumnLabels`) plus redundant bare `NodeClassMap` side-effect imports.

- [ ] **Step 2: Repoint each, file by file** (no blanket sed — verify each symbol is on the barrel first). For each remaining file:
  - Replace `import DataModel from '.../src/dex/core/DataModel.js'` → `import { DataModel } from 'data-explorer-core';`
  - Replace `import { parseBinarySlddParts } from '.../src/dex/datamodel/parser/BinarySlddParser.js'` → `import { parseBinarySlddParts } from 'data-explorer-core';` (same for `parseBinarySldd`, `parseMat`, `parseSlx`, `parseProject`, `serializeEntryToXml`, `getSectionMetadata`, `schemaColumnLabels`).
  - Delete redundant `import '.../src/dex/datamodel/node/NodeClassMap.js';` lines (barrel side-effects registration).
  - Consolidate multiple barrel imports in a file into one `import { … } from 'data-explorer-core';`.

- [ ] **Step 3: Run the full vscode unit suite**

Run: `npm test 2>&1 | tail -8`
Expected: green. If a test fails with an empty `SlddModel.cache` or a failing `instanceof`, it is the dual-class-identity issue → use the `constructor.name` proxy (see `constantNode.test.ts` for the pattern), never re-add a `src/dex` import.

- [ ] **Step 4: Confirm zero `src/dex` references remain in test/**

Run: `grep -rIn -e "src/dex" -e "/dex/" test/ 2>/dev/null; echo "exit=$?"`
Expected: no output.

### Task B2: Confirm src/ (shipping) has no src/dex dependency

- [ ] **Step 1:** `grep -rIn "src/dex\|/dex/\|from './dex\|from '../dex" src/ 2>/dev/null; echo done`
Expected: no output (host already imports the barrel; migration commit 773e125 handled this).
- [ ] **Step 2:** Confirm nothing else references the tree: `grep -rIn "src/dex" . --include=*.ts --include=*.json --include=*.mjs --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null` — expected: only possibly `tsconfig`/`vite`/docs mentions. Inspect and clean any config include/exclude that names `src/dex`.

### Task B3: Delete the src/dex tree

- [ ] **Step 1:** `git rm -r src/dex`
- [ ] **Step 2:** `cat src/dex/vite-env.d.ts` was the only non-{core,datamodel} file — confirm nothing imported it: `grep -rIn "vite-env" src/ test/ 2>/dev/null`. If something needs the triple-slash ref, relocate it to `src/webview/` or `src/vite-env.d.ts`.
- [ ] **Step 3: typecheck** — `npm run typecheck` — expected: clean (no missing `src/dex` imports).

### Task B4: Full vscode gate

- [ ] **Step 1:** `npm run build` — expected: webview + host bundle succeed (this is the definitive "no needed file dropped" check).
- [ ] **Step 2:** `npm run build:web` — expected: browser bundle succeeds.
- [ ] **Step 3:** `npm test` — expected: green (file count = 112 − 27 (A1) − 4 (A2) − any whole-file moves in A3/A4; test count reduced by migrated its; NO failures).
- [ ] **Step 4:** `npm run test:integration` — expected: integration suite passes (exit 0). (The 17 integration tests referenced in task #88 live under `test/integration/` or are run by the VS Code harness — confirm they never imported `src/dex`; if any did, they were repointed in B1.)
- [ ] **Step 5:** `npm run package` — expected: VSIX builds; verify it does NOT contain `src/dex` or `node_modules/data-explorer-core` (esbuild inlines core): 
```bash
npx vsce ls 2>/dev/null | grep -E "dex/|data-explorer-core" ; echo "exit=$? (want no matches)"
```
- [ ] **Step 6: leak grep** (cross-cutting rule) — expected empty.

### Task B5: Update local docs + memory (NOT committed to public)

- [ ] **Step 1:** Update `CLAUDE.md` (gitignored): change the "src/dex retained as test-only" bullet to past tense — src/dex is now DELETED; core owns the data-model tests.
- [ ] **Step 2:** Append an "Execution notes" entry to `docs/plans/2026-08-31-adopt-core-package-and-native-ui.md` (or this plan) recording final file/test counts in both repos.
- [ ] **Step 3:** Update memory `vscode-consumes-core.md`: src/dex deleted; tests split (pure→core, host→vscode via barrel + constructor.name proxy). Update `MEMORY.md` if the hook line changed.

---

## Phase C — Commit vscode + close task #88

### Task C1: Commit vscode (no version bump needed — test-only + source deletion, no shipped behavior change)

- [ ] **Step 1:** Decide version: deleting the test-only tree does NOT change shipped extension behavior (src/dex was never bundled). No `package.json` bump and no new tag required. (If you WANT a release for hygiene, bump patch → `1.6.1` and tag per the release process; otherwise skip.)
- [ ] **Step 2:** Final review: `git status` and `git diff --cached --stat`. Confirm `CLAUDE.md` is NOT staged (`git diff --cached --name-only | grep -i claude.md` → empty).
- [ ] **Step 3:** Leak grep — empty.
- [ ] **Step 4:** Commit (NO Claude co-author):
```bash
cd ~/projects/data-explorer-vscode
git add -A
git commit -F - <<'EOF'
Delete test-only src/dex; data-model tests now live in data-explorer-core

Complete the core migration: relocate every pure data-model test to
data-explorer-core, split the mixed host-integration files (pure blocks to
core, host blocks stay and use the constructor.name identity proxy), repoint
all surviving test imports to the data-explorer-core barrel, and remove the
src/dex/{core,datamodel} tree entirely. The extension already imported only
the core barrel; no shipped behavior changes and no public API was expanded.
EOF
```
- [ ] **Step 5:** Push `main` over SSH: `git push origin main`. (Only push a tag if Step C1.1 chose to bump the version.)

### Task C2: Close the task

- [ ] Mark task #88 complete.

---

## Self-Review Checklist (run before executing)

- **Spec coverage:** All 54 dex-importing files are accounted for — 27 delete (A1), 4 move (A2), ~11 split (A3), 1 place (A4), remainder repoint (B1). ✓
- **No barrel expansion:** Confirmed invariant — every off-barrel symbol is unused by shipping src/. Pure blocks go to core instead. ✓
- **Type consistency:** Barrel names used consistently (`DataModel`, `parseBinarySldd`, `parseBinarySlddParts`, `parseMat`, `parseSlx`, `parseProject`, `serializeEntryToXml`, `generateUuid`, `getSectionMetadata`, `schemaColumnLabels`, `ModelBlockNode`, `kindForClass`). ✓
- **Two-repo ordering:** Core absorbs tests + commits/pushes FIRST (A5), then vscode deletes + commits (C1). Pin `#v0.1.2` unchanged because core src/dist untouched. ✓
- **Placeholder scan:** The perl one-liner in A2/Step 3 is explicitly marked illustrative/DO-NOT-RUN; use the explicit `sed` beneath it. Relative-path depth must be verified against `hostnodes.fidelity.test.ts` before repointing. ✓
- **No-co-author + leak-check + gitignored CLAUDE.md** enforced per-commit. ✓
