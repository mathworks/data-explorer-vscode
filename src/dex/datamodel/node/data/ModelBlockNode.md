<!-- Copyright 2026 The MathWorks, Inc. -->

# ModelBlockNode — data-object fidelity

**Node class:** `ModelBlockNode` (`src/dex/datamodel/node/data/ModelBlockNode.ts`)
**MATLAB class:** host-only, no MATLAB data object (model-tree relationship node)
**Editable in our UI:** no (`valueEditable` and `nameEditable` explicitly return `false`)
**Verified against:** n/a — host node, not a Simulink data object

## Overview

ModelBlockNode represents a block in the model hierarchy tree (typically from an
`.slx` file's block diagram). It is a relationship/graph node, not a data object
— it shows a block's type and its parameter usages (e.g. which workspace variables
a block references). It extends BaseNode directly (not DataNode), and both
`nameEditable` and `valueEditable` are explicitly `false`.

The node carries:
- `blockType` — the Simulink block type string (e.g. `'Gain'`, `'SubSystem'`)
- `paramUsages` — array of `{property, value}` pairs showing workspace refs
- `modelSrcId` — navigation target for the model graph
- `paramSourceId` — optional link target for parameter navigation

Its `toRow()` emits a specialized row with a `_graphTarget` for model navigation
and optional `linkTarget` in the DataType column for parameter cross-referencing.

## Property table

| Property   | Editor | Notes                                           |
|------------|--------|-------------------------------------------------|
| Name       | —      | Block name (read-only, `nameEditable === false`) |

## Read-only / host status

- Both `valueEditable` and `nameEditable` explicitly return `false`.
- This is a graph/navigation node with no Simulink data-object backing.
- **Existing test coverage**: `test/archPresentation.test.ts` and
  `test/navTarget.test.ts` exercise ModelBlockNode in the context of model
  hierarchy presentation and navigation.
- **Contract-lock**: assert `valueEditable === false` and `nameEditable === false`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None. Pure presentation/navigation node.
