<!-- Copyright 2026 The MathWorks, Inc. -->

# Simulink.VariantConfigurationData — data-object fidelity

**Node class:** `VariantConfigurationDataNode` (`src/dex/datamodel/node/data/VariantConfigurationDataNode.ts`)
**MATLAB class:** `Simulink.VariantConfigurationData` (className dynamically read from `_array_class`)
**Editable in our UI:** no (`valueEditable` explicitly returns `false`)
**Verified against:** not probed (no params.sldd fixture instantiates this class)

## Overview

A Simulink.VariantConfigurationData (or its variant `Simulink.VariantConfigurations`)
stores variant configuration metadata. The node explicitly marks itself as
non-editable: `displayValue` returns `''` and `valueEditable` returns `false`. Its
property list is [PropName, PropDataType] only (no PropValue in the property
inspector items, though the PI layout includes PropValue for display purposes).

The `className` getter reads the real class from `serial._rawVal._array_class`,
falling back to `'Simulink.VariantConfigurationData'`. This allows proper display
of subclass identities.

The node has a `createDefault` static for constructing minimal instances.

## Property table

| Property   | Editor | Serialized key           | Notes                         |
|------------|--------|--------------------------|-------------------------------|
| Name       | text   | entry name               | MATLAB identifier             |
| DataType   | label  | (className display)      | Read-only label               |

## Read-only / no-fixture status

- `valueEditable` is explicitly `false` in the source code.
- `displayValue` returns `''` (no scalar value concept).
- No `params.sldd` fixture instantiates this class.
- **Contract-lock**: assert `valueEditable === false` and className via `createDefault`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- **Fixture generation**: deferred.
- **Subclass variants**: `Simulink.VariantConfigurations` routes here too (via the
  dynamic `className` getter). No validation of subclass-specific behavior.
