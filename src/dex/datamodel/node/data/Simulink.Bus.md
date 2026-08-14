<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.Bus — data-object fidelity

**Node class:** `BusNode` (`src/dex/datamodel/node/data/BusNode.ts`, extends `BaseBusNode`)
**MATLAB class:** `Simulink.Bus`
**Editable in our UI:** container: Name + Description only. Elements: add/remove + per-element property edits (see [Simulink.BusElement.md](Simulink.BusElement.md)).
**Verified against:** MATLAB R2027a (params.sldd fixture `MyBus`, round-trip both formats)

## Overview

A `Simulink.Bus` is a composite type: a named container whose children are
`Simulink.BusElement`s. In our UI the bus surfaces as an entry with an empty
(non-editable) Value column — a bus has no scalar value — and a child tree of its
elements. The container itself exposes only Name (editable), the class name in the
Data Type column (read-only label), and Description (editable). Structural editing
(add/remove element) is the primary mutation and is covered in
[StructuralEditing.md](StructuralEditing.md).

## Property table

| Property                   | MATLAB type        | SetAccess | Editable here | Serialized key         | Editor | Notes |
|----------------------------|--------------------|-----------|---------------|------------------------|--------|-------|
| Name                       | char               | (entry)   | yes           | name                   | text   | Valid MATLAB identifier, unique in namespace |
| Description                | char               | public    | yes           | Description            | textArea | Any string |
| (class name)               | —                  | —         | no (label)    | —                      | label  | Shows `Simulink.Bus` in the Data Type column |
| Elements                   | Simulink.BusElement array | public | via children  | Elements_internal      | —      | Structural add/remove; each element edited via its own node |
| DataScope                  | char (enum)        | public    | no            | DataScope              | —      | Pass-through (`Auto`/`Imported`/`Exported`); not surfaced editable |
| HeaderFile                 | char               | public    | no            | HeaderFile             | —      | Pass-through |
| PreserveElementDimensions  | logical            | public    | no            | PreserveElementDimensions | —   | Pass-through |
| Alignment                  | double             | public    | no            | Alignment              | —      | Pass-through |

## Non-obvious behavior

### No scalar value
`valueEditable === false` (inherited from `BaseBusNode`). The Value column is empty
— a bus is a type definition, not a value. A regression that made the container
value-editable would be caught by the contract-lock assertions.

### Description edit is the only container-level free-text edit
Name and Description route through `DataNode.setProperty` (string field). All other
container metadata (DataScope, HeaderFile, PreserveElementDimensions, Alignment) is
preserved byte-faithfully on round-trip but is **not** surfaced as editable — a
conservative choice: these carry enum/interdependent constraints we do not yet
mirror, so we keep them read-only rather than risk producing a dictionary MATLAB
would reject.

### Elements_internal serialization
The element array is stored under `Elements_internal` (not `Elements`). Adding or
removing an element re-derives both `_elements` and `_dimensions` (`[count, 1]`, a
column vector). An empty bus serializes `Elements_internal` as an empty array (`[]`)
— **not** a single-object form — so the binary XML serializer does not emit a
phantom self-closing `<Element/>`. (Two serializer bugs here were found and fixed
via the MATLAB round-trip gate in Phase 2; see BaseBusNode.ts.)

## Structural editing

Add/remove `Simulink.BusElement` children. See [StructuralEditing.md](StructuralEditing.md)
for the shared contract; both are MATLAB round-trip-verified (after an add,
`numel(v.Elements)` matches our new count; after a remove, the survivor count and
values are unchanged) in both JSON and binary formats.

## Round-trip coverage

- Structural add/remove element (JSON + binary) with MATLAB `__class__` +
  `__count__` gate: `test/parity/fidelity/structural.fidelity.test.ts`.
- Per-element property edits (Min/Max/Name/DataType/Description): see
  `test/parity/fidelity/element.fidelity.test.ts` and [Simulink.BusElement.md](Simulink.BusElement.md).

## Open questions / deferred

- **DataScope / HeaderFile / PreserveElementDimensions / Alignment editing**: these
  are real editable MATLAB properties with enum/interdependent rules. Deferred —
  preserved read-only until their constraints are probed and mirrored.
- **StructType classification**: a derived arch `Simulink.Bus` may be classified as
  a systemcomposer StructType (`isStructType`), changing the icon only — no data
  behavior difference.
