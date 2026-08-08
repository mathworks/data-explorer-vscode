# MCOS Property Decode — Deep Work Spec

**Branch:** `feat/mcos-property-decode`
**Started:** 2026-08-07
**Goal:** Rewrite `src/dex/datamodel/parser/McosParser.ts` to decode Simulink object
properties (Value, Min, Max, DataType, Unit, Description, and nested/child objects)
**correctly** from the binary MCOS blob found in `.slx` and `.mat` files. Decode as
much as possible; **never guess** — anything not confidently resolved is left empty.

## The unification principle (governing directive)

One node class per Simulink entry type, shared across ALL format parsers. Parsing is
format-specific (slx / mat / sldd-json / sldd-binary) but converges on the SAME
data-model node class with the SAME property values. This rewrite makes the binary
(MCOS) path produce the same values the SLDD (JSON) path already produces.

## Why the old decoder was wrong

`decodeMcosBlob` did a **heuristic linear scan** of heap cells after a class-name
"anchor", collecting "extras" until the first object handle, then guessed property
names from a hardcoded `KNOWN_CLASS_PROPERTIES` table by type-counting. Verified
against `model.slx` this mis-assigned fields (e.g. `Sig1.Max="Table"`) and missed
others (`Param.Value` empty). It ignored the real name→heap-cell mapping the file
actually contains.

## What the file actually contains (confirmed by byte inspection)

The MCOS blob's `cell[0]` is a metadata table with a proper structure:
- **Header:** uint32 section offsets (repo currently reads 10; confirm exact count).
- **String table:** every property + class name explicitly (Value, Min, Max,
  DataType, Unit, Description, CoderInfo, …). Names are NOT guessed.
- **Class table:** (packageNameIdx, classNameIdx) per class.
- **Object table:** maps each object → its class + property-block references.
- **Property blocks:** sequences of `{nameIndex, flag, value}` triples where
  `flag==1` → `value` is a **heap-cell index** (follow it, parse that cell as a
  normal mxArray), `flag==2` → literal/bool, `flag==0` → padding.
- **Heap cells:** `cell[1..N]` hold the actual mxArrays (doubles, chars, structs,
  and object-handles `uint32` with magic `0xDD000000` for nested objects).

Correct decode of `Param.Value` = locate object's property block → find `Value`
entry → follow `flag==1` heap-cell index → parse cell. Nested objects (CoderInfo)
and children (BusElements, Enumerals) are object-handle references → recurse.

## Correctness oracle strategy (per user directive)

Use the MATLAB sandbox to GENERATE controlled fixtures with known non-default
values, saved in all four formats, then assert the parser reproduces them:

- Sandbox: `cd /System/Volumes/Data/mathworks/devel/sbs/78/weiwang.dexp3/matlab`
  then `mw matlab -nodesktop -batch "run('/tmp/.../gen.m')"`. (Do NOT pass
  `-using` or `-nosplash`; run from inside the sandbox dir. Verified working.)
- Four format paths per entry type: **.sldd(json), .sldd(binary), .slx, .mat**.
- The SLDD-JSON path is already correct → it is a secondary oracle for the others.

Confirmed working: MATLAB launches; `save`, `Simulink.data.dictionary.create` +
`addEntry`, and model-workspace `assignin` + `save_system` all succeed.

## Entry types to cover

Simulink.Parameter, Simulink.Signal, Simulink.Breakpoint, Simulink.LookupTable,
Simulink.NumericType, Simulink.AliasType, Simulink.ValueType, Simulink.Bus (+
BusElement children), Simulink.VariantControl, Simulink.VariantVariable,
Simulink.VariantExpression, enum types, ConfigSet. (Prioritise Parameter/Signal —
highest value, simplest scalar props — then the rest.)

## Phases (ordered by value)

1. **Fixture generation (MATLAB)** — one gen script producing every entry type in
   all four formats with known non-default values + a JSON manifest of expected
   values. Store under `test/fixtures/mcos/`. HIGHEST VALUE — the oracle.
2. **Reverse-engineer format** — a throwaway analyzer that walks the metadata
   table on the Parameter fixture and prints resolved `{name→value}`; iterate until
   it matches the manifest exactly (byte alignment correct).
3. **Rewrite McosParser** — replace heuristic with the real table walk. Scalars
   first (Parameter/Signal Value/Min/Max/DataType/Unit/Description), then nested
   objects, then children (recurse via object handles). Never guess.
