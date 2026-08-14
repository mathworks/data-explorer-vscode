<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ServiceBus — data-object fidelity

**Node class:** `ServiceBusNode` (`src/dex/datamodel/node/data/ServiceBusNode.ts`, extends `BaseBusNode`)
**MATLAB class:** `Simulink.ServiceBus`
**Editable in our UI:** container: Name only. Elements: add/remove `Simulink.FunctionElement` (see [Simulink.FunctionElement.md](Simulink.FunctionElement.md)).
**Verified against:** MATLAB R2027a (in-process structural round-trip; no params.sldd fixture entry — exercised via `createDefault`)

## Overview

A `Simulink.ServiceBus` is a service interface: a named container whose children are
`Simulink.FunctionElement`s (service functions). Each function element carries a
`Prototype` (`"y = f(u,v)"`) and an `Arguments` array of `Simulink.BusElement`s,
rather than a data type. The container has no scalar value.

## Property table

| Property     | MATLAB type                    | SetAccess | Editable here | Serialized key    | Editor | Notes |
|--------------|--------------------------------|-----------|---------------|-------------------|--------|-------|
| Name         | char                           | (entry)   | yes           | name              | text   | Valid MATLAB identifier, unique in namespace |
| (class name) | —                              | —         | no (label)    | —                 | label  | Shows `Simulink.ServiceBus` in the Data Type column |
| Elements     | Simulink.FunctionElement array | public    | via children  | Elements_internal | —      | Structural add/remove; the Value column shows each function's Prototype |

Note: unlike `Simulink.Bus`/`Simulink.ConnectionBus`, the ServiceBus container does
**not** surface Description (its `getProperties` is the base `[PropName, PropDataType,
PropDescription]` but `displayValue` is empty and the primary interaction is
structural). Function elements expose **only** `Name` — see below.

## Non-obvious behavior

### No scalar value; empty Value column
`valueEditable === false` and `displayValue === ''`. Contract-lock assertions pin
this.

### FunctionElement has only Name / Prototype / Asynchronous / Arguments
A `Simulink.FunctionElement` has NO `Description` and NO `DataType` (verified against
MATLAB). Surfacing those foreign props previously let an edit inject a key the object
doesn't own; `FunctionElementNode.getProperties` therefore lists just `Name`, and the
Value column shows the `Prototype` via `displayValue`. See
[Simulink.FunctionElement.md](Simulink.FunctionElement.md).

### Add generates a well-formed function + arguments
`addChildNode()` creates `fN` (unique name) with `Prototype = "y = fN(u,v)"`, a
fresh entry-scoped `_id`, and an `Arguments` `Simulink.BusElement` array `[u, v, y]`
each with its own fresh `_id` (allocated past every id already in use, including the
nested argument ids of sibling functions). This keeps the serialized dictionary
structurally valid so MATLAB re-opens it without error.

## Structural editing

Add/remove `Simulink.FunctionElement` children. See [StructuralEditing.md](StructuralEditing.md).
Verified in-process (add → new function with u/v/y arguments; remove → gone;
undo/redo idempotent). No params.sldd fixture instantiates a ServiceBus, so the
round-trip is exercised via `createDefault` rather than a fixture entry; a MATLAB
value-equality gate on a generated ServiceBus dictionary is deferred (see below).

## Round-trip coverage

- In-process structural add/remove + undo/redo:
  `test/parity/fidelity/structural.fidelity.test.ts` (`Simulink.ServiceBus structural round-trip (in-process)`).

## Open questions / deferred

- **MATLAB gate on a generated ServiceBus**: no fixture entry exists, so the
  add/remove is proven in-process only. Generating a ServiceBus fixture via MATLAB
  and adding a live `__class__`/`__count__` gate is deferred.
- **FunctionElement Prototype / Asynchronous editing**: Prototype is shown via
  `displayValue` but not yet an editable field; Asynchronous (logical) is
  pass-through. Deferred.
