<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ValueType — data-object fidelity

**Node class:** `ValueTypeNode` (`src/dex/datamodel/node/data/ValueTypeNode.ts`)
**MATLAB class:** `Simulink.ValueType`
**Editable in our UI:** no (read-only pass-through; only Name and Description editable)
**Verified against:** MATLAB R2027a (probe_class('Simulink.ValueType'))

## Overview

A Simulink.ValueType defines a reusable value-type specification (data type, unit,
dimensions, complexity, min/max bounds) that can be applied to signals, states, and
parameters. In our UI the ValueType surfaces as a read-only entry: the Value column
is empty and not editable (`valueEditable = false`). The Data Type column shows the
underlying DataType property (defaulting to 'double'). The Property Inspector shows
Name, Value (empty), DataType, and Description. Only Name and Description are
editable via the UI.

## Property table

| Property    | MATLAB type  | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|-------------|-------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name        | char        | (entry)   | yes           | name / name                    | text   | Valid MATLAB identifier, unique in namespace |
| Description | char        | public    | yes           | Description / Description      | text   | Any string |
| DataType    | char        | public    | no (label)    | DataType / DataType            | label  | Any string (free-form; MATLAB validates downstream) |
| Unit        | char        | public    | no            | Unit / Unit                    | —      | Any string (SI or custom unit) |
| Min         | double / [] | public    | no            | Min / Min                      | —      | Finite real double scalar, or [] |
| Max         | double / [] | public    | no            | Max / Max                      | —      | Finite real double scalar, or [] |
| Complexity  | char (enum) | public    | no            | Complexity / Complexity        | —      | 'real' or 'complex' |
| Dimensions  | double      | public    | no            | Dimensions / Dimensions        | —      | Positive integer row vector |

## Non-obvious behavior (the reason this doc exists)

### Value column

- A ValueType has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The DataType property (defaulting to 'double')
  is surfaced in the Data Type column, not the Value column.

### Description

- Non-string assignment (`5`, `[1 2]`, `true`, `struct(...)`, `{1,2}`) in MATLAB
  produces **"Value must be a character vector or a string scalar."** This rejection
  is **unreachable** from our string editor. Type-guarded by the string editor.

### DataType (label, not editable)

- The ValueType's DataType is shown as a label in the Data Type column. It is not
  editable through the current UI (shown as a label, not a text editor). If made
  editable in the future, it accepts any character vector (free-form in MATLAB).

## Allowed values (enums / comboboxes)

None exposed in our UI. Complexity ('real'/'complex') is read-only.

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).
  Test: `test/parity/fidelity/typedef.fidelity.test.ts`.

- No additional validation for Description (any string accepted).

## Round-trip coverage

- JSON sldd: parse → verify className + read-only contract → serialize → re-parse.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (binary format loop).
- MATLAB gate: Description edit → MATLAB reads back the edited string. PASS.

## Open questions / deferred

- **Full property editing**: Unit, Min, Max, Complexity, and Dimensions are not
  currently editable in our UI. If surfaced in the future, validation rules from
  MATLAB probe output should guide the implementation.

- **DataType editability**: Currently a label; could become a text editor if the
  Property Inspector UX is extended. Accepts any char (no enum constraint in
  MATLAB — downstream Simulink validation catches invalid types).
