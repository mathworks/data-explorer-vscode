<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.LookupTable — data-object fidelity

**Node class:** `LookupTableNode` (`src/dex/datamodel/node/data/LookupTableNode.ts`)
**MATLAB class:** `Simulink.LookupTable`
**Editable in our UI:** no (read-only pass-through; only Name and Description editable)
**Verified against:** MATLAB R2027a (probe_class('Simulink.LookupTable'))

## Overview

A Simulink.LookupTable stores table data with breakpoints for use by lookup-table
blocks. It contains a Table sub-object, one or more Breakpoint sub-objects,
CoderInfo, StructTypeInfo, and configuration flags. In our UI the LookupTable
surfaces as a read-only entry: the Value column is empty and not editable
(`valueEditable = false`). The Property Inspector shows Name, Value (empty),
DataType (class name), and Description. Only Name and Description are editable via
the UI.

## Property table

| Property            | MATLAB type                  | SetAccess | Editable here | Serialized key (JSON / binary) | Editor | Allowed values / constraint |
|---------------------|------------------------------|-----------|---------------|--------------------------------|--------|-----------------------------|
| Name                | char                         | (entry)   | yes           | name / name                    | text   | Valid MATLAB identifier, unique in namespace |
| Description         | char                         | public    | yes           | (nested in sub-objects)        | text   | Any string |
| Table               | Simulink.lookuptable.Table   | public    | no            | Table / Table                  | —      | Sub-object (Value, DataType, Dimensions, Unit, FieldName) |
| Breakpoints         | Simulink.lookuptable.Breakpoint | public | no            | Breakpoints / Breakpoints      | —      | Sub-object (Value, DataType, Dimensions, Unit, FieldName) |
| CoderInfo           | Simulink.CoderInfo           | protected | no            | CoderInfo / CoderInfo          | —      | Sub-object |
| StructTypeInfo      | Simulink.lookuptable.StructTypeInfo | public | no       | StructTypeInfo / StructTypeInfo | —     | Sub-object (DataScope, HeaderFileName, Name) |
| SupportTunableSize  | logical                      | public    | no            | SupportTunableSize / SupportTunableSize | — | true/false |

## Non-obvious behavior (the reason this doc exists)

### Value column

- A LookupTable has no scalar "value" — `displayValue` returns `''` and
  `valueEditable` returns `false`. The entry appears in the table with an empty
  Value column. The data lives in nested sub-objects (Table, Breakpoints).

### Description

- The LookupTable's Description property is stored at the top-level _properties
  (when present). Non-string assignment in MATLAB produces "Value must be a
  character vector or a string scalar." — unreachable from our string editor.
  Type-guarded by the string editor.

### Sub-objects

- Table.Value and Breakpoints.Value contain the actual numeric data arrays. These
  are not surfaced through the scalar editor — they would require a dedicated
  array/table editor. Our UI preserves them during round-trip via the pass-through
  serialization (serial._rawVal is cloned with property overrides merged).

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

- **Description not a MATLAB property**: MATLAB's Simulink.LookupTable does NOT
  expose a top-level `Description` property (attempting `obj.Description` errors:
  "Unrecognized method, property, or field 'Description' for class
  'Simulink.LookupTable'"). Our node stores/restores Description via the JSON
  `_properties` for in-process round-trip fidelity, but the MATLAB gate cannot
  assert it via the standard property-read path. The field is preserved in the
  serialized file but is not accessible from the MATLAB API at the top level.

- **Table/Breakpoint array editing**: The numeric data in Table.Value and
  Breakpoints[].Value is complex multi-dimensional data that requires a dedicated
  editor UX. Not exposed via the scalar text editor; fully deferred.

- **Multiple breakpoint dimensions**: LookupTable supports 1-D to N-D tables with
  multiple Breakpoints sub-objects. Our parser preserves all of them during
  round-trip but does not expose array editing for any dimension.

- **SupportTunableSize**: Boolean flag controlling tunable-size behavior. Not
  exposed in our UI.
