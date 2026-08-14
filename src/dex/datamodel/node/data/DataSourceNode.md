<!-- Copyright 2026 The MathWorks, Inc. -->

# DataSourceNode — data-object fidelity

**Node class:** `DataSourceNode` (`src/dex/datamodel/node/data/DataSourceNode.ts`)
**MATLAB class:** host-only, no MATLAB data object (data-source tree node)
**Editable in our UI:** no (`valueEditable` and `nameEditable` explicitly return `false`)
**Verified against:** n/a — host node, not a Simulink data object

## Overview

DataSourceNode represents a data source (data dictionary, Simulink model, or MAT
file) in the data-source tree view. It is a navigation/graph node that enables
opening linked files. It extends BaseNode directly (not DataNode).

The node carries:
- `fullPath` — the filesystem path to the data source
- `resolved` — whether the source has been resolved/found

Its `className` is computed from the file extension: `'Data Dictionary'` for
`.sldd`, `'Simulink Model'` for `.slx`, `'MAT File'` otherwise. `displayValue`
returns the `fullPath`. `toRow()` adds a `linkTarget` on the Value cell for
navigation.

## Property table

| Property   | Editor | Notes                                           |
|------------|--------|-------------------------------------------------|
| Name       | —      | Source file name (read-only)                    |
| Path       | —      | Full filesystem path (read-only)                |
| Status     | —      | Resolution status (read-only)                   |

## Read-only / host status

- Both `valueEditable` and `nameEditable` explicitly return `false`.
- This is a navigation/tree node with no Simulink data-object backing.
- **Existing test coverage**: `test/navTarget.test.ts` exercises DataSourceNode
  for data-source navigation link resolution.
- **Contract-lock**: assert `valueEditable === false` and `nameEditable === false`
  in `test/parity/fidelity/hostnodes.fidelity.test.ts`.

## Open questions / deferred

- None. Pure navigation/tree node.
