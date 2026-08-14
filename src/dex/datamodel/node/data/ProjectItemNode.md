<!-- Copyright 2026 The MathWorks, Inc. -->

# ProjectItemNode — data-object fidelity

**Node class:** `ProjectItemNode` (`src/dex/datamodel/node/data/ProjectItemNode.ts`)
**MATLAB class:** host-only, no MATLAB data object (project-tree node)
**Editable in our UI:** no (`valueEditable` and `nameEditable` explicitly return `false`)
**Verified against:** n/a — host node, not a Simulink data object

## Overview

ProjectItemNode represents a file, folder, path folder, label, or reference within
a MATLAB Project (`.prj` file). It is a tree-presentation node for the project
view, not a Simulink data object. It extends BaseNode directly (not DataNode).

The node carries:
- `projectItemType` — `'File'`, `'Folder'`, `'Path Folder'`, `'Label'`, `'Reference'`
- `location` — file path or identifier
- `labels` — array of classification labels
- `_icon` — optional override icon

Its `className` returns `projectItemType`, `displayValue` returns `location`, and
the icon is computed from the item type and file extension (e.g. `.slx` files get
`simulinkModel_FT`).

## Property table

| Property   | Editor | Notes                                           |
|------------|--------|-------------------------------------------------|
| Name       | —      | Item name (read-only, `nameEditable === false`)  |
| Type       | —      | Project item type (read-only)                   |
| Location   | —      | File path or identifier (read-only)             |
| Labels     | —      | Classification labels (read-only)               |

## Read-only / host status

- Both `valueEditable` and `nameEditable` explicitly return `false`.
- This is a project-tree presentation node with no data-object backing.
- **Existing test coverage**: `test/projectNode.test.ts` comprehensively tests
  ProjectItemNode through `ProjectNode.fromParsed` — section building, row
  generation, icon mapping, column population, and the element coloring contract.
- **Contract-lock**: no additional pinning needed beyond what `projectNode.test.ts`
  already provides. Referenced as existing coverage in
  `test/parity/fidelity/hostnodes.fidelity.test.ts` (SKIP with comment).

## Open questions / deferred

- None. Pure tree-presentation node.
