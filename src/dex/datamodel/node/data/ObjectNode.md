<!-- Copyright 2026 The MathWorks, Inc. -->

# ObjectNode — data-object fidelity

**Node class:** `ObjectNode` (`src/dex/datamodel/node/data/ObjectNode.ts`)
**MATLAB class:** host-only, generic `_array_class` fallback (className is dynamic)
**Editable in our UI:** no (displayValue renders as `<RxC ClassName>`, triggering BaseNode's valueEditable=false)
**Verified against:** n/a — host node, no specific MATLAB data object to probe

## Overview

ObjectNode is the final fallback in the NodeRegistry's matcher chain: any parsed
value object with an `_array_class` key that does NOT match a registered typed node
class routes here. It renders as a read-only `<RxC ClassName>` display (e.g.
`<1x1 Simulink.SomeUnknown>`). This keeps unrecognized Simulink objects visible
in the tree without crashing the extension.

The node stores its `arrayClass` from the raw value's `_array_class` and reports
it as `className`. It exposes [PropName, PropValue, PropDataType, PropDescription]
in the property table. Serialization passes through the raw value unchanged
(`serializeValue()` returns `this.serial._rawVal`), preserving fidelity for
classes we do not understand.

Special case: a derived `Simulink.ServiceBus` receives the `serviceInterfaces`
icon (architectural data support).

## Property table

| Property      | Editor | Notes                                         |
|---------------|--------|-----------------------------------------------|
| Name          | text   | Entry name                                    |
| Value         | label  | Shows `<RxC ClassName>` (read-only)           |
| DataType      | label  | Read-only label                               |
| Description   | label  | Read-only display                             |

## Read-only / host status

- `displayValue` returns `<RxC ClassName>` which triggers BaseNode's
  `valueEditable` heuristic to return `false`.
- ObjectNode is a catch-all fallback registered via a matcher function (not a class
  key), so it handles any `_array_class` value object not claimed by a typed node.
- It performs a pure passthrough serialization (no mutation), so unknown objects
  are preserved byte-for-byte.
- **Existing test coverage**: `test/archPresentation.test.ts` exercises ObjectNode
  for architectural data entries. `test/icons.test.ts` tests the ServiceBus icon path.
- **Contract-lock**: assert displayValue shape and className for a constructed
  instance in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None. ObjectNode is intentionally a passthrough with no editing behavior.