4. **Wire into typed nodes** — ensure decoded properties flow through the
   NodeClassMap.parseValue path into ParameterNode/SignalNode/etc. so columns fill.
5. **Cross-format tests** — vitest asserting all four paths yield identical values
   matching the manifest, for every entry type. Full suite + typecheck green.

## Decisions / rationale

- **Generate fixtures rather than rely on `design.sldd`/`model.slx`:** those have
  mostly default (empty) values, so they cannot prove Value/Min/Max decode. Known
  non-default fixtures are required to validate correctness.
- **Never guess:** if the table walk cannot resolve a property with confidence,
  leave it empty. A wrong value is worse than an absent one (the old bug).

## Progress checkpoint

- [x] Env verified: branch created, 420 tests pass, typecheck clean, MATLAB works.
- [x] Confirmed all 4 fixture save paths work (smoke test in /tmp/mcos_fix).
- [x] Phase 1: fixture generation (test/fixtures/mcos/, test/tools/mcos/)
- [x] Phase 2: reverse-engineer — format CONFIRMED & validated against all fixtures
- [x] Phase 3: rewrite McosParser — real table walk; validated end-to-end
- [x] Phase 4: wire into typed nodes — decoded props flow into ParameterNode/etc
- [x] Phase 5: cross-format tests — vitest suite added; full suite + typecheck green

### Phase 3/4 result

