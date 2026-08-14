<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.Parameter — data-object fidelity

**Node class:** `ParameterNode` (`src/dex/datamodel/node/data/ParameterNode.ts`)
**MATLAB class:** `Simulink.Parameter`
**Editable in our UI:** yes
**Verified against:** MATLAB R2027a (probe_class('Simulink.Parameter'))

## Overview

A Simulink.Parameter stores a tunable value (scalar, vector, matrix, complex,
logical, string, or struct) along with metadata (data type, units, min/max bounds,
description, code-generation settings). In our UI the Parameter surfaces as an
editable entry whose Value column shows the formatted value and whose Property
Inspector exposes Name, Value, DataType, Min, Max, Unit, Description, and the
schema-projected CoderInfo columns (StorageClass, Alias, etc.).

## Property table

| Property      | MATLAB type          | SetAccess | Editable here | Serialized key (JSON / binary) | Editor   | Allowed values / constraint |
|---------------|---------------------|-----------|---------------|--------------------------------|----------|-----------------------------|
| Name          | char                | (entry)   | yes           | name / name                    | text     | Valid MATLAB identifier, unique in namespace |
| Value         | varies              | public    | yes           | Value / Value                  | text     | Numeric scalar/array/matrix, complex, logical, string, struct (no cells, no empty struct leaves) |
| DataType      | char                | public    | no (label)    | DataType / DataType            | label    | Any string (free-form; MATLAB validates downstream) |
| Min           | double / []         | public    | yes           | Min / Min                      | text     | Finite real double scalar, or [] to clear |
| Max           | double / []         | public    | yes           | Max / Max                      | text     | Finite real double scalar, or [] to clear |
| Unit          | char                | public    | no (label)    | DocUnits / DocUnits            | label    | Any string |
| Description   | char                | public    | yes           | Description / Description      | text     | Any string |
| Complexity    | char (enum)         | public    | no (hidden)   | Complexity / Complexity        | —        | 'real' or 'complex' |
| Dimensions    | double row vector   | public    | no            | Dimensions / Dimensions        | —        | Positive integer row vector |
| StorageClass  | char (enum)         | public    | yes (schema)  | CoderInfo.StorageClass         | combo    | schemaBridge-validated |
| CoderInfo     | Simulink.CoderInfo  | protected | nested        | CoderInfo / CoderInfo          | —        | Sub-object, not directly assigned |

## Non-obvious behavior (the reason this doc exists)

### Value

- `Value = {1,2}` (cell) → **"Invalid value specified for parameter. Value must be a numeric array, fi object, enumerated value, structure whose fields contain valid values, string scalar, or an expression."**
  A cell array is NOT a valid Parameter.Value. This is a hard reject.

- `Value = struct('a',[])` → **"A valid structure must be numeric"**
  A struct Value where any leaf is empty/null is rejected. (Our UI does not
  currently surface struct editing via the text editor — the struct value is
  displayed via a child node tree — so this rejection is not reachable from the
  string editor today. Documented here as reference knowledge.)

- `Value = scalar/array/matrix/complex/logical/string/char/[]` → all OK (stored verbatim with the type preserved).

### Min / Max

- `Min = [1 2 3]` / `Inf` / `-Inf` / `NaN` / `5+2i` / `'text'` → **"Minimum must be a finite real double scalar value"**
- `Max = [1 2 3]` / `Inf` / `-Inf` / `NaN` / `5+2i` / `'text'` → **"Maximum must be a finite real double scalar value"**
- `Min = []` or `Max = []` → clears the bound (MATLAB stores `[]`).
- MATLAB does NOT enforce Min <= Max (it accepts Min=5, Max=1). We match this: no cross-check.

### DataType / Unit / Description

- Non-string assignment (`5`, `[1 2]`, `true`, `struct(...)`, `{1,2}`) →
  **"Value must be a character vector or a string scalar."**
  This rejection is **unreachable** from our string editor (the UI always delivers
  a string), so no code is added for it. Type-guarded by the string editor.

### StorageClass

- Enum validation is owned by `schemaBridge.ts` (not this node). Out-of-set
  strings → **"'X' is not a valid storage class"**.

### Complexity

- Enum: only 'real' and 'complex'. Any other string →
  **"There is no enumerated value named 'X'."**
  Not currently exposed in our UI editor.

## Allowed values (enums / comboboxes)

| Property     | Accepted set                 | Rejection message |
|-------------|------------------------------|-------------------|
| Complexity  | `real`, `complex`            | "There is no enumerated value named 'X'." |
| StorageClass| `Auto`, `ExportedGlobal` (+ CSC-registered classes) | "'X' is not a valid storage class" |

## Validation mirrored in code

- `ParameterNode.setProperty('Value', ...)` rejects cell values (parsed.type === 'cell')
  → returns `{error, reason: "Invalid value specified for parameter. Value must be
  a numeric array, fi object, enumerated value, structure whose fields contain
  valid values, string scalar, or an expression."}`. Mirrors the verbatim MATLAB
  R2027a message.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts`.

- `ParameterNode.setProperty('Value', ...)` rejects unparseable expressions
  (MatlabValueParser returns null) → `{error, reason: "Invalid MATLAB expression"}`.
  Test: same file.

- `DataNode._setMinMax` enforces finite real double scalar for Min/Max.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (Min→3, Max→99 round-trip).

- StorageClass enum validation: owned by `schemaBridge.ts` (separate agent scope).

## Round-trip coverage

- JSON sldd: parse → edit Min/Max/Value → serialize → re-parse → value preserved.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `Min=3, Max=99` → MATLAB reads 3 and 99. PASS.
  - `Value=42` → MATLAB reads 42. PASS.
  - `Value=[1 2 3]` → in-process only (verify_roundtrip.m's jsondecode converts
    JSON arrays to column vectors; MATLAB stores the row vector — shape mismatch in
    the gate's isequal. Class assertion still validates MATLAB opens the file).
  Test: `test/parity/fidelity/parameter.fidelity.test.ts` (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **Struct Value editing**: struct-typed Parameter values are displayed via a child
  node tree, not via the text Value editor. The empty-leaf rule
  (`struct('a',[])` → "A valid structure must be numeric") is documented but no
  defensive code is added because the string-editor code path cannot produce a
  struct (there is no struct literal parser). If struct editing becomes reachable
  in the future, add the empty-leaf check.

- **Dimensions property**: complex validation rules exist (positive integer row
  vector, no trailing 1 for >2D, symbolic expressions). Not currently editable in
  our UI; deferred.

- **Complexity property**: enum-validated ('real'/'complex') but not surfaced in
  the UI editor. Deferred.

- **verify_roundtrip.m array handling**: JSON arrays become MATLAB column vectors
  via jsondecode, causing shape mismatch with row-vector Parameter.Value. A future
  improvement could reshape expected arrays in the M-function; for now array
  assertions are in-process only.
