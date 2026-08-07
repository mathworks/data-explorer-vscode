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
- [ ] Phase 1: fixture generation
- [ ] Phase 2: reverse-engineer
- [ ] Phase 3: rewrite
- [ ] Phase 4: wire
- [ ] Phase 5: tests

## Failure log

(append as issues arise)

## Observations / future work

(append out-of-scope findings)
