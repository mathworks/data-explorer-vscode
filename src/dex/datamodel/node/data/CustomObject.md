<!-- Copyright 2026 The MathWorks, Inc. -->

# CustomObject — data-object fidelity

**Node class:** `CustomObjectNode` (`src/dex/datamodel/node/data/CustomObjectNode.ts`)
**MATLAB class:** host-only, generic MCOS passthrough (className is literal `'CustomObject'`)
**Editable in our UI:** no (displayValue renders as `<1x1 CustomObject>`, triggering BaseNode's valueEditable=false)
**Verified against:** n/a — host node, no MATLAB data object to probe

## Overview

CustomObjectNode is a generic passthrough for MCOS objects that do not match any
typed node class in the registry. It renders as a read-only display showing
`<1x1 CustomObject>`. The node carries a Description field and exposes
[PropName, PropValue, PropDataType, PropDescription] in its property table.

It is registered in NodeClassMap under the key `'CustomObject'` and is excluded
from `buildTypedNodeFromMcos` (the GENERIC_KEYS set) because it represents the
"unrecognized object" fallback, not a concrete Simulink class.

The node has a `createDefault` static and a `parse` static for construction.

## Property table

| Property      | Editor | Notes                                     |
|---------------|--------|-------------------------------------------|
| Name          | text   | Entry name                                |
| Value         | label  | Shows `<1x1 CustomObject>` (read-only)    |
| DataType      | label  | Read-only label                           |
| Description   | text   | Optional description string               |

## Read-only / host status

- `displayValue` returns `'<1x1 CustomObject>'` which triggers BaseNode's
  `valueEditable` heuristic (starts with `<`, ends with `>`) to return `false`.
- This node is a GENERIC fallback for unrecognized objects. It has no specific
  MATLAB class to probe and is excluded from typed-node unification.
- **Existing test coverage**: `test/mcosTypedNode.test.ts` asserts that
  `buildTypedNodeFromMcos('CustomObject', ...)` returns `null` (correctly excluded
  from the typed path).
- **Contract-lock**: pin className and displayValue shape via `createDefault` in
  `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None. This is a terminal fallback node with no MATLAB-specific behavior to probe.
