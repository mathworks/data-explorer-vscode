<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.ConfigSetRef — data-object fidelity

**Node class:** `ConfigSetRefNode` (`src/dex/datamodel/node/data/ConfigSetRefNode.ts`)
**MATLAB class:** `Simulink.ConfigSetRef`
**Editable in our UI:** no (`valueEditable` explicitly returns `false`)
**Verified against:** not probed (no params.sldd fixture instantiates this class)

## Overview

A Simulink.ConfigSetRef is a reference to an external configuration set (stored in
a data dictionary). It carries a `SourceName` string identifying which configuration
set it points to. Like ConfigSet, it is primarily encountered in `.slx` files.

The node exposes [PropName, PropDataType] in `getProperties()`. The `active` flag
(set by the SLX parser) drives the icon: `check_configurationReference` (active)
vs. `configurationReference` (inactive).

The node has a `createDefault` static for constructing minimal instances (with an
empty `SourceName`).

## Property table

| Property    | Editor | Serialized key             | Notes                       |
|-------------|--------|----------------------------|-----------------------------|
| Name        | text   | entry name                 | MATLAB identifier           |
| SourceName  | —      | SourceName (in _properties)| Name of referenced config   |
| DataType    | label  | (className display)        | Read-only label             |

## Read-only / no-fixture status

- `valueEditable` is explicitly `false` in the source code.
- `displayValue` returns `''`.
- No `params.sldd` fixture instantiates this class.
- **Contract-lock**: assert `valueEditable === false` and className via `createDefault`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- **Fixture generation**: deferred.
