<!-- Copyright 2026 The MathWorks, Inc. -->

# ModelReferenceNode — data-object fidelity

**Node class:** `ModelReferenceNode` (`src/dex/datamodel/node/data/ModelReferenceNode.ts`)
**MATLAB class:** host-only, no MATLAB data object (model-reference relationship node)
**Editable in our UI:** no (`valueEditable` and `nameEditable` explicitly return `false`)
**Verified against:** n/a — host node, not a Simulink data object

## Overview

ModelReferenceNode represents a model reference relationship (e.g. a Model block
that references another `.slx` file). It is a navigation/graph node that enables
cross-model linking in the UI. It extends BaseNode directly (not DataNode).

The node carries:
- `blockPath` — the path to the referenced block/model
- `resolved` — whether the reference has been resolved (linked) in the graph

Its `displayValue` shows the `blockPath`, `className` returns `'Model Reference'`,
and `toRow()` adds a `linkTarget` on the Value cell for navigation.

## Property table

| Property   | Editor | Notes                                           |
|------------|--------|-------------------------------------------------|
| Name       | —      | Reference name (read-only)                      |
| BlockPath  | —      | Path to referenced model (read-only)            |
| Status     | —      | Resolution status (read-only)                   |

## Read-only / host status

- Both `valueEditable` and `nameEditable` explicitly return `false`.
- This is a graph/navigation node with no Simulink data-object backing.
- **Existing test coverage**: `test/navTarget.test.ts` exercises
  ModelReferenceNode for cross-model navigation link resolution.
- **Contract-lock**: assert `valueEditable === false` and `nameEditable === false`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None. Pure navigation/relationship node.
