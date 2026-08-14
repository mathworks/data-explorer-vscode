<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.NumericType — data-object fidelity

**Node class:** `NumericTypeNode` (`src/dex/datamodel/node/data/NumericTypeNode.ts`)
**MATLAB class:** `Simulink.NumericType`
**Editable in our UI:** no (read-only pass-through; only Name and Description editable)
**Verified against:** MATLAB R2027a (probe_class('Simulink.NumericType'))

## Overview

A Simulink.NumericType defines a custom fixed-point or scaled-double numeric data
type used by Simulink blocks. It stores configuration properties like
DataTypeMode, WordLength, FixedExponent, SlopeAdjustmentFactor, Bias, and
Signedness — all of which are complex interdependent settings in MATLAB. In our UI
the NumericType surfaces as a read-only entry: the Value column is empty and not
editable (`valueEditable = false`). The Property Inspector shows Name, Value (empty
label), DataType (class name), and Description. Only Name and Description are
editable via the UI.

## Property table

| Property              | MATLAB type  | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|-----------------------|-------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name                  | char        | (entry)   | yes           | name / name                    | text   | Valid MATLAB identifier, unique in namespace |
| Description           | char        | public    | yes           | Description / Description      | text   | Any string |
| DataTypeMode          | char (enum) | public    | no            | DataTypeMode / DataTypeMode    | —      | Enum: 'Double', 'Single', 'Fixed-point: binary point scaling', etc. |
| WordLength            | double      | public    | no            | WordLength / WordLength         | —      | Positive integer |
| FixedExponent         | double      | public    | no            | FixedExponent / FixedExponent  | —      | Integer |
| SlopeAdjustmentFactor | double      | public    | no            | SlopeAdjustmentFactor / SlopeAdjustmentFactor | — | Positive real |
| Bias                  | double      | public    | no            | Bias / Bias                    | —      | Real scalar |
| SignednessBool        | logical     | public    | no            | SignednessBool / SignednessBool | —      | true/false |
| IsAlias               | logical     | public    | no            | IsAlias / IsAlias              | —      | true/false |
| DataScope             | char (enum) | public    | no            | DataScope / DataScope          | —      | 'Auto', 'Exported', 'Imported' |
| HeaderFile            | char        | public    | no            | HeaderFile / HeaderFile        | —      | Any string |
| DataTypeOverride      | char (enum) | public    | no            | DataTypeOverride / DataTypeOverride | — | 'Inherit', 'Off' |

## Non-obvious behavior (the reason this doc exists)

### Value column

- A NumericType has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The class name is surfaced in the Data Type
  column (via PropDataType), not in the Value column.

### Description

- Non-string assignment (`5`, `[1 2]`, `true`, `struct(...)`, `{1,2}`) in MATLAB
  produces **"Value must be a character vector or a string scalar."** This rejection
  is **unreachable** from our string editor (the UI always delivers a string).
  Type-guarded by the string editor.

### Fixed-point properties

- DataTypeMode, WordLength, FixedExponent, SlopeAdjustmentFactor, and Bias have
  complex interdependency rules in MATLAB. They are not currently editable in our
  UI. If any of these become editable in the future, MATLAB probe output should
  guide the validation logic.

## Allowed values (enums / comboboxes)

None exposed in our UI. All enum-constrained properties (DataTypeMode, DataScope,
DataTypeOverride) are read-only in the current implementation.

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).
  Test: `test/parity/fidelity/typedef.fidelity.test.ts`.

- No additional validation needed for Description (any string accepted; assignment
  is a direct string property set).

## Round-trip coverage

- JSON sldd: parse → verify className + read-only contract → serialize → re-parse.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (binary format loop).
- MATLAB gate: Description edit → MATLAB reads back the edited string. PASS.

## Open questions / deferred

- **Fixed-point property editing**: DataTypeMode, WordLength, FixedExponent, Bias,
  SlopeAdjustmentFactor, and SignednessBool are complex interdependent settings.
  Not currently editable; if surfaced in the future a full MATLAB probe is needed.

- **IsAlias flag**: Controls whether the type name is an alias for the underlying
  fixed-point specification. Not exposed in the UI.