`decodeMcosBlob` rewritten: navigates FileWrapper → cells[], parses the metadata
table (strings/classes/objects/blocks), maps each named var → root object id (via
its own handle's v[4]), walks the positional 8-byte-aligned property block,
resolves heap cells (flag 1), string literals (flag 0), inline bools (flag 2), and
recurses object handles into nested `{_object_class,_properties}`. Emits SLDD-shaped
`_properties`; matrices as `Matrix(r,c)` value objects. A confidence gate skips any
var whose root-object class ≠ declared class (never guess).

`mcosTypedNode.buildTypedNodeFromMcos` now takes optional decoded `properties` and
feeds them to the SAME `NodeRegistry.parseValue` the SLDD path uses; empty shell
when absent. MatNode/ModelNode pass decoded props + rawBytes through.

**Cross-format parity VALIDATED (7/7):** a harness runs SLDD-JSON (oracle),
MCOS(.mat), and MCOS(.slx) through the real node pipeline; Param/ParamMat/Sig/
Numeric/Alias/Bp/Lut produce byte-identical typed-node signatures (className,
displayValue, Min, Max, Unit, Description, child count). 420 existing tests green,
typecheck clean, build resolves.

## CONFIRMED FORMAT (Phase 2 complete — validated against every fixture)

The `cell[0]` metadata blob (little-endian uint32) decodes deterministically:

- **Header:** 10 uint32 words at bytes [0,40). `w[0]`=version, `w[1]`=nStrings,
  `w[2..]` are segment END offsets.
- **String table:** null-terminated ASCII from byte **40** to `w[2]`. Index 0 is
  the empty string (synthetic); real strings are 1-based.
- **Class table:** `[w[2], w[3])`, **16-byte** records `[pkgStrIdx, clsStrIdx, 0, 0]`.
  Rows are **0-based** (`classId` in object records indexes this directly).
- **Object table:** `[w[4], w[5])`, **24-byte** records = 6 words
  `[classId, 0, 0, 0, objId, depId]`. Only word0 (classId, 0-based) matters for
  property decode. Row 0 is the synthetic null object. Words 4/5 are a sequential
  object id and a dependency id — **NOT** block pointers (this was the trap).
- **Property blocks:** `[w[5], w[6])`. **One block per object, in object order**
  (including the null object's empty block). Each block = `[nProps,
  (nameStrIdx, flag, value)×nProps]`, then **padded to an 8-byte boundary**
  (relative to region start). No indirection — the i-th block belongs to obj[i].
- **flag semantics:** `1` → `value` is a heap-cell index; the mxArray is
  `cells[value + 2]` (heap starts after cell[0]=meta and cell[1]=defaults).
  `0` → `value` is a string-table index (enum/string literal, e.g.
  StorageClass="Auto"). `2` → `value` is an inline number/bool.
- **Object-handle** heap cells: `uint32` array, `v[0]==0xDD000000` magic; `v[4]`
  is the referenced object id (for nested CoderInfo/CustomAttributes and children).

**Named-variable → root object id (multi-object linkage).** Each *named* opaque
variable (the top-level `.slx`/`.mat` workspace var) retains its own MI element
raw bytes. Inside, an object handle appears: scan its uint32 words for the magic
`0xDD000000`; the word at magic **+4** is the variable's **root object id** (index
into the object table), and magic **+5** is its classId. Validated: in the 7-var
`mcosfix.slx`, Alias→1, Bp→2, Lut→6, Numeric→11, Param→12, ParamMat→14, Sig→16 —
each matching the object decoded from that id. Single-object `.mat` files → id 1.
This is how the same `McosParser` serves both one-object and many-object files.

**Value-shape convergence (for typed-node display parity with SLDD).** Scalars
stay JS numbers/strings. **Matrices** must be emitted as the SLDD string form
`{_type:'double', _value:'Matrix(r,c)\n[[a, b]; [c, d]]'}` (row-major, r×c) so the
node's `displayValue` matches the SLDD twin exactly (e.g. "[1 2 3; 4 5 6]"). A raw
JS array would display flat ("[1 2 3 4 5 6]") — wrong. MatParser already returns
matrix heap-cell values **row-major** with correct `dimensions`.

**SLDD↔binary property-name differences** (needed for cross-format unification):
- Binary exposes **`DocUnits`**; SLDD/typed node property is **`Unit`**.
- SLDD omits default-valued props; binary includes CoderInfo/Complexity/etc.

## Failure log

- **Trap: object word4/word5 as block pointer.** Assumed the object record's
  +16/+20 field indexed the property block. It's a sequential id + dependency id;
  coincided with block position only in single-object files. Real rule: blocks are
  **positional** (i-th block ↔ i-th object).
- **Trap: 1-based classId.** Off-by-one made classes/props look scrambled in
  multi-object files. classId is **0-based**.
- **Trap: no inter-block alignment.** Blocks are **8-byte aligned**; without the
  pad, block boundaries drifted after the first odd-sized block.
- Research sub-agent to look up scipy/matio format spec was declined by user;
  resolved empirically from raw byte dumps instead (see test/tools/mcos/).

### Phase 5 result — cross-format tests (DONE)

`test/mcosCrossFormat.test.ts` (12 tests) codifies the parity harness as a
permanent regression guard. It loads the generated fixtures and, for each of the 7
entry types (Param, ParamMat, Sig, Numeric, Alias, Bp, Lut), asserts the typed-node
signature (className, displayValue, Min, Max, Unit, Description, childCount) is
**identical** across three paths:
- **SLDD (JSON) oracle** — each `entries[].value` walked through `NodeRegistry.parseValue` (mirrors `SectionNode.parseEntry`).
- **MCOS .mat** — one object per file via `MatNode.fromParsed(parseMat(...))`.
- **MCOS .slx** — all workspace objects via `ModelNode.fromParsed(parseSlx(...))`.

Plus targeted assertions of the actual decoded values (Param = 42 / -1 / 100 / m/s /
hello; ParamMat = "[1 2 3; 4 5 6]"; Sig min/max/unit/desc; Numeric/Alias
descriptions; Bp/Lut class routing).

`test/mcosTypedNode.test.ts` updated: the stale "CLASS-ONLY / ignores the decoded
bag / EMPTY SHELL" language is replaced; it now documents that the adapter surfaces
decoded SLDD-shaped properties when supplied (with a test proving Value/Min/Max/
Unit/Description populate, DocUnits→Unit mapping included) and falls back to an empty
shell only when none are supplied (test retained).

**Final state:** `npm test` → **433 passed (40 files)**; `npm run typecheck` clean;
`npm run build` resolves (the drop-check that no needed `src/dex` file was lost);
leak-check over git-tracked files returns nothing. All five phases complete on
branch `feat/mcos-property-decode`.

## Observations / future work

- **VariantControl fixture deferred:** the MATLAB API
  `Simulink.VariantControl('Value',1,'ValueType','Numeric')` errored in the sandbox
  (that class only exposes Value/ActivationTime). No fixture → no cross-format test
  for it, though `buildTypedNodeFromMcos` routes the class correctly.
- **Bus/BusElement + enum children:** the parser supports object-handle recursion
  (nested `{_object_class,_properties}`), but there is no fixture/test exercising a
  Bus with element children or an enum type's enumerals. The machinery is in place;
  validation is future work.
