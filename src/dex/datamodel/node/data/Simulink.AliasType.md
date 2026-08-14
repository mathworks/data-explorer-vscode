<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.AliasType — data-object fidelity

**Node class:** `AliasTypeNode` (`src/dex/datamodel/node/data/AliasTypeNode.ts`)
**MATLAB class:** `Simulink.AliasType`
**Editable in our UI:** yes (BaseType editable; Name and Description editable)
**Verified against:** MATLAB R2027a (probe_class('Simulink.AliasType'))

## Overview

A Simulink.AliasType creates a named alias for an existing data type (e.g.
`'single'`, `'int32'`, `'fixdt(1,16,8)'`, or another alias name). The alias can be
used anywhere MATLAB expects a data type name. In our UI the AliasType surfaces
with an empty Value column (`displayValue = ''`, `valueEditable = false`). The Data
Type column shows the BaseType via PropBaseType. The Property Inspector exposes
Name, BaseType (editable text), DataType (class name label), and Description.

## Property table

| Property    | MATLAB type  | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|-------------|-------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name        | char        | (entry)   | yes           | name / name                    | text   | Valid MATLAB identifier, unique in namespace |
| BaseType    | char        | public    | yes           | BaseType / BaseType            | text   | Any string (data type name: 'double', 'single', 'int8', 'int16', 'int32', 'uint8', 'uint16', 'uint32', 'boolean', 'fixdt(...)' expression, or another alias name) |
| Description | char        | public    | yes           | Description / Description      | text   | Any string |
| DataScope   | char (enum) | public    | no            | DataScope / DataScope          | —      | 'Auto', 'Exported', 'Imported' |
| HeaderFile  | char        | public    | no            | HeaderFile / HeaderFile        | —      | Any string |

## Non-obvious behavior (the reason this doc exists)

### Value column

- An AliasType has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The BaseType string (e.g. 'int32') is surfaced
  in the Data Type column via PropBaseType (column = 'DataType').

### BaseType

- MATLAB accepts any character vector as BaseType. The validity of the specified
  type name is checked downstream when the alias is actually used (e.g. in a signal
  or parameter's DataType field). An empty string is accepted but means "unresolved
  alias." In our UI, the text editor always delivers a string, so no non-string
  rejection is reachable.

- Non-string assignment (`5`, `[1 2]`, `true`, `struct(...)`, `{1,2}`) in MATLAB
  produces **"Value must be a character vector or a string scalar."** This rejection
  is **unreachable** from our string editor. Type-guarded by the string editor.

### Description

- Same unreachable non-string rejection as above. Type-guarded by the string editor.

### Serialization

- `BaseType` is ALWAYS serialized (even when empty string) because AliasTypeNode's
  `_getSerializedProperties` unconditionally sets `props.BaseType = this.BaseType`.
  This matches MATLAB behavior where BaseType is always present in the saved file.

## Allowed values (enums / comboboxes)

| Property  | Accepted set                              | Rejection message |
|-----------|-------------------------------------------|-------------------|
| DataScope | `Auto`, `Exported`, `Imported`            | (not editable in UI) |

## Validation mirrored in code

- Name: validated by `DataNode.setProperty` → `validateMatlabName` (valid MATLAB
  identifier, unique in namespace, max 63 chars, not a keyword).
  Test: `test/parity/fidelity/typedef.fidelity.test.ts`.

- BaseType: no validation beyond string assignment. MATLAB accepts any char; invalid
  type names are caught downstream. Our code assigns directly via the generic
  string path in `DataNode.setProperty`. No reject path from the string editor.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (round-trip 'single', 'int32').

- Description: no additional validation (any string accepted).

## Round-trip coverage

- JSON sldd: parse → edit BaseType to 'single' → serialize → re-parse → BaseType === 'single'.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (json format loop).
- Binary sldd: same.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (binary format loop).
- MATLAB re-open value-equality gate:
  - `BaseType='single'` → MATLAB reads 'single'. PASS.
  - `BaseType='int32'` → MATLAB reads 'int32'. PASS.
  - Name rename → MATLAB reads the entry by the new name. PASS.
  Test: `test/parity/fidelity/typedef.fidelity.test.ts` (gated on DEX_MATLAB_CMD).

## Open questions / deferred

- **DataScope / HeaderFile editing**: Not currently exposed in our UI. If surfaced,
  DataScope is an enum ('Auto', 'Exported', 'Imported'); HeaderFile is free-form char.

- **BaseType validation**: MATLAB does not validate BaseType at assignment time —
  invalid type names only error when used downstream. We match this permissive
  behavior. A future enhancement could warn (not reject) on unrecognized type
  names, but this is not a fidelity requirement.
