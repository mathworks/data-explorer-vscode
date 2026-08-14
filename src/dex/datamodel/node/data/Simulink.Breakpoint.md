<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.Breakpoint — data-object fidelity

**Node class:** `BreakpointNode` (`src/dex/datamodel/node/data/BreakpointNode.ts`)
**MATLAB class:** `Simulink.Breakpoint`
**Editable in our UI:** no (read-only pass-through; only Name and Description editable)
**Verified against:** MATLAB R2027a (probe_class('Simulink.Breakpoint'))

## Overview

A Simulink.Breakpoint stores shared breakpoint data for use by multiple lookup
table blocks. It contains a Breakpoints sub-object (with Value, DataType,
Dimensions, Unit), CoderInfo, StructTypeInfo, and a SupportTunableSize flag. In our
UI the Breakpoint surfaces as a read-only entry: the Value column is empty and not
editable (`valueEditable = false`). The Property Inspector shows Name, Value
(empty), DataType (class name), and Description. Only Name and Description are
editable via the UI.

## Property table

| Property            | MATLAB type                       | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|---------------------|-----------------------------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name                | char                              | (entry)   | yes           | name / name                    | text   | Valid MATLAB identifier, unique in namespace |
| Description         | char                              | public    | yes           | (nested or top-level)          | text   | Any string |
| Breakpoints         | Simulink.lookuptable.Breakpoint   | public    | no            | Breakpoints / Breakpoints      | —      | Sub-object (Value, DataType, Dimensions, Unit, FieldName) |
| CoderInfo           | Simulink.CoderInfo                | protected | no            | CoderInfo / CoderInfo          | —      | Sub-object |
| StructTypeInfo      | Simulink.lookuptable.StructTypeInfo | public  | no            | StructTypeInfo / StructTypeInfo | —     | Sub-object (DataScope, HeaderFileName, Name) |
| SupportTunableSize  | logical                           | public    | no            | SupportTunableSize / SupportTunableSize | — | true/false |

## Non-obvious behavior (the reason this doc exists)

### Value column

- A Breakpoint has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The entry appears in the table with an empty
  Value column. The breakpoint data lives in the nested Breakpoints sub-object.

### Description

- The Breakpoint's Description (when present) is stored at the top level or
  within nested sub-objects. Non-string assignment in MATLAB produces "Value must be
  a character vector or a string scalar." — unreachable from our string editor.
  Type-guarded by the string editor.

### Sub-objects

- Breakpoints.Value contains the actual numeric breakpoint array. This is not
  surfaced through the scalar editor — would require a dedicated array editor.
  Our UI preserves it during round-trip via the pass-through serialization.

## Allowed values (enums / comboboxes)

None exposed in our UI. All sub-object enum properties (DataType: 'auto'/etc.,
StorageClass, DataScope) are read-only.

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
- MATLAB gate: Description edit → MATLAB reads back. PASS.

## Open questions / deferred

- **Description not a MATLAB property**: MATLAB's Simulink.Breakpoint does NOT
  expose a top-level `Description` property (attempting `obj.Description` errors:
  "Unrecognized method, property, or field 'Description' for class
  'Simulink.Breakpoint'"). Our node stores/restores Description via the JSON
  `_properties` for in-process round-trip fidelity, but the MATLAB gate cannot
  assert it via the standard property-read path. The field is preserved in the
  serialized file but is not accessible from the MATLAB API at the top level.

- **Breakpoint array editing**: The numeric data in Breakpoints.Value is a 1-D
  array that requires a dedicated editor UX. Not exposed via the scalar text
  editor; fully deferred.

- **SupportTunableSize**: Boolean flag controlling tunable-size behavior. Not
  exposed in our UI.

- **TunableSizeName / TunableSizeValue**: Properties inside the Breakpoints
  sub-object for tunable-size configuration. Not exposed.
