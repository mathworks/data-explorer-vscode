<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ConnectionBus — data-object fidelity

**Node class:** `ConnectionBusNode` (`src/dex/datamodel/node/data/ConnectionBusNode.ts`, extends `BaseBusNode`)
**MATLAB class:** `Simulink.ConnectionBus`
**Editable in our UI:** container: Name + Description only. Elements: add/remove + per-element edits (see [Simulink.ConnectionElement.md](Simulink.ConnectionElement.md)).
**Verified against:** MATLAB R2027a (params.sldd fixture `MyConnBus`, round-trip both formats)

## Overview

A `Simulink.ConnectionBus` is the physical-modeling analog of a `Simulink.Bus`: a
named container whose children are `Simulink.ConnectionElement`s (physical
connection ports). It surfaces exactly like a bus — empty non-editable Value, a
child tree of connection elements — sharing all of `BaseBusNode`'s parse/serialize
machinery.

## Property table

| Property     | MATLAB type                     | SetAccess | Editable here | Serialized key    | Editor   | Notes |
|--------------|---------------------------------|-----------|---------------|-------------------|----------|-------|
| Name         | char                            | (entry)   | yes           | name              | text     | Valid MATLAB identifier, unique in namespace |
| Description  | char                            | public    | yes           | Description       | textArea | Any string |
| (class name) | —                               | —         | no (label)    | —                 | label    | Shows `Simulink.ConnectionBus` in the Data Type column |
| Elements     | Simulink.ConnectionElement array | public   | via children  | Elements_internal | —        | Structural add/remove; each element edited via its own node |

## Non-obvious behavior

### No scalar value
`valueEditable === false`. The Value column is empty. Contract-lock assertions pin
this.

### Element connection type stored in `Type_internal`
Each `ConnectionElement` child stores its connection type under `Type_internal`
(falling back to `Type`), defaulting to the generic `'Connection: <domain name>'`
when unset. This is surfaced in the child's Data Type column. See
[Simulink.ConnectionElement.md](Simulink.ConnectionElement.md).

### Same Elements_internal serialization as Simulink.Bus
Add/remove re-derives `_elements` + `_dimensions` (`[count, 1]`); empty container
serializes `Elements_internal` as `[]` (no phantom element). Shared with
`Simulink.Bus` via `BaseBusNode`.

## Structural editing

Add/remove `Simulink.ConnectionElement` children. See [StructuralEditing.md](StructuralEditing.md).
MATLAB round-trip-verified (add → count grows, remove → count shrinks) in both
formats.

## Round-trip coverage

- Structural add/remove element (JSON + binary) with MATLAB `__class__` +
  `__count__` gate: `test/parity/fidelity/structural.fidelity.test.ts`.
- Per-element Name/Description edits: `test/parity/fidelity/element.fidelity.test.ts`.

## Open questions / deferred

- **Container metadata editing** (DataScope/HeaderFile if present): deferred,
  preserved read-only (conservative), same rationale as `Simulink.Bus`.
